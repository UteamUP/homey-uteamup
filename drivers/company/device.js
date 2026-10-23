'use strict';

const crypto = require('node:crypto');
const Homey = require('homey');
const { ActionInputError, GUID_PATTERN } = require('../../lib/actions');
const { DEFAULT_BASE_URL, DEFAULT_POLL_SECONDS, WEBHOOK_EVENTS } = require('../../lib/constants');
const { DeliveryDeduper, deliveryTitle, readDelivery } = require('../../lib/liveEvents');
const { capabilityValues, fetchStatus, openWorkOrders } = require('../../lib/status');
const {
  UteamupClient,
  UteamupAuthError,
  UteamupForbiddenError,
  UteamupNotFoundError,
  UteamupPlanError,
  UteamupRateLimitError,
} = require('../../lib/UteamupClient');

const REFRESH_THROTTLE_MS = 10_000;

class CompanyDevice extends Homey.Device {
  async onInit() {
    this._status = null;
    this._previous = {};
    this._reportedDenials = new Set();
    this._deduper = new DeliveryDeduper();
    this._lastRefresh = 0;
    this._client = this._createClient();
    this._startPolling(this.getSetting('poll_interval'));
    await this.refresh();
    if (this.getSetting('live_events') !== false) await this._enableLiveEvents().catch(this.error);
  }

  async onUninit() {
    this._stopPolling();
  }

  async onDeleted() {
    this._stopPolling();
    await this._disableLiveEvents().catch(this.error);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('assignee_guid') && newSettings.assignee_guid && !GUID_PATTERN.test(newSettings.assignee_guid.trim())) {
      throw new Error(this.homey.__('errors.invalidAssignee'));
    }
    if (changedKeys.includes('poll_interval')) this._startPolling(newSettings.poll_interval);
    if (changedKeys.includes('live_events')) {
      // Applied after Homey saves the settings, so a failure here never blocks saving them.
      const apply = newSettings.live_events ? () => this._enableLiveEvents() : () => this._disableLiveEvents();
      this.homey.setTimeout(() => apply().catch(this.error), 0);
    }
  }

  /** Called from repair once the new key has signed in to the same tenant. */
  async replaceCredentials(store) {
    for (const [key, value] of Object.entries(store)) await this.setStoreValue(key, value);
    this._client = this._createClient();
    await this.setAvailable();
    await this.refresh();
    if (this.getSetting('live_events') !== false) await this._enableLiveEvents();
  }

  _createClient() {
    return new UteamupClient({
      baseUrl: this.getStoreValue('baseUrl') || DEFAULT_BASE_URL,
      apiKey: this.getStoreValue('apiKey'),
      apiSecret: this.getStoreValue('apiSecret'),
      tenantGuid: this.getData().id,
    });
  }

  _startPolling(seconds) {
    this._stopPolling();
    const interval = Number(seconds) || DEFAULT_POLL_SECONDS;
    this._pollTimer = this.homey.setInterval(() => this.refresh().catch(this.error), interval * 1000);
  }

  _stopPolling() {
    if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  async refresh() {
    this._lastRefresh = Date.now();
    let status;
    try {
      status = await fetchStatus(this._client);
    } catch (err) {
      if (err instanceof UteamupAuthError) {
        await this.setUnavailable(this.homey.__('errors.reauth'));
      } else if (err instanceof UteamupPlanError) {
        await this.setUnavailable(this.homey.__('errors.plan'));
      } else if (!(err instanceof UteamupRateLimitError)) {
        await this.setUnavailable(this.homey.__('errors.connection'));
      }
      this.log('Refresh failed:', err.name);
      return;
    }
    this._status = status;
    for (const section of status.denied) {
      if (!this._reportedDenials.has(section)) {
        this._reportedDenials.add(section);
        this.log(`The API key may not read ${section}; grant the permission to the key's role and its creator.`);
      }
    }
    await this.setAvailable();
    await this._applyValues(capabilityValues(status));
  }

  async _applyValues(values) {
    const previous = this._previous;
    for (const [capability, value] of Object.entries(values)) {
      if (this.getCapabilityValue(capability) !== value) await this.setCapabilityValue(capability, value);
    }
    this._previous = values;
    // Transitions only, and never on the first refresh, so a restart does not fire Flows again.
    if (!('uteamup_overdue_workorders' in previous)) return;
    const overdue = values.uteamup_overdue_workorders;
    if (overdue !== null && previous.uteamup_overdue_workorders !== null && overdue !== previous.uteamup_overdue_workorders) {
      await this.driver.triggerOverdueChanged(this, overdue);
    }
    if (values.uteamup_iot_alert_active === true && previous.uteamup_iot_alert_active === false) {
      await this.driver.triggerIotAlertStarted(this, values.uteamup_iot_alerts ?? 0);
    }
    if (values.uteamup_critical_stock === true && previous.uteamup_critical_stock === false) {
      await this.driver.triggerCriticalStockStarted(this);
    }
  }

  _refreshSoon() {
    if (Date.now() - this._lastRefresh < REFRESH_THROTTLE_MS) return;
    this.refresh().catch(this.error);
  }

  async runAction(handler, args) {
    try {
      const tokens = await handler(this._client, args);
      this._refreshSoon();
      return tokens;
    } catch (err) {
      if (err instanceof ActionInputError) throw err;
      if (err instanceof UteamupForbiddenError) throw new Error(this.homey.__('errors.forbidden'));
      if (err instanceof UteamupNotFoundError) throw new Error(this.homey.__('errors.notFound'));
      if (err instanceof UteamupAuthError) throw new Error(this.homey.__('errors.reauth'));
      throw err;
    }
  }

  workOrderChoices(query) {
    const wanted = String(query ?? '').toLowerCase();
    return openWorkOrders(this._status ?? { sections: {} }, (this.getSetting('assignee_guid') || '').trim())
      .map((item) => ({
        name: [item.ticketId, item.name].filter(Boolean).join(' ') || item.guid,
        description: item.statusName || '',
        id: item.guid,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(wanted));
  }

  async _enableLiveEvents() {
    const url = await this.homey.app.liveEventsUrl(this.getData().id);
    if (!url) {
      this.log('Live events are not configured for this app build; using the refresh interval only.');
      return;
    }
    try {
      const existing = await this._client.listWebhookSubscriptions();
      const storedGuid = this.getStoreValue('webhookSubscriptionGuid');
      if (this.getStoreValue('webhookSecret') && (existing ?? []).some((item) => String(item.guid) === storedGuid && item.url === url)) {
        await this.unsetWarning();
        return;
      }
      if (storedGuid) await this._client.deleteWebhookSubscription(storedGuid).catch(() => {});
      const secret = crypto.randomBytes(32).toString('hex');
      const created = await this._client.createWebhookSubscription({
        name: `Homey ${this.getName()}`.slice(0, 200),
        url,
        secret,
        events: WEBHOOK_EVENTS,
      });
      await this.setStoreValue('webhookSecret', secret);
      await this.setStoreValue('webhookSubscriptionGuid', String(created?.guid ?? ''));
      await this.unsetWarning();
    } catch (err) {
      if (err instanceof UteamupForbiddenError || err instanceof UteamupPlanError) {
        await this.setWarning(this.homey.__('errors.liveEventsUnavailable'));
        return;
      }
      throw err;
    }
  }

  async _disableLiveEvents() {
    const guid = this.getStoreValue('webhookSubscriptionGuid');
    await this.unsetStoreValue('webhookSecret');
    await this.unsetStoreValue('webhookSubscriptionGuid');
    if (guid) await this._client.deleteWebhookSubscription(guid).catch((err) => this.log('Could not remove the UteamUP webhook:', err.name));
    await this.unsetWarning();
  }

  /** One forwarded webhook delivery for this tenant. */
  async handleDelivery(message) {
    const delivery = readDelivery(message, this.getStoreValue('webhookSecret'));
    if (!delivery.verified) {
      // Unverified data never reaches a Flow; at most it makes Homey re-read UteamUP itself.
      this._refreshSoon();
      return;
    }
    if (!this._deduper.isNew(delivery.deliveryId)) return;
    await this.driver.triggerEvent(
      this,
      { event: delivery.event, title: deliveryTitle(delivery.data), delivery_id: delivery.deliveryId },
      { event: delivery.event },
    );
    this._refreshSoon();
  }
}

module.exports = CompanyDevice;

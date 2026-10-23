'use strict';

const Homey = require('homey');
const { webhookUrl } = require('./lib/liveEvents');

class UteamupApp extends Homey.App {
  async onInit() {
    this._webhookId = Homey.env.WEBHOOK_ID;
    this._homeyId = null;
    if (!this._webhookId || !Homey.env.WEBHOOK_SECRET) {
      this.log('No webhook registered for this build; live events are off.');
      return;
    }
    try {
      this._homeyId = await this.homey.cloud.getHomeyId();
      const webhook = await this.homey.cloud.createWebhook(this._webhookId, Homey.env.WEBHOOK_SECRET, {});
      webhook.on('message', (message) => this._dispatch(message).catch(this.error));
    } catch (err) {
      this._homeyId = null;
      this.error('Live events could not start:', err.message);
    }
  }

  /** The public URL UteamUP posts this tenant's events to, or null when live events are off. */
  async liveEventsUrl(tenantGuid) {
    return this._homeyId ? webhookUrl(this._webhookId, this._homeyId, tenantGuid) : null;
  }

  async _dispatch(message) {
    const tenant = String(message?.query?.tenant ?? '').toLowerCase();
    const device = this.homey.drivers
      .getDriver('company')
      .getDevices()
      .find((item) => item.getData().id.toLowerCase() === tenant);
    if (device) await device.handleDelivery(message);
  }
}

module.exports = UteamupApp;

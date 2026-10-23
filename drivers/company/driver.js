'use strict';

const Homey = require('homey');
const { ACTIONS } = require('../../lib/actions');
const { connect, errorKey } = require('../../lib/pairing');

class CompanyDriver extends Homey.Driver {
  async onInit() {
    this._eventReceived = this.homey.flow.getDeviceTriggerCard('event_received');
    this._eventReceived.registerRunListener(async (args, state) => {
      const wanted = String(args.event ?? '').trim();
      return !wanted || wanted === state.event;
    });
    this._overdueChanged = this.homey.flow.getDeviceTriggerCard('overdue_changed');
    this._iotAlertStarted = this.homey.flow.getDeviceTriggerCard('iot_alert_started');
    this._criticalStockStarted = this.homey.flow.getDeviceTriggerCard('critical_stock_started');

    this.homey.flow.getConditionCard('overdue_above')
      .registerRunListener(async ({ device, count }) => (device.getCapabilityValue('uteamup_overdue_workorders') ?? 0) > count);
    this.homey.flow.getConditionCard('iot_alert_active')
      .registerRunListener(async ({ device }) => device.getCapabilityValue('uteamup_iot_alert_active') === true);

    for (const [id, handler] of Object.entries(ACTIONS)) {
      const card = this.homey.flow.getActionCard(id);
      card.registerRunListener(async (args) => args.device.runAction(handler, args));
      if (['set_work_order_status', 'complete_work_order'].includes(id)) {
        card.registerArgumentAutocompleteListener('work_order', async (query, args) => args.device.workOrderChoices(query));
      }
    }
  }

  triggerEvent(device, tokens, state) {
    return this._eventReceived.trigger(device, tokens, state);
  }

  triggerOverdueChanged(device, overdue) {
    return this._overdueChanged.trigger(device, { overdue });
  }

  triggerIotAlertStarted(device, count) {
    return this._iotAlertStarted.trigger(device, { count });
  }

  triggerCriticalStockStarted(device) {
    return this._criticalStockStarted.trigger(device);
  }

  async onPair(session) {
    session.setHandler('login', async (input) => this._connect(input));
  }

  async onRepair(session, device) {
    session.setHandler('login', async (input) => {
      const { store } = await this._connect(input, device.getData().id);
      await device.replaceCredentials(store);
      return null;
    });
  }

  async _connect(input, expectedTenantGuid = null) {
    try {
      return await connect(input, { expectedTenantGuid });
    } catch (err) {
      this.log('Sign-in failed:', err.name);
      throw new Error(this.homey.__(errorKey(err)));
    }
  }
}

module.exports = CompanyDriver;

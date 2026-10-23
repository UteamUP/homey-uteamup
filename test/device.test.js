'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { beforeEach, describe, it } = require('node:test');
const { installHomeyStub, recordingDriver } = require('./homeyStub');

installHomeyStub();
const CompanyDevice = require('../drivers/company/device');
const { ACTIONS } = require('../lib/actions');
const { UteamupClient } = require('../lib/UteamupClient');
const {
  API_KEY,
  API_SECRET,
  BASE,
  IOT,
  STOCK,
  TENANT,
  WORK_ORDER_GUID,
  fakeFetch,
  jsonResponse,
  statusRoutes,
} = require('./helpers');

const LIVE_URL = `https://webhooks.athom.com/webhook/wh?homey=h&tenant=${TENANT}`;

function makeDevice({ routes = statusRoutes(), settings = {}, store = {}, liveUrl = null } = {}) {
  const driver = recordingDriver();
  const device = new CompanyDevice({
    data: { id: TENANT },
    store: { baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET, ...store },
    settings: { poll_interval: 120, assignee_guid: '', live_events: false, ...settings },
    driver,
    app: { liveEventsUrl: async () => liveUrl },
  });
  const fetch = fakeFetch(routes);
  device._createClient = () => new UteamupClient({ baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET, tenantGuid: TENANT, fetchImpl: fetch });
  return { device, driver, fetch };
}

async function init(device) {
  await device.onInit();
  return device;
}

// Refreshes after an action or a delivery are throttled; this pretends the last one was long ago.
function allowRefresh(device) {
  device._lastRefresh = 0;
}

describe('refresh', () => {
  it('fills the capabilities on start without firing Flows', async () => {
    const { device, driver } = makeDevice();
    await init(device);
    assert.equal(device.getCapabilityValue('uteamup_overdue_workorders'), 2);
    assert.equal(device.getCapabilityValue('uteamup_critical_stock'), true);
    assert.deepEqual(driver.fired, []);
  });

  it('fires triggers on transitions only', async () => {
    let overdue = 2;
    let iot = IOT;
    let stock = { ...STOCK, criticalCount: 0 };
    const { device, driver } = makeDevice({
      routes: statusRoutes({
        'GET /api/analytics/summary': () => jsonResponse(200, { workorders: { open: 1, inProgress: 0, onHold: 0, overdue } }),
        'GET /api/iot/alerts': () => jsonResponse(200, iot),
        'GET /api/stock/alerts/summary': () => jsonResponse(200, stock),
      }),
    });
    await init(device);
    overdue = 3;
    iot = { items: [{}], totalItems: 1 };
    stock = STOCK;
    await device.refresh();
    await device.refresh();
    assert.deepEqual(driver.fired, [['overdue', 3], ['iot', 1], ['stock']]);
  });

  it('marks the device unavailable when the key is rejected, and recovers', async () => {
    let status = 401;
    const { device } = makeDevice({ routes: statusRoutes({ 'GET /api/iot/alerts': () => (status === 401 ? jsonResponse(401, {}) : jsonResponse(200, IOT)) }) });
    await init(device);
    assert.equal(device.available, false);
    assert.equal(device.unavailableMessage, 't:errors.reauth');
    status = 200;
    await device.refresh();
    assert.equal(device.available, true);
  });

  it('keeps other values when one permission is missing and logs it once', async () => {
    const { device } = makeDevice({ routes: statusRoutes({ 'GET /api/stock/alerts/summary': jsonResponse(403, {}) }) });
    await init(device);
    await device.refresh();
    assert.equal(device.available, true);
    assert.equal(device.getCapabilityValue('uteamup_stock_alerts'), null);
    assert.equal(device.getCapabilityValue('uteamup_open_workorders'), 7);
    assert.equal(device.logs.filter((line) => String(line[0]).includes('stockAlerts')).length, 1);
  });

  it('treats an unreachable API as unavailable and never logs the secret', async () => {
    const { device } = makeDevice({ routes: {} });
    await init(device);
    assert.equal(device.unavailableMessage, 't:errors.connection');
    assert.ok(!JSON.stringify(device.logs).includes(API_SECRET));
  });
});

describe('actions', () => {
  it('runs a handler with the device client and refreshes afterwards', async () => {
    const { device, fetch } = makeDevice({ routes: statusRoutes({ [`POST /api/workorder/by-guid/${WORK_ORDER_GUID}/complete`]: {} }) });
    await init(device);
    allowRefresh(device);
    await device.runAction(ACTIONS.complete_work_order, { work_order: WORK_ORDER_GUID });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fetch.callsTo(`POST /api/workorder/by-guid/${WORK_ORDER_GUID}/complete`).length, 1);
    assert.equal(fetch.callsTo('GET /api/analytics/summary').length, 2);
  });

  it('explains a missing permission instead of showing an HTTP error', async () => {
    const { device } = makeDevice({ routes: statusRoutes({ 'POST /api/workorder': jsonResponse(403, {}) }) });
    await init(device);
    await assert.rejects(device.runAction(ACTIONS.create_work_order, { name: 'X' }), { message: 't:errors.forbidden' });
  });

  it('offers open work orders, filtered by the assignee setting and the query', async () => {
    const { device } = makeDevice({ settings: { assignee_guid: '44444444-4444-4444-8444-444444444444' } });
    await init(device);
    assert.deepEqual(device.workOrderChoices(''), [{ name: 'WO-42 Replace pump seal', description: 'Not started', id: WORK_ORDER_GUID }]);
    assert.deepEqual(device.workOrderChoices('filter'), []);
  });

  it('rejects an assignee setting that is not a GUID', async () => {
    const device = await init(makeDevice().device);
    await assert.rejects(
      device.onSettings({ newSettings: { assignee_guid: 'bob' }, changedKeys: ['assignee_guid'] }),
      { message: 't:errors.invalidAssignee' },
    );
  });
});

describe('live events', () => {
  let created;
  beforeEach(() => { created = []; });

  function liveRoutes(extra = {}) {
    return statusRoutes({
      'GET /api/webhooks/subscriptions': [],
      'POST /api/webhooks/subscriptions': (url, init) => {
        created.push(JSON.parse(init.body));
        return jsonResponse(200, { guid: 'sub-1', url: LIVE_URL });
      },
      'DELETE /api/webhooks/subscriptions/sub-1': jsonResponse(204),
      ...extra,
    });
  }

  it('subscribes with a fresh random secret and the forwarder URL', async () => {
    const { device } = makeDevice({ routes: liveRoutes(), settings: { live_events: true }, liveUrl: LIVE_URL });
    await init(device);
    assert.equal(created.length, 1);
    assert.equal(created[0].url, LIVE_URL);
    assert.match(created[0].secret, /^[0-9a-f]{64}$/);
    assert.equal(device.getStoreValue('webhookSecret'), created[0].secret);
    assert.equal(device.getStoreValue('webhookSubscriptionGuid'), 'sub-1');
  });

  it('keeps an existing matching subscription', async () => {
    const { device } = makeDevice({
      routes: liveRoutes({ 'GET /api/webhooks/subscriptions': [{ guid: 'sub-1', url: LIVE_URL }] }),
      settings: { live_events: true },
      store: { webhookSubscriptionGuid: 'sub-1', webhookSecret: 's'.repeat(64) },
      liveUrl: LIVE_URL,
    });
    await init(device);
    assert.equal(created.length, 0);
  });

  it('shows a warning and keeps polling when the plan or role does not allow webhooks', async () => {
    const { device } = makeDevice({
      routes: liveRoutes({ 'GET /api/webhooks/subscriptions': jsonResponse(403, {}) }),
      settings: { live_events: true },
      liveUrl: LIVE_URL,
    });
    await init(device);
    assert.equal(device.warning, 't:errors.liveEventsUnavailable');
    assert.equal(device.available, true);
  });

  it('does nothing when the build has no webhook', async () => {
    const { device, fetch } = makeDevice({ routes: liveRoutes(), settings: { live_events: true }, liveUrl: null });
    await init(device);
    assert.equal(fetch.callsTo('GET /api/webhooks/subscriptions').length, 0);
  });

  it('fires the event trigger once for a verified delivery', async () => {
    const secret = 'e'.repeat(64);
    const { device, driver } = makeDevice({ store: { webhookSecret: secret } });
    await init(device);
    const raw = '{"event":"iot.alert.created","data":{"title":"Boiler pressure high"}}';
    const message = {
      headers: {
        'x-uteamup-signature': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`,
        'x-uteamup-delivery': 'd-7',
      },
      body: JSON.parse(raw),
    };
    await device.handleDelivery(message);
    await device.handleDelivery(message);
    assert.deepEqual(driver.fired, [[
      'event',
      { event: 'iot.alert.created', title: 'Boiler pressure high', delivery_id: 'd-7' },
      { event: 'iot.alert.created' },
    ]]);
  });

  it('never fires a Flow for a forged delivery, and only refreshes through the API', async () => {
    const { device, driver, fetch } = makeDevice({ store: { webhookSecret: 'e'.repeat(64) } });
    await init(device);
    allowRefresh(device);
    await device.handleDelivery({ headers: { 'x-uteamup-signature': 'sha256=00' }, body: { event: 'workorder.created' } });
    await device.handleDelivery({ headers: {}, body: { event: 'workorder.created' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(driver.fired, []);
    assert.equal(fetch.callsTo('GET /api/analytics/summary').length, 2, 'one refresh, the second is throttled');
  });

  it('removes the subscription when the device is deleted', async () => {
    const { device, fetch } = makeDevice({ routes: liveRoutes(), store: { webhookSubscriptionGuid: 'sub-1', webhookSecret: 'x' } });
    await init(device);
    await device.onDeleted();
    assert.equal(fetch.callsTo('DELETE /api/webhooks/subscriptions/sub-1').length, 1);
    assert.equal(device.getStoreValue('webhookSecret'), undefined);
  });
});

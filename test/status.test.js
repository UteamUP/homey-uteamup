'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { UteamupClient, UteamupAuthError, UteamupConnectionError } = require('../lib/UteamupClient');
const { capabilityValues, fetchStatus, openWorkOrders } = require('../lib/status');
const { API_KEY, API_SECRET, BASE, WORK_ORDER_GUID, fakeFetch, jsonResponse, statusRoutes } = require('./helpers');

function client(routes) {
  return new UteamupClient({ baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET, fetchImpl: fakeFetch(routes) });
}

describe('fetchStatus', () => {
  it('reads every section into capability values', async () => {
    const status = await fetchStatus(client(statusRoutes()));
    assert.deepEqual(capabilityValues(status), {
      uteamup_open_workorders: 7,
      uteamup_in_progress_workorders: 3,
      uteamup_on_hold_workorders: 1,
      uteamup_overdue_workorders: 2,
      uteamup_stock_alerts: 4,
      uteamup_critical_stock: true,
      uteamup_iot_alerts: 0,
      uteamup_iot_alert_active: false,
    });
    assert.equal(status.denied.size, 0);
  });

  it('leaves only the denied section empty when the key lacks a permission', async () => {
    const status = await fetchStatus(client(statusRoutes({ 'GET /api/stock/alerts/summary': jsonResponse(403, {}) })));
    const values = capabilityValues(status);
    assert.deepEqual([...status.denied], ['stockAlerts']);
    assert.equal(values.uteamup_stock_alerts, null);
    assert.equal(values.uteamup_critical_stock, null);
    assert.equal(values.uteamup_open_workorders, 7);
  });

  it('throws on a rejected key so the device asks for a new one', async () => {
    const routes = statusRoutes({ 'GET /api/iot/alerts': jsonResponse(401, {}) });
    await assert.rejects(fetchStatus(client(routes)), UteamupAuthError);
  });

  it('throws on a server error instead of showing partial data', async () => {
    await assert.rejects(fetchStatus(client(statusRoutes({ 'GET /api/workorder': jsonResponse(502, {}) }))), UteamupConnectionError);
  });

  it('treats missing fields as unknown, not as zero', async () => {
    const status = await fetchStatus(client(statusRoutes({ 'GET /api/analytics/summary': {} })));
    assert.equal(capabilityValues(status).uteamup_open_workorders, null);
  });
});

describe('openWorkOrders', () => {
  it('filters by assignee case-insensitively', async () => {
    const status = await fetchStatus(client(statusRoutes()));
    assert.equal(openWorkOrders(status).length, 2);
    const mine = openWorkOrders(status, '44444444-4444-4444-8444-444444444444'.toUpperCase());
    assert.deepEqual(mine.map((item) => item.guid), [WORK_ORDER_GUID]);
    assert.deepEqual(openWorkOrders({ sections: {} }), []);
  });
});

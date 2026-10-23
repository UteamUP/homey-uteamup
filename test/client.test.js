'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  UteamupClient,
  UteamupApiError,
  UteamupAuthError,
  UteamupConnectionError,
  UteamupForbiddenError,
  UteamupMcpKeyError,
  UteamupNotFoundError,
  UteamupPlanError,
  UteamupRateLimitError,
} = require('../lib/UteamupClient');
const { API_KEY, API_SECRET, BASE, LOGIN, TENANT, fakeFetch, jsonResponse, loginOk, makeToken } = require('./helpers');

function client(fetchImpl, extra = {}) {
  return new UteamupClient({ baseUrl: `${BASE}/`, apiKey: API_KEY, apiSecret: API_SECRET, fetchImpl, ...extra });
}

describe('login', () => {
  it('exchanges the key for a token and reads the tenant from it', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk() });
    const api = client(fetch);
    assert.equal(await api.login(), TENANT);
    assert.equal(api.tenantGuid, TENANT);
    const [call] = fetch.calls;
    assert.equal(call.url.href, `${BASE}/api/auth/apikey-login`);
    assert.deepEqual(JSON.parse(call.init.body), { apiKey: API_KEY, secret: API_SECRET });
    assert.equal(call.init.redirect, 'error');
  });

  it('sends the known tenant so a multi-tenant key signs in to the paired company', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk() });
    await client(fetch, { tenantGuid: TENANT }).login();
    assert.equal(JSON.parse(fetch.calls[0].init.body).tenantGuid, TENANT);
  });

  it('tells an MCP key apart from a wrong secret', async () => {
    const mcp = fakeFetch({ [LOGIN]: jsonResponse(400, { message: 'MCP-enabled keys cannot sign in here' }) });
    await assert.rejects(client(mcp).login(), UteamupMcpKeyError);
    const wrong = fakeFetch({ [LOGIN]: jsonResponse(401, { message: 'Invalid API key or secret' }) });
    await assert.rejects(client(wrong).login(), (err) => err instanceof UteamupAuthError && !(err instanceof UteamupMcpKeyError));
  });

  it('maps throttling, server errors and network failures', async () => {
    await assert.rejects(
      client(fakeFetch({ [LOGIN]: jsonResponse(429, {}, { 'Retry-After': '30' }) })).login(),
      (err) => err instanceof UteamupRateLimitError && err.retryAfter === 30,
    );
    await assert.rejects(client(fakeFetch({ [LOGIN]: jsonResponse(503, {}) })).login(), UteamupConnectionError);
    await assert.rejects(client(fakeFetch({})).login(), UteamupConnectionError);
  });
});

describe('requests', () => {
  it('sends the bearer token and tenant header, and the CSRF header only on writes', async () => {
    const fetch = fakeFetch({
      [LOGIN]: loginOk(),
      'GET /api/stock/alerts/summary': { totalActive: 1 },
      'POST /api/workordertemplate/schedules/abc/runnow': { guid: 'x' },
    });
    const api = client(fetch);
    await api.getStockAlertSummary();
    await api.runPmSchedule('abc');
    const [read, write] = fetch.calls.slice(1);
    assert.match(read.init.headers.Authorization, /^Bearer /);
    assert.equal(read.init.headers['X-Tenant-Guid'], TENANT);
    assert.equal(read.init.headers['X-Requested-With'], undefined);
    assert.equal(write.init.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(fetch.callsTo(LOGIN).length, 1, 'the token is reused');
  });

  it('signs in again once on a 401 and gives up on the second', async () => {
    const fetch = fakeFetch({
      [LOGIN]: loginOk(),
      'GET /api/iot/alerts': [jsonResponse(401, {}), { totalItems: 0 }],
    });
    assert.deepEqual(await client(fetch).getIotAlerts(), { totalItems: 0 });
    assert.equal(fetch.callsTo(LOGIN).length, 2);

    const always = fakeFetch({ [LOGIN]: loginOk(), 'GET /api/iot/alerts': jsonResponse(401, { message: 'revoked' }) });
    await assert.rejects(client(always).getIotAlerts(), UteamupAuthError);
    assert.equal(always.callsTo('GET /api/iot/alerts').length, 2);
  });

  it('refreshes a token that is about to expire', async () => {
    const fetch = fakeFetch({
      [LOGIN]: () => jsonResponse(200, { accessToken: makeToken({ expiresIn: 60 }) }),
      'GET /api/stock/alerts/summary': {},
    });
    const api = client(fetch);
    await api.getStockAlertSummary();
    await api.getStockAlertSummary();
    assert.equal(fetch.callsTo(LOGIN).length, 2);
  });

  for (const [status, error] of [
    [402, UteamupPlanError],
    [403, UteamupForbiddenError],
    [404, UteamupNotFoundError],
    [409, UteamupApiError],
    [500, UteamupConnectionError],
  ]) {
    it(`maps HTTP ${status} to ${error.name}`, async () => {
      const fetch = fakeFetch({ [LOGIN]: loginOk(), 'GET /api/analytics/summary': jsonResponse(status, { message: 'no' }) });
      await assert.rejects(client(fetch).getAnalyticsSummary(), error);
    });
  }

  it('keeps the API message for validation errors', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk(), 'POST /api/workorder': jsonResponse(400, { title: 'Name is required' }) });
    await assert.rejects(client(fetch).createWorkOrder({}), { message: 'Name is required' });
  });
});

describe('endpoints', () => {
  it('reads the same lists as the Home Assistant integration', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk(), 'GET /api/workorder': { items: [] }, 'GET /api/iot/alerts': {}, 'GET /api/analytics/summary': {} });
    const api = client(fetch);
    await api.getOpenWorkOrders();
    await api.getIotAlerts();
    await api.getAnalyticsSummary();
    const query = (key) => Object.fromEntries(fetch.callsTo(key)[0].url.searchParams);
    assert.deepEqual(query('GET /api/workorder'), { openOnly: 'true', page: '1', pageSize: '100' });
    assert.deepEqual(query('GET /api/iot/alerts'), { unacknowledgedOnly: 'true', page: '1', pageSize: '100' });
    assert.deepEqual(query('GET /api/analytics/summary'), { timeframe: '30d' });
  });

  it('sets a status with an optional expected status', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk(), 'PUT /api/workorder/by-guid/w/status/4': {} });
    const api = client(fetch);
    await api.setWorkOrderStatus('w', 4, 2);
    await api.setWorkOrderStatus('w', 4);
    const [first, second] = fetch.callsTo('PUT /api/workorder/by-guid/w/status/4');
    assert.equal(first.url.searchParams.get('expectedStatus'), '2');
    assert.equal(second.url.search, '');
  });

  it('sends a quick report as multipart with upper-case severity', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk(), 'POST /api/quickreport': { workorderGuid: 'w' } });
    await client(fetch).createQuickReport({ description: 'Leak', severity: 'critical', assetGuid: 'a', tags: ['x', 'y'] });
    const form = fetch.callsTo('POST /api/quickreport')[0].init.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('Description'), 'Leak');
    assert.equal(form.get('Severity'), 'CRITICAL');
    assert.equal(form.get('AssetGuid'), 'a');
    assert.deepEqual(form.getAll('Tags'), ['x', 'y']);
  });

  it('completes a work order with or without a report', async () => {
    const fetch = fakeFetch({ [LOGIN]: loginOk(), 'POST /api/workorder/by-guid/w/complete': {} });
    const api = client(fetch);
    await api.completeWorkOrder('w', 'Done');
    await api.completeWorkOrder('w');
    const bodies = fetch.callsTo('POST /api/workorder/by-guid/w/complete').map((call) => JSON.parse(call.init.body));
    assert.deepEqual(bodies, [{ report: { description: 'Done' } }, {}]);
  });

  it('appends an escaped journal line and keeps the other journal fields', async () => {
    const journal = {
      title: 'Boiler log',
      content: '<p>Started</p>',
      journalDate: '2026-10-01T00:00:00Z',
      priority: 3,
      isTemplate: false,
      isArchived: false,
      categoryGuid: 'cat',
    };
    const fetch = fakeFetch({ [LOGIN]: loginOk(), 'GET /api/journal/by-guid/j': journal, 'PUT /api/journal/by-guid/j': {} });
    await client(fetch).appendJournalEntry('j', 'Pressure <3 & "low"');
    const form = fetch.callsTo('PUT /api/journal/by-guid/j')[0].init.body;
    assert.equal(form.get('Content'), '<p>Started</p>\n<p>Pressure &lt;3 &amp; &quot;low&quot;</p>');
    assert.equal(form.get('Title'), 'Boiler log');
    assert.equal(form.get('Priority'), '3');
    assert.equal(form.get('CategoryGuid'), 'cat');
    assert.equal(form.get('LocationGuid'), null);
  });

  it('creates and deletes webhook subscriptions', async () => {
    const fetch = fakeFetch({
      [LOGIN]: loginOk(),
      'POST /api/webhooks/subscriptions': { guid: 's' },
      'DELETE /api/webhooks/subscriptions/s': jsonResponse(204),
    });
    const api = client(fetch);
    await api.createWebhookSubscription({ name: 'Homey', url: 'https://x', secret: 'z'.repeat(64), events: ['a'] });
    await api.deleteWebhookSubscription('s');
    assert.deepEqual(JSON.parse(fetch.callsTo('POST /api/webhooks/subscriptions')[0].init.body), {
      name: 'Homey',
      url: 'https://x',
      secret: 'z'.repeat(64),
      events: ['a'],
      isActive: true,
    });
  });
});

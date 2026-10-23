'use strict';

const BASE = 'https://api.example.test';
const TENANT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const API_KEY = 'a'.repeat(32);
const API_SECRET = 'b'.repeat(64);
const WORK_ORDER_GUID = '11111111-1111-4111-8111-111111111111';
const ASSET_GUID = '22222222-2222-4222-8222-222222222222';
const ATTRIBUTE_GUID = '33333333-3333-4333-8333-333333333333';

function makeToken({ tenant = TENANT, expiresIn = 86_400 } = {}) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { TenantGuid: tenant, AuthType: 'ApiKey', exp: Math.floor(Date.now() / 1000) + expiresIn };
  return `${part({ alg: 'HS256' })}.${part(claims)}.signature`;
}

const ANALYTICS = { workorders: { open: 7, inProgress: 3, onHold: 1, overdue: 2 } };
const STOCK = { totalActive: 4, criticalCount: 1, lowStockCount: 2, stockoutCount: 1, actionRequiredCount: 3 };
const IOT = { items: [], totalItems: 0 };
const WORK_ORDERS = {
  items: [
    {
      guid: WORK_ORDER_GUID,
      ticketId: 'WO-42',
      name: 'Replace pump seal',
      statusName: 'Not started',
      primaryAssigneeGuid: '44444444-4444-4444-8444-444444444444',
    },
    { guid: '55555555-5555-4555-8555-555555555555', ticketId: 'WO-43', name: 'Clean filter', statusName: 'In progress' },
  ],
  totalItems: 2,
};

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * A fetch stand-in. `routes` maps "METHOD /path" to a response, a function returning one, or a
 * list of responses served in order. Every call is recorded with its parsed request.
 */
function fakeFetch(routes) {
  const calls = [];
  const queues = new Map();
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    calls.push({ key, url, init });
    let route = routes[key];
    if (route === undefined) throw new TypeError(`fetch failed: no route for ${key}`);
    if (Array.isArray(route)) {
      const index = queues.get(key) ?? 0;
      queues.set(key, index + 1);
      route = route[Math.min(index, route.length - 1)];
    }
    const response = typeof route === 'function' ? await route(url, init) : route;
    return response instanceof Response ? response.clone() : jsonResponse(200, response);
  };
  fetch.calls = calls;
  fetch.callsTo = (key) => calls.filter((call) => call.key === key);
  return fetch;
}

const LOGIN = 'POST /api/auth/apikey-login';

function loginOk(tenant = TENANT) {
  return () => jsonResponse(200, { accessToken: makeToken({ tenant }) });
}

function statusRoutes(overrides = {}) {
  return {
    [LOGIN]: loginOk(),
    'GET /api/analytics/summary': ANALYTICS,
    'GET /api/stock/alerts/summary': STOCK,
    'GET /api/iot/alerts': IOT,
    'GET /api/workorder': WORK_ORDERS,
    ...overrides,
  };
}

module.exports = {
  BASE,
  TENANT,
  API_KEY,
  API_SECRET,
  WORK_ORDER_GUID,
  ASSET_GUID,
  ATTRIBUTE_GUID,
  ANALYTICS,
  STOCK,
  IOT,
  WORK_ORDERS,
  LOGIN,
  makeToken,
  jsonResponse,
  fakeFetch,
  loginOk,
  statusRoutes,
};

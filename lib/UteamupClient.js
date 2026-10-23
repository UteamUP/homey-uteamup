'use strict';

const TOKEN_REFRESH_MARGIN_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 30_000;

class UteamupError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

/** The API could not be reached or answered with a server error. */
class UteamupConnectionError extends UteamupError {}

/** The API key or secret was rejected. */
class UteamupAuthError extends UteamupError {}

/** The key is MCP-enabled, and MCP keys cannot sign in to the REST API. */
class UteamupMcpKeyError extends UteamupAuthError {}

/** The tenant's paid plan is not active yet. */
class UteamupPlanError extends UteamupError {}

/** The key's role, its creator or the tenant's plan does not allow the call. */
class UteamupForbiddenError extends UteamupError {}

/** The record does not exist in this tenant. */
class UteamupNotFoundError extends UteamupError {}

/** UteamUP asked the client to slow down. */
class UteamupRateLimitError extends UteamupError {
  constructor(retryAfter) {
    super(`Rate limited; retry after ${retryAfter} s`);
    this.retryAfter = retryAfter;
  }
}

/** The API rejected the request (validation or conflict). */
class UteamupApiError extends UteamupError {}

function jwtClaims(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function retryAfter(response) {
  const value = response.headers.get('Retry-After');
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

async function errorMessage(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object') {
      return String(body.message || body.error || body.title || JSON.stringify(body));
    }
    return String(body);
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Talks to one UteamUP tenant with a non-MCP tenant API key, like the Home Assistant integration. */
class UteamupClient {
  constructor({ baseUrl, apiKey, apiSecret, tenantGuid = null, fetchImpl = globalThis.fetch }) {
    this._baseUrl = baseUrl.replace(/\/+$/, '');
    this._apiKey = apiKey;
    this._apiSecret = apiSecret;
    this._tenantGuid = tenantGuid;
    this._fetch = fetchImpl;
    this._token = null;
    this._expiresAt = 0;
  }

  get tenantGuid() {
    return this._tenantGuid;
  }

  async _send(url, init) {
    try {
      return await this._fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new UteamupConnectionError(err.message);
    }
  }

  /** Exchanges the key and secret for a JWT and returns the key's tenant GUID. */
  async login() {
    const body = { apiKey: this._apiKey, secret: this._apiSecret };
    if (this._tenantGuid) body.tenantGuid = this._tenantGuid;
    const response = await this._send(`${this._baseUrl}/api/auth/apikey-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 429) throw new UteamupRateLimitError(retryAfter(response));
    if (response.status === 400) {
      const message = await errorMessage(response);
      if (message.includes('MCP')) throw new UteamupMcpKeyError(message);
      throw new UteamupAuthError(message);
    }
    if (response.status === 401) throw new UteamupAuthError(await errorMessage(response));
    if (response.status >= 400) throw new UteamupConnectionError(`Login failed with HTTP ${response.status}`);

    const { accessToken } = await response.json();
    const claims = jwtClaims(accessToken);
    this._token = accessToken;
    this._expiresAt = Number(claims.exp ?? Date.now() / 1000 + 3600);
    this._tenantGuid = String(claims.TenantGuid);
    return this._tenantGuid;
  }

  async _request(method, path, { params, json, form, retryAuth = true } = {}) {
    if (!this._token || Date.now() / 1000 > this._expiresAt - TOKEN_REFRESH_MARGIN_SECONDS) {
      await this.login();
    }
    const url = new URL(`${this._baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
    const headers = { Authorization: `Bearer ${this._token}`, 'X-Tenant-Guid': String(this._tenantGuid) };
    // The API's CSRF guard requires this header on every state-changing request.
    if (method !== 'GET') headers['X-Requested-With'] = 'XMLHttpRequest';
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }

    const response = await this._send(url, { method, headers, body });
    if (response.status === 401 && retryAuth) {
      this._token = null;
      return this._request(method, path, { params, json, form, retryAuth: false });
    }
    if (response.status === 401) throw new UteamupAuthError(await errorMessage(response));
    if (response.status === 402) throw new UteamupPlanError(await errorMessage(response));
    if (response.status === 403) throw new UteamupForbiddenError(`${method} ${path} is not allowed for this API key`);
    if (response.status === 404) throw new UteamupNotFoundError(await errorMessage(response));
    if (response.status === 429) throw new UteamupRateLimitError(retryAfter(response));
    if (response.status >= 500) throw new UteamupConnectionError(`${method} ${path} failed with HTTP ${response.status}`);
    if (response.status >= 400) throw new UteamupApiError(await errorMessage(response));
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  getAnalyticsSummary(timeframe = '30d') {
    return this._request('GET', '/api/analytics/summary', { params: { timeframe } });
  }

  getStockAlertSummary() {
    return this._request('GET', '/api/stock/alerts/summary');
  }

  getIotAlerts() {
    return this._request('GET', '/api/iot/alerts', { params: { unacknowledgedOnly: 'true', page: 1, pageSize: 100 } });
  }

  getOpenWorkOrders() {
    return this._request('GET', '/api/workorder', { params: { openOnly: 'true', page: 1, pageSize: 100 } });
  }

  createWorkOrder(body) {
    return this._request('POST', '/api/workorder', { json: body });
  }

  setWorkOrderStatus(workOrderGuid, status, expectedStatus = null) {
    const params = expectedStatus === null ? undefined : { expectedStatus };
    return this._request('PUT', `/api/workorder/by-guid/${workOrderGuid}/status/${status}`, { params });
  }

  completeWorkOrder(workOrderGuid, notes = null) {
    return this._request('POST', `/api/workorder/by-guid/${workOrderGuid}/complete`, {
      json: notes ? { report: { description: notes } } : {},
    });
  }

  createQuickReport({ description, severity = null, assetGuid = null, tags = [] }) {
    // The endpoint only accepts multipart form data.
    const form = new FormData();
    form.append('Description', description);
    if (severity) form.append('Severity', severity.toUpperCase());
    if (assetGuid) form.append('AssetGuid', assetGuid);
    for (const tag of tags) form.append('Tags', tag);
    return this._request('POST', '/api/quickreport', { form });
  }

  setAssetState(assetGuid, state, reason = null) {
    const body = { toState: state };
    if (reason) body.reason = reason;
    return this._request('PUT', `/api/assetstate/asset/by-guid/${assetGuid}/operational`, { json: body });
  }

  runPmSchedule(scheduleGuid) {
    return this._request('POST', `/api/workordertemplate/schedules/${scheduleGuid}/runnow`);
  }

  recordMeterReading({ assetGuid, attributeDefinitionGuid, value, timestamp = null, notes = null }) {
    const body = { attributeDefinitionGuid, readingValue: value };
    if (timestamp) body.readingTimestamp = timestamp;
    if (notes) body.notes = notes;
    return this._request('POST', `/api/assets/${assetGuid}/meter-readings`, { json: body });
  }

  getJournal(journalGuid) {
    return this._request('GET', `/api/journal/by-guid/${journalGuid}`);
  }

  async appendJournalEntry(journalGuid, entry) {
    const current = await this.getJournal(journalGuid);
    const existing = (current.content || '').trimEnd();
    const line = `<p>${escapeHtml(entry)}</p>`;

    const form = new FormData();
    form.append('Title', String(current.title || ''));
    form.append('Content', existing ? `${existing}\n${line}` : line);
    form.append('JournalDate', String(current.journalDate || new Date().toISOString()));
    form.append('Priority', String(current.priority || 1));
    form.append('IsTemplate', current.isTemplate ? 'true' : 'false');
    form.append('IsArchived', current.isArchived ? 'true' : 'false');
    if (current.summary) form.append('Summary', String(current.summary));
    if (current.categoryGuid) form.append('CategoryGuid', String(current.categoryGuid));
    if (current.locationGuid) form.append('LocationGuid', String(current.locationGuid));
    if (current.locationFloorGuid) form.append('LocationFloorGuid', String(current.locationFloorGuid));
    return this._request('PUT', `/api/journal/by-guid/${journalGuid}`, { form });
  }

  listWebhookSubscriptions() {
    return this._request('GET', '/api/webhooks/subscriptions');
  }

  createWebhookSubscription({ name, url, secret, events }) {
    return this._request('POST', '/api/webhooks/subscriptions', {
      json: { name, url, secret, events, isActive: true },
    });
  }

  async deleteWebhookSubscription(subscriptionGuid) {
    await this._request('DELETE', `/api/webhooks/subscriptions/${subscriptionGuid}`);
  }
}

module.exports = {
  UteamupClient,
  UteamupError,
  UteamupConnectionError,
  UteamupAuthError,
  UteamupMcpKeyError,
  UteamupPlanError,
  UteamupForbiddenError,
  UteamupNotFoundError,
  UteamupRateLimitError,
  UteamupApiError,
};

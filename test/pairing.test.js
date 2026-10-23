'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { connect, credentials, errorKey, PairingError } = require('../lib/pairing');
const {
  UteamupAuthError,
  UteamupConnectionError,
  UteamupMcpKeyError,
  UteamupPlanError,
  UteamupRateLimitError,
} = require('../lib/UteamupClient');
const { API_KEY, API_SECRET, BASE, LOGIN, TENANT, fakeFetch, jsonResponse, loginOk } = require('./helpers');

const input = { baseUrl: `${BASE}/`, apiKey: ` ${API_KEY} `, apiSecret: API_SECRET };

describe('credentials', () => {
  it('trims the key and the trailing slash', () => {
    assert.deepEqual(credentials(input), { baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET });
  });

  for (const baseUrl of ['http://api.uteamup.com', 'not a url', 'https://user:pw@api.uteamup.com', 'javascript:alert(1)']) {
    it(`refuses ${baseUrl}`, () => {
      assert.throws(() => credentials({ ...input, baseUrl }), (err) => err.key === 'errors.invalidUrl');
    });
  }

  it('needs both the key and the secret', () => {
    assert.throws(() => credentials({ ...input, apiSecret: ' ' }), (err) => err.key === 'errors.missingKey');
  });
});

describe('connect', () => {
  it('returns a device keyed by the tenant with the credentials in its store', async () => {
    const device = await connect(input, { fetchImpl: fakeFetch({ [LOGIN]: loginOk() }) });
    assert.deepEqual(device, {
      name: `UteamUP ${TENANT.slice(0, 8)}`,
      data: { id: TENANT },
      store: { baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET },
    });
  });

  it('refuses a repair key from another company', async () => {
    const fetchImpl = fakeFetch({ [LOGIN]: loginOk('99999999-9999-4999-8999-999999999999') });
    await assert.rejects(connect(input, { fetchImpl, expectedTenantGuid: TENANT }), (err) => err.key === 'errors.wrongTenant');
  });

  it('does not contact UteamUP for an invalid address', async () => {
    const fetchImpl = fakeFetch({});
    await assert.rejects(connect({ ...input, baseUrl: 'http://x' }, { fetchImpl }), PairingError);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('surfaces a rejected key', async () => {
    const fetchImpl = fakeFetch({ [LOGIN]: jsonResponse(401, { message: 'bad' }) });
    await assert.rejects(connect(input, { fetchImpl }), UteamupAuthError);
  });
});

describe('errorKey', () => {
  it('explains each failure with its own message', () => {
    assert.equal(errorKey(new UteamupMcpKeyError('x')), 'errors.mcpKey');
    assert.equal(errorKey(new UteamupAuthError('x')), 'errors.auth');
    assert.equal(errorKey(new UteamupPlanError('x')), 'errors.plan');
    assert.equal(errorKey(new UteamupRateLimitError(5)), 'errors.rateLimited');
    assert.equal(errorKey(new UteamupConnectionError('x')), 'errors.connection');
    assert.equal(errorKey(new PairingError('errors.wrongTenant')), 'errors.wrongTenant');
    assert.equal(errorKey(new Error('x')), 'errors.unknown');
  });
});

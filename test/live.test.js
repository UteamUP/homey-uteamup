'use strict';

// Signs in to a real UteamUP API and reads the device values. Read-only. Runs only when
// UTEAMUP_LIVE_KEY_FILE names a JSON file with `base`, `apiKey` and `secret`; use the development
// API (https://devback.uteamup.com), never production.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { it } = require('node:test');
const { UteamupClient } = require('../lib/UteamupClient');
const { capabilityValues, fetchStatus } = require('../lib/status');

const keyFile = process.env.UTEAMUP_LIVE_KEY_FILE;

it('reads the device values from a real UteamUP API', { skip: !keyFile && 'UTEAMUP_LIVE_KEY_FILE is not set' }, async () => {
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  assert.notEqual(new URL(key.base).hostname, 'api.uteamup.com', 'use a development API');
  const client = new UteamupClient({ baseUrl: key.base, apiKey: key.apiKey, apiSecret: key.secret });
  assert.match(await client.login(), /^[0-9a-f-]{36}$/i);
  const status = await fetchStatus(client);
  const values = capabilityValues(status);
  for (const [capability, value] of Object.entries(values)) {
    assert.ok(value === null || ['number', 'boolean'].includes(typeof value), capability);
  }
});

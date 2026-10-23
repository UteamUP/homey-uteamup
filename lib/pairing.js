'use strict';

const {
  UteamupClient,
  UteamupAuthError,
  UteamupConnectionError,
  UteamupMcpKeyError,
  UteamupPlanError,
  UteamupRateLimitError,
} = require('./UteamupClient');

class PairingError extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
}

/** The locale key that explains a failed sign-in, matching the Home Assistant troubleshooting table. */
function errorKey(err) {
  if (err instanceof PairingError) return err.key;
  if (err instanceof UteamupMcpKeyError) return 'errors.mcpKey';
  if (err instanceof UteamupAuthError) return 'errors.auth';
  if (err instanceof UteamupPlanError) return 'errors.plan';
  if (err instanceof UteamupRateLimitError) return 'errors.rateLimited';
  if (err instanceof UteamupConnectionError) return 'errors.connection';
  return 'errors.unknown';
}

function credentials(input) {
  const baseUrl = String(input?.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(input?.apiKey ?? '').trim();
  const apiSecret = String(input?.apiSecret ?? '').trim();
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new PairingError('errors.invalidUrl');
  }
  // Tokens and secrets travel to this address, so plain HTTP is never accepted.
  if (url.protocol !== 'https:' || url.username || url.password) throw new PairingError('errors.invalidUrl');
  if (!apiKey || !apiSecret) throw new PairingError('errors.missingKey');
  return { baseUrl, apiKey, apiSecret };
}

/** Signs in with the entered key and returns what a new device stores. */
async function connect(input, { fetchImpl, expectedTenantGuid = null } = {}) {
  const store = credentials(input);
  const client = new UteamupClient({ ...store, tenantGuid: expectedTenantGuid, fetchImpl });
  const tenantGuid = await client.login();
  if (expectedTenantGuid && tenantGuid.toLowerCase() !== expectedTenantGuid.toLowerCase()) {
    throw new PairingError('errors.wrongTenant');
  }
  return {
    name: `UteamUP ${tenantGuid.slice(0, 8)}`,
    data: { id: tenantGuid },
    store,
  };
}

module.exports = { PairingError, connect, credentials, errorKey };

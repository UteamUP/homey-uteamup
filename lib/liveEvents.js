'use strict';

const crypto = require('node:crypto');

const SIGNATURE_HEADER = 'x-uteamup-signature';
const EVENT_HEADER = 'x-uteamup-event';
const DELIVERY_HEADER = 'x-uteamup-delivery';
const SEEN_DELIVERIES_LIMIT = 500;

function header(headers, name) {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

// System.Text.Json's default encoder, which UteamUP uses for webhook payloads, escapes these
// characters and everything outside printable ASCII as \uXXXX with upper-case hex.
const SHORT_ESCAPES = { '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\\': '\\\\' };
const ESCAPED = new Set(['"', '&', "'", '+', '<', '>', '`']);

function encodeString(value) {
  let out = '"';
  for (const char of value) {
    if (SHORT_ESCAPES[char]) {
      out += SHORT_ESCAPES[char];
      continue;
    }
    const code = char.codePointAt(0);
    if (code < 0x20 || code > 0x7e || ESCAPED.has(char)) {
      for (let i = 0; i < char.length; i += 1) {
        out += `\\u${char.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`;
      }
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

/**
 * Re-creates the bytes UteamUP signed from a body that arrived already parsed. It matches for
 * ordinary payloads; numbers written with trailing zeros or exponents can differ, and then the
 * delivery simply fails verification.
 */
function serializeLikeUteamup(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return encodeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(serializeLikeUteamup).join(',')}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${encodeString(key)}:${serializeLikeUteamup(item)}`)
    .join(',')}}`;
}

function rawBody(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return serializeLikeUteamup(body);
  return null;
}

/** UteamUP signs the raw body with HMAC-SHA256 and sends `sha256=<lower-case hex>`. */
function signatureValid(secret, raw, signature) {
  if (!secret || raw === null || typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex'));
  const given = Buffer.from(signature.slice('sha256='.length));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function parse(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Checks one forwarded delivery. Only a verified delivery may carry data into Flows; an
 * unverified one is reported so the device can at most refresh through its authenticated API.
 */
function readDelivery(message, secret) {
  const raw = rawBody(message?.body);
  if (!signatureValid(secret, raw, header(message?.headers, SIGNATURE_HEADER))) {
    return { verified: false };
  }
  const payload = parse(raw) ?? {};
  return {
    verified: true,
    deliveryId: header(message.headers, DELIVERY_HEADER) ?? '',
    event: String(payload.event || header(message.headers, EVENT_HEADER) || ''),
    data: payload.data ?? null,
  };
}

/** Remembers recent delivery ids so a retried delivery fires its Flow only once. */
class DeliveryDeduper {
  constructor(limit = SEEN_DELIVERIES_LIMIT) {
    this._limit = limit;
    this._seen = new Set();
  }

  isNew(deliveryId) {
    if (!deliveryId) return true;
    if (this._seen.has(deliveryId)) return false;
    this._seen.add(deliveryId);
    if (this._seen.size > this._limit) this._seen.delete(this._seen.values().next().value);
    return true;
  }
}

/** A short, human-readable title for the Flow token, from the fields UteamUP payloads carry. */
function deliveryTitle(data) {
  if (!data || typeof data !== 'object') return '';
  return String(data.title || data.name || data.ticketId || data.description || '').slice(0, 200);
}

function webhookUrl(webhookId, homeyId, tenantGuid) {
  const url = new URL(`https://webhooks.athom.com/webhook/${encodeURIComponent(webhookId)}`);
  url.searchParams.set('homey', homeyId);
  url.searchParams.set('tenant', tenantGuid);
  return url.toString();
}

module.exports = {
  DeliveryDeduper,
  deliveryTitle,
  readDelivery,
  serializeLikeUteamup,
  signatureValid,
  webhookUrl,
};

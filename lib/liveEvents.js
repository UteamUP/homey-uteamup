'use strict';

const crypto = require('node:crypto');

const SIGNATURE_HEADER = 'x-uteamup-signature';
const EVENT_HEADER = 'x-uteamup-event';
const DELIVERY_HEADER = 'x-uteamup-delivery';

// UteamUP stamps every delivery with the moment it was dispatched and retries a failed delivery
// after 30 s and then after 5 min, so the oldest delivery it still considers deliverable is
// 5 min 30 s old. The window stays above that horizon, otherwise a receiver that was briefly
// unreachable would lose the last attempt, while a captured delivery can no longer be replayed
// for ever.
const MAX_DELIVERY_AGE_MS = 10 * 60 * 1000;

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

const MAX_SERIALIZE_DEPTH = 32;

/**
 * Re-creates the bytes UteamUP signed from a body that arrived already parsed. It matches for
 * ordinary payloads; numbers written with trailing zeros or exponents can differ, and then the
 * delivery simply fails verification.
 */
function serializeLikeUteamup(value, depth = 0) {
  if (depth > MAX_SERIALIZE_DEPTH) {
    throw new RangeError('Webhook payload exceeds maximum nesting depth');
  }
  if (value === null) return 'null';
  if (typeof value === 'string') return encodeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => serializeLikeUteamup(item, depth + 1)).join(',')}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${encodeString(key)}:${serializeLikeUteamup(item, depth + 1)}`)
    .join(',')}}`;
}

function rawBody(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    try {
      return serializeLikeUteamup(body);
    } catch {
      return null;
    }
  }
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
 * Reads the dispatch time UteamUP signs into the delivery envelope and returns it as epoch
 * milliseconds, or null when the value is not a usable timestamp. System.Text.Json writes the UTC
 * time with up to seven fractional digits and a trailing Z, which Date.parse alone does not
 * accept on every engine.
 */
function deliveryTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const base = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(base)) return null;
  const fraction = match[2] ? Math.round(Number(`0.${match[2]}`) * 1000) : 0;
  return base + fraction;
}

/**
 * Checks one forwarded delivery. Only a verified delivery may carry data into Flows; an
 * unverified one is reported so the device can at most refresh through its authenticated API.
 */
function readDelivery(message, secret, now = Date.now()) {
  const raw = rawBody(message?.body);
  if (!signatureValid(secret, raw, header(message?.headers, SIGNATURE_HEADER))) {
    return { verified: false, reason: 'signature' };
  }
  const payload = parse(raw) ?? {};
  const payloadEvent = typeof payload.event === 'string' ? payload.event.trim() : '';
  const headerEvent = header(message.headers, EVENT_HEADER);
  if (!payloadEvent || (headerEvent && payloadEvent !== String(headerEvent))) {
    return { verified: false, reason: 'event' };
  }
  const timestamp = deliveryTimestamp(payload.timestamp);
  if (timestamp === null) {
    return { verified: false, reason: 'timestamp' };
  }
  // Without this a captured delivery could be replayed for ever.
  if (Math.abs(now - timestamp) > MAX_DELIVERY_AGE_MS) {
    return { verified: false, reason: 'stale' };
  }
  const bodyDigest = `sha256:${crypto.createHash('sha256').update(raw, 'utf8').digest('hex')}`;
  return {
    verified: true,
    deliveryId: header(message.headers, DELIVERY_HEADER) ?? '',
    bodyDigest,
    event: payloadEvent,
    data: payload.data ?? null,
  };
}

/**
 * Remembers recent delivery ids so a retried delivery fires its Flow only once. Entries expire by
 * age and not by count: a busy tenant must not push an unexpired delivery out of the window and
 * make a captured copy of it replayable again.
 */
class DeliveryDeduper {
  constructor(maxAgeMs = MAX_DELIVERY_AGE_MS) {
    this._maxAgeMs = maxAgeMs;
    this._seenDeliveries = new Map();
    this._seenDigests = new Map();
  }

  _expire(seen, now) {
    const cutoff = now - this._maxAgeMs;
    for (const [key, seenAt] of seen) {
      if (seenAt < cutoff) seen.delete(key);
    }
  }

  isNew(deliveryId, bodyDigest = '', now = Date.now()) {
    if (!deliveryId && !bodyDigest) return true;
    this._expire(this._seenDeliveries, now);
    this._expire(this._seenDigests, now);
    if ((deliveryId && this._seenDeliveries.has(deliveryId)) || (bodyDigest && this._seenDigests.has(bodyDigest))) {
      return false;
    }
    if (deliveryId) this._seenDeliveries.set(deliveryId, now);
    if (bodyDigest) this._seenDigests.set(bodyDigest, now);
    return true;
  }
}

/** A short, human-readable title for the Flow token, from the fields UteamUP payloads carry. */
function deliveryTitle(data) {
  if (!data || typeof data !== 'object') return '';
  return String(data.title || data.name || data.ticketId || data.description || '').slice(0, 200);
}

function webhookUrl(webhookId, homeyId, tenantGuid) {
  const url = new URL(`https://webhooks.athom.com/webhook/${encodeURIComponent(webhookId)}/`);
  url.searchParams.set('homey', homeyId);
  url.searchParams.set('tenant', tenantGuid);
  return url.toString();
}

module.exports = {
  DeliveryDeduper,
  deliveryTimestamp,
  deliveryTitle,
  readDelivery,
  serializeLikeUteamup,
  signatureValid,
  webhookUrl,
};

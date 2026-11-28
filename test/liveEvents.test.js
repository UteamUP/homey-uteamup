'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, it } = require('node:test');
const {
  DeliveryDeduper,
  deliveryTimestamp,
  deliveryTitle,
  readDelivery,
  serializeLikeUteamup,
  signatureValid,
  webhookUrl,
} = require('../lib/liveEvents');

const SECRET = 'c'.repeat(64);
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;

// What UteamUP's System.Text.Json (default encoder, camelCase, nulls omitted) writes for an event.
const UTEAMUP_BODY = '{"event":"workorder.created","tenantId":"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",'
  + '"timestamp":"2026-10-23T08:00:00.1234567Z","data":{"guid":"11111111-1111-4111-8111-111111111111",'
  + '"name":"Pump \\u0026 seal \\u003C1 bar\\u003E","description":"Say \\u0022hi\\u0022 \\u2013 it\\u0027s Hitast\\u00FDring",'
  + '"path":"C:\\\\pumps/a\\nb","priority":3,"cost":12.5,"isActive":true,"tags":["leak","\\uD83D\\uDCA7"]}}';

// The moment UteamUP signed that body, so the delivery is inside the freshness window.
const NOW = Date.parse('2026-10-23T08:00:00.123Z');

describe('serializeLikeUteamup', () => {
  it('re-creates the exact bytes UteamUP signed from the parsed body', () => {
    assert.equal(serializeLikeUteamup(JSON.parse(UTEAMUP_BODY)), UTEAMUP_BODY);
  });
});

describe('signatureValid', () => {
  it('accepts the right signature and rejects anything else', () => {
    assert.equal(signatureValid(SECRET, UTEAMUP_BODY, sign(UTEAMUP_BODY)), true);
    assert.equal(signatureValid(SECRET, `${UTEAMUP_BODY} `, sign(UTEAMUP_BODY)), false);
    assert.equal(signatureValid(SECRET, UTEAMUP_BODY, sign(UTEAMUP_BODY, 'd'.repeat(64))), false);
    assert.equal(signatureValid(SECRET, UTEAMUP_BODY, sign(UTEAMUP_BODY).replace('sha256=', '')), false);
    assert.equal(signatureValid(SECRET, UTEAMUP_BODY, 'sha256=00'), false);
    assert.equal(signatureValid(SECRET, UTEAMUP_BODY, undefined), false);
    assert.equal(signatureValid(undefined, UTEAMUP_BODY, sign(UTEAMUP_BODY, '')), false, 'no stored secret never verifies');
  });
});

describe('readDelivery', () => {
  const headers = (raw) => ({ 'X-UteamUP-Signature': sign(raw), 'x-uteamup-delivery': 'd-1', 'X-UteamUP-Event': 'workorder.created' });

  it('verifies a parsed body, case-insensitive headers included', () => {
    const delivery = readDelivery({ headers: headers(UTEAMUP_BODY), body: JSON.parse(UTEAMUP_BODY) }, SECRET, NOW);
    assert.equal(delivery.verified, true);
    assert.equal(delivery.event, 'workorder.created');
    assert.equal(delivery.deliveryId, 'd-1');
    assert.equal(delivery.data.name, 'Pump & seal <1 bar>');
  });

  it('verifies a raw string or Buffer body', () => {
    assert.equal(readDelivery({ headers: headers(UTEAMUP_BODY), body: UTEAMUP_BODY }, SECRET, NOW).verified, true);
    assert.equal(readDelivery({ headers: headers(UTEAMUP_BODY), body: Buffer.from(UTEAMUP_BODY) }, SECRET, NOW).verified, true);
  });

  it('rejects a tampered body and carries none of its data', () => {
    const tampered = JSON.parse(UTEAMUP_BODY);
    tampered.data.name = 'Open the door';
    const delivery = readDelivery({ headers: headers(UTEAMUP_BODY), body: tampered }, SECRET, NOW);
    assert.deepEqual(delivery, { verified: false, reason: 'signature' });
  });

  it('rejects a delivery without a signature or a body', () => {
    assert.deepEqual(readDelivery({ headers: {}, body: JSON.parse(UTEAMUP_BODY) }, SECRET, NOW), { verified: false, reason: 'signature' });
    assert.deepEqual(readDelivery({ headers: headers(''), body: undefined }, SECRET, NOW), { verified: false, reason: 'signature' });
    assert.deepEqual(readDelivery(undefined, SECRET, NOW), { verified: false, reason: 'signature' });
  });

  it('does not verify a decimal written with trailing zeros, which re-serializes differently', () => {
    const raw = '{"event":"a","data":{"cost":12.50}}';
    assert.equal(readDelivery({ headers: headers(raw), body: JSON.parse(raw) }, SECRET, NOW).verified, false);
  });

  it('rejects mismatched event header or excessively nested objects', () => {
    assert.deepEqual(
      readDelivery(
        {
          headers: { ...headers(UTEAMUP_BODY), 'X-UteamUP-Event': 'test.ping' },
          body: JSON.parse(UTEAMUP_BODY),
        },
        SECRET,
        NOW,
      ),
      { verified: false, reason: 'event' },
    );
    let deep = { a: 1 };
    for (let i = 0; i < 40; i += 1) deep = { child: deep };
    assert.deepEqual(
      readDelivery({ headers: headers(UTEAMUP_BODY), body: deep }, SECRET, NOW),
      { verified: false, reason: 'signature' },
    );
    const missingEventRaw = '{"data":{"guid":"11111111-1111-4111-8111-111111111111"}}';
    assert.deepEqual(
      readDelivery(
        {
          headers: { 'X-UteamUP-Signature': sign(missingEventRaw), 'X-UteamUP-Event': 'test.ping' },
          body: missingEventRaw,
        },
        SECRET,
        NOW,
      ),
      { verified: false, reason: 'event' },
    );
  });

  it('refuses a captured delivery once its signed dispatch time is outside the window', () => {
    const stale = { headers: headers(UTEAMUP_BODY), body: JSON.parse(UTEAMUP_BODY) };
    assert.deepEqual(readDelivery(stale, SECRET, NOW + 11 * 60 * 1000), { verified: false, reason: 'stale' });
    assert.deepEqual(readDelivery(stale, SECRET, NOW - 11 * 60 * 1000), { verified: false, reason: 'stale' });
  });

  it('still accepts the last legitimate retry of a delivery', () => {
    // UteamUP retries a failed delivery after 30 s and then after 5 min, so the last attempt of a
    // delivery is 5 min 30 s old and has to stay inside the window.
    const late = { headers: headers(UTEAMUP_BODY), body: JSON.parse(UTEAMUP_BODY) };
    assert.equal(readDelivery(late, SECRET, NOW + 5 * 60 * 1000 + 30 * 1000).verified, true);
  });

  it('refuses a delivery without a signed dispatch time', () => {
    const raw = '{"event":"workorder.created","data":{"guid":"11111111-1111-4111-8111-111111111111"}}';
    assert.deepEqual(
      readDelivery(
        { headers: { 'X-UteamUP-Signature': sign(raw), 'X-UteamUP-Event': 'workorder.created' }, body: raw },
        SECRET,
        NOW,
      ),
      { verified: false, reason: 'timestamp' },
    );
  });
});

describe('DeliveryDeduper', () => {
  it('lets each delivery id through once', () => {
    const deduper = new DeliveryDeduper();
    assert.equal(deduper.isNew('a'), true);
    assert.equal(deduper.isNew('a'), false);
    assert.equal(deduper.isNew('b'), true);
    assert.equal(deduper.isNew(''), true, 'deliveries without an id are never dropped');
  });

  it('keeps a delivery for the whole window and forgets it afterwards', () => {
    const deduper = new DeliveryDeduper();
    const start = 1_000_000;
    assert.equal(deduper.isNew('a', '', start), true);
    // A busy tenant must not push an unexpired delivery out of the window.
    for (let index = 0; index < 1000; index += 1) {
      deduper.isNew(`d-${index}`, '', start + index);
    }
    assert.equal(deduper.isNew('a', '', start + 1000), false);
    assert.equal(deduper.isNew('a', '', start + 11 * 60 * 1000), true);
  });
});

describe('helpers', () => {
  it('reads the dispatch time UteamUP signs into the envelope', () => {
    assert.equal(deliveryTimestamp('2026-10-23T08:00:00.1234567Z'), Date.parse('2026-10-23T08:00:00.123Z'));
    assert.equal(deliveryTimestamp('2026-10-23T08:00:00Z'), Date.parse('2026-10-23T08:00:00Z'));
    assert.equal(deliveryTimestamp('2026-10-23T08:00:00+00:00'), Date.parse('2026-10-23T08:00:00Z'));
    assert.equal(deliveryTimestamp('2026-10-23 08:00:00'), null);
    assert.equal(deliveryTimestamp('not a date'), null);
    assert.equal(deliveryTimestamp(undefined), null);
    assert.equal(deliveryTimestamp(1737561600000), null);
  });

  it('builds the forwarder URL with Homey and tenant', () => {
    assert.equal(
      webhookUrl('wh 1', 'homey-1', 'tenant-1'),
      'https://webhooks.athom.com/webhook/wh%201/?homey=homey-1&tenant=tenant-1',
    );
  });

  it('picks a short title from the payload', () => {
    assert.equal(deliveryTitle({ ticketId: 'WO-1', name: 'Pump' }), 'Pump');
    assert.equal(deliveryTitle({ title: 'x'.repeat(300) }).length, 200);
    assert.equal(deliveryTitle(null), '');
  });
});

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, it } = require('node:test');
const {
  DeliveryDeduper,
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
    const delivery = readDelivery({ headers: headers(UTEAMUP_BODY), body: JSON.parse(UTEAMUP_BODY) }, SECRET);
    assert.equal(delivery.verified, true);
    assert.equal(delivery.event, 'workorder.created');
    assert.equal(delivery.deliveryId, 'd-1');
    assert.equal(delivery.data.name, 'Pump & seal <1 bar>');
  });

  it('verifies a raw string or Buffer body', () => {
    assert.equal(readDelivery({ headers: headers(UTEAMUP_BODY), body: UTEAMUP_BODY }, SECRET).verified, true);
    assert.equal(readDelivery({ headers: headers(UTEAMUP_BODY), body: Buffer.from(UTEAMUP_BODY) }, SECRET).verified, true);
  });

  it('rejects a tampered body and carries none of its data', () => {
    const tampered = JSON.parse(UTEAMUP_BODY);
    tampered.data.name = 'Open the door';
    const delivery = readDelivery({ headers: headers(UTEAMUP_BODY), body: tampered }, SECRET);
    assert.deepEqual(delivery, { verified: false });
  });

  it('rejects a delivery without a signature or a body', () => {
    assert.deepEqual(readDelivery({ headers: {}, body: JSON.parse(UTEAMUP_BODY) }, SECRET), { verified: false });
    assert.deepEqual(readDelivery({ headers: headers(''), body: undefined }, SECRET), { verified: false });
    assert.deepEqual(readDelivery(undefined, SECRET), { verified: false });
  });

  it('does not verify a decimal written with trailing zeros, which re-serializes differently', () => {
    const raw = '{"event":"a","data":{"cost":12.50}}';
    assert.equal(readDelivery({ headers: headers(raw), body: JSON.parse(raw) }, SECRET).verified, false);
  });
});

describe('DeliveryDeduper', () => {
  it('lets each delivery id through once and forgets the oldest past the limit', () => {
    const deduper = new DeliveryDeduper(2);
    assert.equal(deduper.isNew('a'), true);
    assert.equal(deduper.isNew('a'), false);
    assert.equal(deduper.isNew('b'), true);
    assert.equal(deduper.isNew('c'), true);
    assert.equal(deduper.isNew('a'), true);
    assert.equal(deduper.isNew(''), true, 'deliveries without an id are never dropped');
  });
});

describe('helpers', () => {
  it('builds the forwarder URL with Homey and tenant', () => {
    assert.equal(
      webhookUrl('wh 1', 'homey-1', 'tenant-1'),
      'https://webhooks.athom.com/webhook/wh%201?homey=homey-1&tenant=tenant-1',
    );
  });

  it('picks a short title from the payload', () => {
    assert.equal(deliveryTitle({ ticketId: 'WO-1', name: 'Pump' }), 'Pump');
    assert.equal(deliveryTitle({ title: 'x'.repeat(300) }).length, 200);
    assert.equal(deliveryTitle(null), '');
  });
});

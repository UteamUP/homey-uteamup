'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { ACTIONS } = require('../lib/actions');
const { CAPABILITIES } = require('../lib/status');

const root = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const flow = read('drivers/company/driver.flow.compose.json');
const driver = read('drivers/company/driver.compose.json');
const app = read('.homeycompose/app.json');
const locales = { en: read('locales/en.json'), is: read('locales/is.json') };

function keys(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (
    typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  ));
}

describe('manifest', () => {
  it('has one Flow action per action handler', () => {
    assert.deepEqual(flow.actions.map((card) => card.id).sort(), Object.keys(ACTIONS).sort());
  });

  it('declares every capability the status code sets', () => {
    assert.deepEqual([...driver.capabilities].sort(), Object.keys(CAPABILITIES).sort());
    for (const capability of driver.capabilities) {
      assert.ok(fs.existsSync(path.join(root, '.homeycompose/capabilities', `${capability}.json`)), capability);
    }
  });

  it('stays publishable for Homey Pro and ready for Cloud', () => {
    assert.deepEqual(app.platforms, ['local']);
    assert.deepEqual(driver.platforms, app.platforms);
    assert.deepEqual(driver.connectivity, ['cloud']);
    for (const card of [...flow.triggers, ...flow.conditions, ...flow.actions]) {
      assert.deepEqual(card.platforms, app.platforms, card.id);
    }
    assert.deepEqual(app.permissions, []);
  });

  it('translates every text into Icelandic as well as English', () => {
    const texts = [];
    const collect = (value) => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        if (typeof value.en === 'string') texts.push(value);
        else Object.values(value).forEach(collect);
      }
    };
    collect([flow, driver, app]);
    for (const file of fs.readdirSync(path.join(root, '.homeycompose/capabilities'))) {
      collect(read(`.homeycompose/capabilities/${file}`));
    }
    for (const text of texts) assert.equal(typeof text.is, 'string', `missing Icelandic for "${text.en}"`);
    assert.deepEqual(keys(locales.is).sort(), keys(locales.en).sort());
  });

  it('has a locale entry for every message key the code uses', () => {
    const sources = ['lib/pairing.js', 'drivers/company/device.js', 'drivers/company/pair/login.html']
      .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
      .join('\n');
    const used = new Set([...sources.matchAll(/'((?:errors|pair)\.[A-Za-z.]+)'/g)].map((match) => match[1]));
    for (const match of sources.matchAll(/data-i18n="([^"]+)"/g)) used.add(match[1]);
    const known = new Set(keys(locales.en));
    for (const key of used) assert.ok(known.has(key), key);
  });
});

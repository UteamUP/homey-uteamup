'use strict';

/**
 * Just enough of the Homey Apps SDK for the device and driver to run under node:test. It replaces
 * `require('homey')`, which on a real Homey is the SDK and in node_modules is the CLI.
 */

class Device {
  constructor({ data, store = {}, settings = {}, driver, app, name = 'UteamUP 0a1b2c3d' }) {
    this._data = data;
    this._store = { ...store };
    this._settings = { ...settings };
    this._capabilities = {};
    this._name = name;
    this.available = true;
    this.unavailableMessage = null;
    this.warning = null;
    this.logs = [];
    this.driver = driver;
    this.homey = {
      app,
      __: (key) => `t:${key}`,
      setInterval: (fn, ms) => ({ fn, ms }),
      clearInterval: () => {},
      setTimeout: (fn) => fn(),
    };
    this.error = (...args) => this.logs.push(['error', ...args]);
  }

  log(...args) { this.logs.push(args); }

  getData() { return this._data; }

  getName() { return this._name; }

  getStoreValue(key) { return this._store[key]; }

  async setStoreValue(key, value) { this._store[key] = value; }

  async unsetStoreValue(key) { delete this._store[key]; }

  getSetting(key) { return this._settings[key]; }

  getCapabilityValue(capability) { return this._capabilities[capability] ?? null; }

  async setCapabilityValue(capability, value) { this._capabilities[capability] = value; }

  async setAvailable() {
    this.available = true;
    this.unavailableMessage = null;
  }

  async setUnavailable(message) {
    this.available = false;
    this.unavailableMessage = message;
  }

  async setWarning(message) { this.warning = message; }

  async unsetWarning() { this.warning = null; }
}

class Driver {}
class App {}

function installHomeyStub() {
  const id = require.resolve('homey');
  require.cache[id] = { id, filename: id, loaded: true, exports: { Device, Driver, App, env: {} } };
}

/** A driver double that records which Flow triggers fired. */
function recordingDriver() {
  const fired = [];
  return {
    fired,
    triggerEvent: async (device, tokens, state) => fired.push(['event', tokens, state]),
    triggerOverdueChanged: async (device, overdue) => fired.push(['overdue', overdue]),
    triggerIotAlertStarted: async (device, count) => fired.push(['iot', count]),
    triggerCriticalStockStarted: async () => fired.push(['stock']),
  };
}

module.exports = { installHomeyStub, recordingDriver };

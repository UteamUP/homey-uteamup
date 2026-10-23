'use strict';

const {
  UteamupAuthError,
  UteamupForbiddenError,
  UteamupNotFoundError,
} = require('./UteamupClient');

const SECTIONS = {
  analytics: (client) => client.getAnalyticsSummary(),
  stockAlerts: (client) => client.getStockAlertSummary(),
  iotAlerts: (client) => client.getIotAlerts(),
  openWorkOrders: (client) => client.getOpenWorkOrders(),
};

// Each capability reads one section; a section the key may not read leaves its capabilities empty.
const CAPABILITIES = {
  uteamup_open_workorders: ['analytics', (data) => data.workorders?.open],
  uteamup_in_progress_workorders: ['analytics', (data) => data.workorders?.inProgress],
  uteamup_on_hold_workorders: ['analytics', (data) => data.workorders?.onHold],
  uteamup_overdue_workorders: ['analytics', (data) => data.workorders?.overdue],
  uteamup_stock_alerts: ['stockAlerts', (data) => data.totalActive],
  uteamup_critical_stock: ['stockAlerts', (data) => (data.criticalCount ?? 0) > 0],
  uteamup_iot_alerts: ['iotAlerts', (data) => data.totalItems],
  uteamup_iot_alert_active: ['iotAlerts', (data) => (data.totalItems ?? 0) > 0],
};

/**
 * Fetches every section in parallel. A 403 or 404 only marks that section denied; a rejected key
 * throws so the device can ask for a new one; any other failure throws for a later retry.
 */
async function fetchStatus(client) {
  const names = Object.keys(SECTIONS);
  const results = await Promise.allSettled(names.map((name) => SECTIONS[name](client)));
  const status = { sections: {}, denied: new Set() };
  for (const [index, result] of results.entries()) {
    const name = names[index];
    if (result.status === 'fulfilled') {
      status.sections[name] = result.value;
      continue;
    }
    if (result.reason instanceof UteamupAuthError) throw result.reason;
    if (result.reason instanceof UteamupForbiddenError || result.reason instanceof UteamupNotFoundError) {
      status.denied.add(name);
      continue;
    }
    throw result.reason;
  }
  return status;
}

/** Capability values for one status; null means the key may not read that value. */
function capabilityValues(status) {
  const values = {};
  for (const [capability, [section, read]] of Object.entries(CAPABILITIES)) {
    const data = status.sections[section];
    const value = data ? read(data) : undefined;
    values[capability] = value === undefined ? null : value;
  }
  return values;
}

/** Open work orders, optionally only those whose primary assignee is the given user GUID. */
function openWorkOrders(status, assigneeGuid = '') {
  const items = status.sections.openWorkOrders?.items ?? [];
  if (!assigneeGuid) return items;
  const wanted = assigneeGuid.toLowerCase();
  return items.filter((item) => String(item.primaryAssigneeGuid ?? '').toLowerCase() === wanted);
}

module.exports = { CAPABILITIES, fetchStatus, capabilityValues, openWorkOrders };

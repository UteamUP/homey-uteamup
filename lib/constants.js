'use strict';

const DEFAULT_BASE_URL = 'https://api.uteamup.com';

const DEFAULT_POLL_SECONDS = 120;
const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 3600;

// UteamUP work order status ids (Models/WorkorderStatus.cs), as in the Home Assistant integration.
const WORK_ORDER_STATUSES = {
  not_started: 0,
  pending: 1,
  in_progress: 2,
  on_hold: 3,
  completed: 4,
  cancelled: 5,
};

// Asset operational states accepted as a target (Enums/AssetStateEnums.cs, camelCase on the wire).
const ASSET_STATES = {
  online: 'online',
  offline: 'offline',
  standby: 'standby',
  under_maintenance: 'underMaintenance',
  degraded: 'degraded',
  lost: 'lost',
  stolen: 'stolen',
  in_transit: 'inTransit',
  in_storage: 'inStorage',
};

const QUICK_REPORT_SEVERITIES = ['low', 'medium', 'high', 'critical'];

// The same events the Home Assistant integration subscribes to.
const WEBHOOK_EVENTS = [
  'workorder.created',
  'workorder.updated',
  'workorder.assigned',
  'workorder.completed',
  'asset.created',
  'asset.updated',
  'iot.alert.created',
  'iot.alert.resolved',
  'iot.device.online',
  'iot.device.offline',
  'stock.alert.created',
  'part.stock_low',
];

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_POLL_SECONDS,
  MIN_POLL_SECONDS,
  MAX_POLL_SECONDS,
  WORK_ORDER_STATUSES,
  ASSET_STATES,
  QUICK_REPORT_SEVERITIES,
  WEBHOOK_EVENTS,
};

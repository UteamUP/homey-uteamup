'use strict';

const { WORK_ORDER_STATUSES, ASSET_STATES, QUICK_REPORT_SEVERITIES } = require('./constants');

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ActionInputError extends Error {}

function guid(value, field) {
  const text = String(value ?? '').trim();
  if (!GUID_PATTERN.test(text)) throw new ActionInputError(`${field} must be a UteamUP GUID`);
  return text;
}

function optionalGuid(value, field) {
  return value === undefined || value === null || String(value).trim() === '' ? null : guid(value, field);
}

function text(value, field, { min = 0, max }) {
  const result = String(value ?? '').trim();
  if (result.length < min) throw new ActionInputError(`${field} is required`);
  if (max && result.length > max) throw new ActionInputError(`${field} may be at most ${max} characters`);
  return result;
}

function optionalText(value, field, max) {
  const result = text(value, field, { max });
  return result === '' ? null : result;
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ActionInputError(`${field} must be one of ${allowed.join(', ')}`);
  return value;
}

/** Autocomplete values arrive as objects; typed values and tokens arrive as strings. */
function workOrderGuid(args) {
  const value = args.work_order && typeof args.work_order === 'object' ? args.work_order.id : args.work_order;
  return guid(value, 'Work order');
}

/**
 * One handler per Flow action, each the counterpart of a Home Assistant `uteamup.*` action with the
 * same limits. Each returns the tokens the Flow card exposes.
 */
const ACTIONS = {
  async create_work_order(client, args, now = new Date()) {
    const priority = Number(args.priority ?? 2);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new ActionInputError('Priority must be a whole number from 1 to 5');
    }
    const dueDays = Number(args.due_in_days ?? 1);
    if (!Number.isFinite(dueDays) || dueDays < 0 || dueDays > 3650) {
      throw new ActionInputError('Due in days must be between 0 and 3650');
    }
    const body = {
      name: text(args.name, 'Name', { min: 1, max: 200 }),
      priority,
      startDate: now.toISOString(),
      dueDate: new Date(now.getTime() + dueDays * 86_400_000).toISOString(),
    };
    const description = optionalText(args.description, 'Description');
    if (description) body.description = description;
    const assetGuid = optionalGuid(args.asset_guid, 'Asset');
    if (assetGuid) body.assetGuids = [assetGuid];
    const assigneeGuid = optionalGuid(args.assignee_guid, 'Assignee');
    if (assigneeGuid) body.primaryAssigneeGuid = assigneeGuid;
    const created = await client.createWorkOrder(body);
    return { work_order_guid: created?.guid ?? '', ticket_id: created?.ticketId ?? '' };
  },

  async create_quick_report(client, args) {
    const tags = String(args.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const created = await client.createQuickReport({
      description: text(args.description, 'Description', { min: 1, max: 2000 }),
      severity: args.severity ? oneOf(args.severity, QUICK_REPORT_SEVERITIES, 'Severity') : null,
      assetGuid: optionalGuid(args.asset_guid, 'Asset'),
      tags,
    });
    return { work_order_guid: created?.workorderGuid ?? '', ticket_id: created?.ticketId ?? '' };
  },

  async set_work_order_status(client, args) {
    const status = oneOf(args.status, Object.keys(WORK_ORDER_STATUSES), 'Status');
    const expected = args.expected_status && args.expected_status !== 'any'
      ? WORK_ORDER_STATUSES[oneOf(args.expected_status, Object.keys(WORK_ORDER_STATUSES), 'Expected status')]
      : null;
    await client.setWorkOrderStatus(workOrderGuid(args), WORK_ORDER_STATUSES[status], expected);
    return {};
  },

  async complete_work_order(client, args) {
    await client.completeWorkOrder(workOrderGuid(args), optionalText(args.notes, 'Notes', 2000));
    return {};
  },

  async set_asset_state(client, args) {
    const state = oneOf(args.state, Object.keys(ASSET_STATES), 'State');
    await client.setAssetState(guid(args.asset_guid, 'Asset'), ASSET_STATES[state], optionalText(args.reason, 'Reason', 1000));
    return {};
  },

  async run_pm_schedule(client, args) {
    const created = await client.runPmSchedule(guid(args.schedule_guid, 'Schedule'));
    return { work_order_guid: created?.guid ?? '', ticket_id: created?.ticketId ?? '' };
  },

  async record_meter_reading(client, args) {
    const value = Number(args.value);
    if (!Number.isFinite(value)) throw new ActionInputError('Value must be a number');
    await client.recordMeterReading({
      assetGuid: guid(args.asset_guid, 'Asset'),
      attributeDefinitionGuid: guid(args.attribute_definition_guid, 'Meter'),
      value,
      notes: optionalText(args.notes, 'Notes', 1000),
    });
    return {};
  },

  async append_journal_entry(client, args) {
    await client.appendJournalEntry(guid(args.journal_guid, 'Journal'), text(args.entry, 'Entry', { min: 1, max: 2000 }));
    return {};
  },
};

module.exports = { ACTIONS, ActionInputError, GUID_PATTERN };

'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { ACTIONS, ActionInputError } = require('../lib/actions');
const { ASSET_GUID, ATTRIBUTE_GUID, WORK_ORDER_GUID } = require('./helpers');

/** A client double that records each call and answers with `result`. */
function recorder(result = {}) {
  const calls = [];
  return new Proxy(
    { calls },
    {
      get(target, name) {
        if (name === 'calls') return calls;
        return async (...args) => {
          calls.push([name, ...args]);
          return result;
        };
      },
    },
  );
}

const NOW = new Date('2026-10-23T08:00:00.000Z');

describe('create_work_order', () => {
  it('builds the same body as the Home Assistant action', async () => {
    const client = recorder({ guid: WORK_ORDER_GUID, ticketId: 'WO-1' });
    const tokens = await ACTIONS.create_work_order(client, {
      name: ' Check boiler ',
      priority: 3,
      due_in_days: 2,
      description: 'Noise',
      asset_guid: ASSET_GUID,
      assignee_guid: '',
    }, NOW);
    assert.deepEqual(client.calls, [['createWorkOrder', {
      name: 'Check boiler',
      priority: 3,
      startDate: '2026-10-23T08:00:00.000Z',
      dueDate: '2026-10-25T08:00:00.000Z',
      description: 'Noise',
      assetGuids: [ASSET_GUID],
    }]]);
    assert.deepEqual(tokens, { work_order_guid: WORK_ORDER_GUID, ticket_id: 'WO-1' });
  });

  it('defaults to priority 2 due tomorrow', async () => {
    const client = recorder();
    await ACTIONS.create_work_order(client, { name: 'X' }, NOW);
    const body = client.calls[0][1];
    assert.equal(body.priority, 2);
    assert.equal(body.dueDate, '2026-10-24T08:00:00.000Z');
    assert.equal(body.assetGuids, undefined);
  });

  for (const [args, message] of [
    [{ name: '' }, /Name is required/],
    [{ name: 'x'.repeat(201) }, /at most 200/],
    [{ name: 'X', priority: 6 }, /Priority/],
    [{ name: 'X', priority: 1.5 }, /Priority/],
    [{ name: 'X', due_in_days: -1 }, /Due in days/],
    [{ name: 'X', asset_guid: '42' }, /Asset must be a UteamUP GUID/],
    [{ name: 'X', assignee_guid: "1' OR '1'='1" }, /Assignee must be a UteamUP GUID/],
  ]) {
    it(`rejects ${JSON.stringify(args).slice(0, 60)} before calling UteamUP`, async () => {
      const client = recorder();
      await assert.rejects(ACTIONS.create_work_order(client, args, NOW), (err) => err instanceof ActionInputError && message.test(err.message));
      assert.equal(client.calls.length, 0);
    });
  }
});

describe('create_quick_report', () => {
  it('splits tags and passes severity and asset', async () => {
    const client = recorder({ workorderGuid: WORK_ORDER_GUID, ticketId: 'QR-1' });
    const tokens = await ACTIONS.create_quick_report(client, {
      description: 'Water detected',
      severity: 'critical',
      asset_guid: ASSET_GUID,
      tags: 'leak, homey ,,',
    });
    assert.deepEqual(client.calls, [['createQuickReport', {
      description: 'Water detected', severity: 'critical', assetGuid: ASSET_GUID, tags: ['leak', 'homey'],
    }]]);
    assert.deepEqual(tokens, { work_order_guid: WORK_ORDER_GUID, ticket_id: 'QR-1' });
  });

  it('rejects an unknown severity and an over-long description', async () => {
    await assert.rejects(ACTIONS.create_quick_report(recorder(), { description: 'x', severity: 'urgent' }), ActionInputError);
    await assert.rejects(ACTIONS.create_quick_report(recorder(), { description: 'x'.repeat(2001) }), ActionInputError);
  });
});

describe('work order actions', () => {
  it('accepts an autocomplete choice or a typed GUID', async () => {
    const client = recorder();
    await ACTIONS.set_work_order_status(client, { work_order: { id: WORK_ORDER_GUID, name: 'WO-42' }, status: 'completed' });
    await ACTIONS.set_work_order_status(client, { work_order: WORK_ORDER_GUID, status: 'on_hold', expected_status: 'in_progress' });
    assert.deepEqual(client.calls, [
      ['setWorkOrderStatus', WORK_ORDER_GUID, 4, null],
      ['setWorkOrderStatus', WORK_ORDER_GUID, 3, 2],
    ]);
  });

  it('rejects an unknown status and a non-GUID work order', async () => {
    await assert.rejects(ACTIONS.set_work_order_status(recorder(), { work_order: WORK_ORDER_GUID, status: 'done' }), ActionInputError);
    await assert.rejects(ACTIONS.complete_work_order(recorder(), { work_order: { id: '../admin' } }), ActionInputError);
  });

  it('completes with optional notes', async () => {
    const client = recorder();
    await ACTIONS.complete_work_order(client, { work_order: WORK_ORDER_GUID, notes: 'Seal replaced' });
    await ACTIONS.complete_work_order(client, { work_order: WORK_ORDER_GUID, notes: '' });
    assert.deepEqual(client.calls, [
      ['completeWorkOrder', WORK_ORDER_GUID, 'Seal replaced'],
      ['completeWorkOrder', WORK_ORDER_GUID, null],
    ]);
  });
});

describe('asset, schedule, meter and journal actions', () => {
  it('maps the asset state to its wire value', async () => {
    const client = recorder();
    await ACTIONS.set_asset_state(client, { asset_guid: ASSET_GUID, state: 'under_maintenance', reason: 'Service' });
    assert.deepEqual(client.calls, [['setAssetState', ASSET_GUID, 'underMaintenance', 'Service']]);
    await assert.rejects(ACTIONS.set_asset_state(recorder(), { asset_guid: ASSET_GUID, state: 'broken' }), ActionInputError);
  });

  it('runs a schedule and returns the created work order', async () => {
    const client = recorder({ guid: WORK_ORDER_GUID, ticketId: 'PM-1' });
    assert.deepEqual(await ACTIONS.run_pm_schedule(client, { schedule_guid: ASSET_GUID }), { work_order_guid: WORK_ORDER_GUID, ticket_id: 'PM-1' });
  });

  it('records a numeric meter reading', async () => {
    const client = recorder();
    await ACTIONS.record_meter_reading(client, { value: '42.5', asset_guid: ASSET_GUID, attribute_definition_guid: ATTRIBUTE_GUID });
    assert.deepEqual(client.calls, [['recordMeterReading', { assetGuid: ASSET_GUID, attributeDefinitionGuid: ATTRIBUTE_GUID, value: 42.5, notes: null }]]);
    for (const value of ['abc', '', Infinity]) {
      await assert.rejects(
        ACTIONS.record_meter_reading(recorder(), { value, asset_guid: ASSET_GUID, attribute_definition_guid: ATTRIBUTE_GUID }),
        ActionInputError,
      );
    }
  });

  it('appends a journal entry', async () => {
    const client = recorder();
    await ACTIONS.append_journal_entry(client, { journal_guid: ASSET_GUID, entry: 'Filter replaced' });
    assert.deepEqual(client.calls, [['appendJournalEntry', ASSET_GUID, 'Filter replaced']]);
    await assert.rejects(ACTIONS.append_journal_entry(recorder(), { journal_guid: ASSET_GUID, entry: ' ' }), ActionInputError);
  });
});

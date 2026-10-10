import test from 'node:test';
import assert from 'node:assert/strict';
import { isInteger, reservedByOrder, recommendOrder, selectOrder, withdrawalLimit } from '../src/floorLogic.ts';
import { groupMaterials } from '../src/materialLogic.ts';
import { affectedQuery } from '../src/eventLogic.ts';
import { request } from '../src/api.ts';
const reserves = reservedByOrder([
  { work_order_code: 'R240826000', quantity: 2 },
  { work_order_code: 'R101026001', quantity: 4 },
  { work_order_code: 'R101026001', quantity: 2 },
]);
test('demo: aggregates reserves and selects the order with six, not the oldest with two', () => {
  assert.equal(reserves.get('R101026001'), 6);
  assert.equal(recommendOrder(reserves), 'R101026001');
  assert.equal(recommendOrder(reserves, 6), 'R101026001');
});
test('scanned or chosen order always outranks suggestions, including after scanning another piece', () => {
  assert.equal(selectOrder('R101026001', reserves, 6), 'R101026001');
  assert.equal(selectOrder('R101026001', new Map([['R240826000', 20]])), 'R101026001');
  assert.equal(selectOrder('R240826000', reserves, 6), 'R240826000');
});
test('ambiguous or insufficient reserves require explicit selection', () => {
  assert.equal(recommendOrder(new Map([['A', 6], ['B', 6]])), '');
  assert.equal(recommendOrder(new Map([['A', 6], ['B', 8]]), 6), '');
  assert.equal(recommendOrder(reserves, 9), '');
  assert.equal(recommendOrder(new Map()), '');
});
test('withdrawal respects stock in the location and reservations belonging to other orders', () => {
  assert.equal(withdrawalLimit(10, 2, 2), 4);
  assert.equal(withdrawalLimit(10, 2, 6), 8);
  assert.equal(withdrawalLimit(3, 2, 6), 3);
  assert.equal(withdrawalLimit(0, 20, 6), 0);
  assert.equal(withdrawalLimit(10, -8, 2), 0);
});
test('counts accept zero but reject blank, negative and fractional amounts', () => {
  assert.equal(isInteger(0, 0), true);
  for (const value of ['', null, undefined, -1, 1.5, 'wrong']) assert.equal(isInteger(value, 0), false);
  assert.equal(isInteger(0), false);
});
test('materials group by kit and show incomplete status until every line is complete', () => {
  const groups = groupMaterials([
    { bom_line_id: 1, kit_name: 'Husillo', line_status: 'complete' },
    { bom_line_id: 2, kit_name: 'Husillo', line_status: 'partial' },
    { bom_line_id: 3, line_status: 'complete' },
  ], [{ kit_name: 'Motor', bom_line_ids: [3] }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].lines.length, 2);
  assert.equal(groups[0].complete, false);
  assert.equal(groups[1].name, 'Motor');
  assert.equal(groups[1].complete, true);
  assert.deepEqual(groupMaterials([]), []);
});
test('SSE refreshes the affected piece and order without reloading unrelated queries', () => {
  const event = { event_type: 'stock.issued', data: { part_id: 8, location_id: 100, work_order_code: 'R101026001' } };
  assert.equal(affectedQuery('/parts/8/availability', event), true);
  assert.equal(affectedQuery('/parts/9/availability', event), false);
  assert.equal(affectedQuery('/work-orders/R101026001/materials', event), true);
  assert.equal(affectedQuery('/work-orders/R240826000/materials', event), false);
  assert.equal(affectedQuery('/forecast/models/1', event), false);
  assert.equal(affectedQuery('/unmatched-receipts', event), false);
  assert.equal(affectedQuery('/locations/100/stock', event), true);
  assert.equal(affectedQuery('/locations/101/stock', event), false);
});
test('received material refreshes active materials even if no order code is present', () => {
  const event = { event_type: 'stock.received', data: { part_id: 8, location_id: 100 } };
  assert.equal(affectedQuery('/work-orders/R101026001/materials', event), true);
  assert.equal(affectedQuery('/unmatched-receipts', event), true);
  assert.equal(affectedQuery('/valuation', event), true);
});
test('API sends GET, POST, PUT and DELETE payloads and preserves backend errors', async () => {
  const original = globalThis.fetch;
  let call;
  try {
    globalThis.fetch = async (url, options) => {
      call = { url, options };
      return { ok: true, json: async () => ({ items: [] }) };
    };
    await request('/scan?code=SKU%2F001');
    assert.equal(call.url, '/api/scan?code=SKU%2F001');
    assert.equal(call.options.method, 'GET');
    await request('/issues', { quantity: 6, work_order_code: 'R101026001' });
    assert.equal(call.options.method, 'POST');
    assert.deepEqual(JSON.parse(call.options.body), { quantity: 6, work_order_code: 'R101026001' });
    await request('/policies/8', { min_qty: 2, max_qty: 6 }, 'PUT');
    assert.equal(call.options.method, 'PUT');
    await request('/policies/8', undefined, 'DELETE');
    assert.equal(call.options.method, 'DELETE');
    assert.equal(call.options.body, undefined);
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: 'La salida dejaría el disponible negativo' }) });
    await assert.rejects(request('/issues', {}), /dejaría el disponible negativo/);
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw Error('HTML'); } });
    await assert.rejects(request('/health'), /JSON/);
  } finally { globalThis.fetch = original; }
});

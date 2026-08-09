import test from 'node:test';
import assert from 'node:assert/strict';

import {
  eligibleInventorySerials,
  inventoryAvailability,
  inventoryPortfolioMetrics,
  materialAllocationState,
  normalizeInventorySerial,
  parseInventorySerials,
  serialPortfolioMetrics,
} from '../src/lib/solar/inventory-control.mjs';

test('separa existencia física, apartada y disponible', () => {
  assert.deepEqual(inventoryAvailability({ on_hand: '20', reserved: '7' }), { onHand: 20, reserved: 7, available: 13 });
  assert.deepEqual(inventoryAvailability({ on_hand: 2, reserved: 9 }), { onHand: 2, reserved: 2, available: 0 });
});

test('calcula faltante con entregas netas de devoluciones', () => {
  assert.deepEqual(materialAllocationState({ planned_quantity: 8, reserved_quantity: 3, issued_quantity: 4, returned_quantity: 1 }), {
    planned: 8, reserved: 3, issued: 4, returned: 1, netIssued: 3, uncovered: 2, progress: 0.375, state: 'partial',
  });
  assert.equal(materialAllocationState({ planned_quantity: 8, reserved_quantity: 0, issued_quantity: 8, returned_quantity: 0 }).state, 'issued');
});

test('resume alertas y valor sin duplicar proyectos', () => {
  const items = [
    { active: true, reorder_point: 4, default_unit_cost_before_vat_mxn: 100, solar_inventory_balances: [{ on_hand: 10, reserved: 7 }] },
    { active: true, reorder_point: 0, default_unit_cost_before_vat_mxn: 500, solar_inventory_balances: [{ on_hand: 2, reserved: 0 }] },
  ];
  const allocations = [
    { project_id: 'p1', status: 'partial', planned_quantity: 8, reserved_quantity: 3, issued_quantity: 1, returned_quantity: 0 },
    { project_id: 'p1', status: 'pending', planned_quantity: 1, reserved_quantity: 0, issued_quantity: 0, returned_quantity: 0 },
    { project_id: 'p2', status: 'ready', planned_quantity: 4, reserved_quantity: 4, issued_quantity: 0, returned_quantity: 0 },
  ];
  assert.deepEqual(inventoryPortfolioMetrics(items, allocations), {
    stockValue: 2000, lowStockCount: 1, shortageAllocationCount: 2, shortageProjectCount: 1, readyProjectCount: 1,
  });
});

test('normaliza, valida y elimina series repetidas de capturas o escáner', () => {
  assert.equal(normalizeInventorySerial(' grw 9x-77 '), 'GRW9X-77');
  assert.deepEqual(parseInventorySerials('grw 9x-77\nMOD/001, MOD/001; x'), {
    serials: ['GRW9X-77', 'MOD/001'], duplicates: ['MOD/001'], invalid: ['X'],
  });
});

test('resume el ciclo de vida unitario y detecta excepciones', () => {
  assert.deepEqual(serialPortfolioMetrics([
    { status: 'in_stock' }, { status: 'reserved' }, { status: 'issued' },
    { status: 'installed' }, { status: 'installed' }, { status: 'quarantined' },
  ]), { total: 6, inStock: 1, reserved: 1, issued: 1, installed: 2, exceptions: 1 });
});

test('sólo ofrece series compatibles con la partida y la transición', () => {
  const allocation = { id: 'a1', item_id: 'i1', location_id: 'l1' };
  const serials = [
    { id: 's1', item_id: 'i1', location_id: 'l1', status: 'in_stock' },
    { id: 's2', item_id: 'i1', location_id: 'l2', status: 'in_stock' },
    { id: 's3', item_id: 'i1', location_id: 'l1', allocation_id: 'a1', status: 'reserved' },
    { id: 's4', item_id: 'i1', location_id: 'l1', allocation_id: 'a2', status: 'reserved' },
    { id: 's5', item_id: 'i1', location_id: 'l1', allocation_id: 'a1', status: 'issued' },
  ];
  assert.deepEqual(eligibleInventorySerials(serials, allocation, 'reserve').map((item) => item.id), ['s1']);
  assert.deepEqual(eligibleInventorySerials(serials, allocation, 'issue').map((item) => item.id), ['s3']);
  assert.deepEqual(eligibleInventorySerials(serials, allocation, 'return').map((item) => item.id), ['s5']);
});

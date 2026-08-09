import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateInverterSizing, selectSuggestedInverter } from '../src/lib/solar/inverter-sizing.mjs';

const inverters = [
  { id: 'mic-2', active: true, ac_capacity_kw: 2 },
  { id: 'mic-3.3', active: true, ac_capacity_kw: 3.3 },
  { id: 'min-4.2', active: true, ac_capacity_kw: 4.2 },
  { id: 'min-6', active: true, ac_capacity_kw: 6 },
];

test('selects the smallest active inverter that stays within 120% DC/AC', () => {
  assert.equal(selectSuggestedInverter(inverters, 2.2)?.id, 'mic-2');
  assert.equal(selectSuggestedInverter(inverters, 3.8)?.id, 'mic-3.3');
  assert.equal(selectSuggestedInverter(inverters, 4.4)?.id, 'min-4.2');
});

test('adds inverter units when the system exceeds one inverter capacity', () => {
  const sizing = calculateInverterSizing(inverters.at(-1), 9.35);
  assert.equal(sizing.quantity, 2);
  assert.ok(sizing.loadingPercent <= 120);
  assert.equal(Number(sizing.loadingPercent.toFixed(2)), 77.92);
});

test('selects the smallest valid multi-inverter arrangement before oversized alternatives', () => {
  const selected = selectSuggestedInverter(inverters, 9.35);
  const sizing = calculateInverterSizing(selected, 9.35);
  assert.equal(selected.id, 'min-4.2');
  assert.equal(sizing.quantity, 2);
  assert.equal(Number(sizing.loadingPercent.toFixed(2)), 111.31);
});

test('ignores inactive inverter models', () => {
  const selected = selectSuggestedInverter([
    { id: 'small', active: false, ac_capacity_kw: 3.3 },
    { id: 'large', active: true, ac_capacity_kw: 6 },
  ], 3.2);
  assert.equal(selected?.id, 'large');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateInverterSizing, selectSuggestedInverter } from '../src/lib/solar/inverter-sizing.mjs';

const inverters = [
  { id: 'mic', active: true, ac_capacity_kw: 3.3 },
  { id: 'min', active: true, ac_capacity_kw: 6 },
];

test('selects the smallest active inverter that stays within 120% DC/AC', () => {
  assert.equal(selectSuggestedInverter(inverters, 3.8)?.id, 'mic');
  assert.equal(selectSuggestedInverter(inverters, 4.4)?.id, 'min');
});

test('adds inverter units when the system exceeds one inverter capacity', () => {
  const sizing = calculateInverterSizing(inverters[1], 9.35);
  assert.equal(sizing.quantity, 2);
  assert.ok(sizing.loadingPercent <= 120);
  assert.equal(Number(sizing.loadingPercent.toFixed(2)), 77.92);
});

test('ignores inactive inverter models', () => {
  const selected = selectSuggestedInverter([
    { id: 'small', active: false, ac_capacity_kw: 3.3 },
    { id: 'large', active: true, ac_capacity_kw: 6 },
  ], 3.2);
  assert.equal(selected?.id, 'large');
});

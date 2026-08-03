import test from 'node:test';
import assert from 'node:assert/strict';

import { expectedPeriodCount, isCompletePeriod, validatePeriodHistory } from '../src/lib/solar/periods.mjs';

test('period history uses the CFE cadence limits', () => {
  assert.equal(expectedPeriodCount('monthly'), 12);
  assert.equal(expectedPeriodCount('bimonthly'), 6);
});

test('manual periods require the complete cadence history', () => {
  const periods = [{ kwh: '420', amountMxn: '1200' }, { kwh: '380', amountMxn: '980' }, { kwh: '', amountMxn: '' }];
  const result = validatePeriodHistory(periods, 'bimonthly');
  assert.equal(isCompletePeriod(periods[0]), true);
  assert.equal(result.ok, false);
  assert.equal(result.completeCount, 2);
  assert.equal(result.isPartial, true);
});

test('a complete bimonthly history can continue', () => {
  const periods = Array.from({ length: 6 }, (_, index) => ({ kwh: String(300 + index), amountMxn: '900' }));
  const result = validatePeriodHistory(periods, 'bimonthly');
  assert.equal(result.ok, true);
  assert.equal(result.completeCount, 6);
  assert.equal(result.isPartial, false);
});

test('invalid or empty rows cannot be submitted as consumption history', () => {
  const result = validatePeriodHistory([{ kwh: '0', amountMxn: '100' }, { kwh: '250', amountMxn: '' }], 'monthly');
  assert.equal(result.ok, false);
  assert.deepEqual(result.incompleteIndexes, [0, 1]);
});

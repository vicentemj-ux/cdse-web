import test from 'node:test';
import assert from 'node:assert/strict';

import {
  annualizeHistory,
  calculatePanelRecommendation,
  calculatePreliminaryQuote,
} from '../src/lib/solar/calculator.mjs';

test('annualizes bimonthly periods using explicit duration', () => {
  const result = annualizeHistory([
    { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
    { kwh: 1200, amountMxn: 3600, coveredMonths: 2 },
  ]);

  assert.equal(result.annualConsumptionKwh, 6600);
  assert.equal(result.annualObservedBillMxn, 19800);
  assert.equal(result.coveredMonths, 4);
  assert.equal(result.coverageFraction, 4 / 12);
});

test('rejects ambiguous period duration', () => {
  assert.throws(
    () =>
      annualizeHistory([
        {
          kwh: 500,
          amountMxn: 1000,
          coveredDays: 60,
          coveredMonths: 2,
        },
      ]),
    /exactly one/,
  );
});

test('rounds panel count upward and keeps quote inputs configurable', () => {
  const result = calculatePreliminaryQuote({
    periods: [
      { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
      { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
      { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
      { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
      { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
      { kwh: 1000, amountMxn: 3000, coveredMonths: 2 },
    ],
    tariffCode: 'DAC',
    panelWatts: 585,
    peakSunHoursPerDay: 5.5,
    performanceRatio: 0.8,
    coverageTarget: 1,
    pricePerWattMxn: 20,
    priceIncludesVat: false,
    vatRate: 0.16,
    nonOffsettableAnnualChargesMxn: 1200,
    savingsRealizationFactor: 0.9,
    tariffEscalationRate: 0.06,
    annualPanelDegradationRate: 0.005,
  });

  assert.equal(result.panelCount, 7);
  assert.equal(result.systemDcKw, 4.095);
  assert.equal(result.confidence, 'high');
  assert.equal(result.requiresEngineeringReview, false);
  assert.equal(result.projection.length, 10);
  assert.ok(result.totalMxn > result.subtotalMxn);
  assert.ok(result.annualGenerationKwh >= result.targetGenerationKwh);
});

test('supports internal installed price per panel independently from sizing', () => {
  const sizing = calculatePanelRecommendation({
    periods: [{ kwh: 1000, amountMxn: 3000, coveredMonths: 2 }],
    panelWatts: 590,
    peakSunHoursPerDay: 5.5,
    performanceRatio: 0.8,
    coverageTarget: 1,
  });
  const quote = calculatePreliminaryQuote({
    periods: [{ kwh: 1000, amountMxn: 3000, coveredMonths: 2 }],
    tariffCode: 'DAC',
    panelWatts: 590,
    peakSunHoursPerDay: 5.5,
    performanceRatio: 0.8,
    coverageTarget: 1,
    pricingMode: 'per_panel',
    pricePerPanelMxn: 15000,
    priceIncludesVat: true,
    vatRate: 0.16,
    nonOffsettableAnnualChargesMxn: 0,
    savingsRealizationFactor: 0.9,
    tariffEscalationRate: 0.06,
    annualPanelDegradationRate: 0.005,
  });

  assert.equal(quote.panelCount, sizing.panelCount);
  assert.equal(quote.pricingMode, 'per_panel');
  assert.equal(quote.subtotalMxn, quote.panelCount * 15000);
  assert.equal(quote.totalMxn, quote.subtotalMxn);
});

test('requires engineering review for GDMTH and does not promise savings', () => {
  const result = calculatePreliminaryQuote({
    periods: [{ kwh: 20000, amountMxn: 70000, coveredMonths: 1 }],
    tariffCode: 'GDMTH',
    panelWatts: 585,
    peakSunHoursPerDay: 5.5,
    performanceRatio: 0.8,
    coverageTarget: 0.9,
    pricePerWattMxn: 17,
    priceIncludesVat: true,
    vatRate: 0.16,
    nonOffsettableAnnualChargesMxn: 0,
    savingsRealizationFactor: 0.85,
    tariffEscalationRate: 0.06,
    annualPanelDegradationRate: 0.005,
  });

  assert.equal(result.requiresEngineeringReview, true);
  assert.equal(result.yearOneSavingsMxn, null);
  assert.equal(result.simplePaybackYears, null);
  assert.deepEqual(result.projection, []);
  assert.ok(result.warnings.includes('HOURLY_OR_DEMAND_TARIFF_REVIEW_REQUIRED'));
});

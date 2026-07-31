/**
 * Shared, side-effect-free calculation engine for preliminary CDSE solar quotes.
 *
 * All commercial and engineering parameters are inputs. This module deliberately
 * contains no hidden prices, tariffs, zone yields, or product defaults.
 */

const DAYS_PER_YEAR = 365;
const MONTHS_PER_YEAR = 12;

/**
 * @typedef {Object} ConsumptionPeriod
 * @property {number} kwh
 * @property {number} amountMxn
 * @property {number} [coveredDays]
 * @property {number} [coveredMonths]
 */

/**
 * @typedef {Object} ProjectionYear
 * @property {number} year
 * @property {number} generationKwh
 * @property {number} avoidedBillMxn
 * @property {number} cumulativeCashflowMxn
 */

function assertFinitePositive(value, field, { allowZero = false } = {}) {
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) {
    throw new RangeError(`${field} must be ${allowZero ? 'zero or ' : ''}greater than zero`);
  }
}

function assertRatio(value, field, { allowZero = false } = {}) {
  const lowerBoundValid = allowZero ? value >= 0 : value > 0;
  if (!Number.isFinite(value) || !lowerBoundValid || value > 1) {
    throw new RangeError(`${field} must be ${allowZero ? 'between 0 and 1' : 'greater than 0 and at most 1'}`);
  }
}

/**
 * Annualizes consumption and observed spend without assuming each receipt row
 * is one month. Every row must use coveredDays or coveredMonths consistently.
 *
 * @param {ConsumptionPeriod[]} periods
 */
export function annualizeHistory(periods) {
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new TypeError('At least one consumption period is required');
  }

  let totalKwh = 0;
  let totalAmountMxn = 0;
  let totalDays = 0;
  let totalMonths = 0;
  let durationMode;

  for (const [index, period] of periods.entries()) {
    assertFinitePositive(period.kwh, `periods[${index}].kwh`);
    assertFinitePositive(period.amountMxn, `periods[${index}].amountMxn`, { allowZero: true });

    const hasDays = Number.isFinite(period.coveredDays);
    const hasMonths = Number.isFinite(period.coveredMonths);
    if (hasDays === hasMonths) {
      throw new TypeError(
        `periods[${index}] must define exactly one of coveredDays or coveredMonths`,
      );
    }

    const periodMode = hasDays ? 'days' : 'months';
    if (durationMode && durationMode !== periodMode) {
      throw new TypeError('All periods must use the same duration unit');
    }
    durationMode = periodMode;

    if (hasDays) {
      assertFinitePositive(period.coveredDays, `periods[${index}].coveredDays`);
      totalDays += period.coveredDays;
    } else {
      assertFinitePositive(period.coveredMonths, `periods[${index}].coveredMonths`);
      totalMonths += period.coveredMonths;
    }

    totalKwh += period.kwh;
    totalAmountMxn += period.amountMxn;
  }

  const annualizationFactor =
    durationMode === 'days'
      ? DAYS_PER_YEAR / totalDays
      : MONTHS_PER_YEAR / totalMonths;
  const coverageFraction =
    durationMode === 'days'
      ? Math.min(totalDays / DAYS_PER_YEAR, 1)
      : Math.min(totalMonths / MONTHS_PER_YEAR, 1);

  return {
    annualConsumptionKwh: totalKwh * annualizationFactor,
    annualObservedBillMxn: totalAmountMxn * annualizationFactor,
    coveredDays: durationMode === 'days' ? totalDays : null,
    coveredMonths: durationMode === 'months' ? totalMonths : null,
    coverageFraction,
  };
}

/**
 * Calculates the physical recommendation independently from pricing.
 *
 * @param {Object} input
 * @param {ConsumptionPeriod[]} input.periods
 * @param {number} input.panelWatts
 * @param {number} input.peakSunHoursPerDay
 * @param {number} input.performanceRatio
 * @param {number} input.coverageTarget
 */
export function calculatePanelRecommendation(input) {
  assertFinitePositive(input.panelWatts, 'panelWatts');
  assertFinitePositive(input.peakSunHoursPerDay, 'peakSunHoursPerDay');
  assertRatio(input.performanceRatio, 'performanceRatio');
  assertRatio(input.coverageTarget, 'coverageTarget');

  const history = annualizeHistory(input.periods);
  const annualYieldPerKw =
    input.peakSunHoursPerDay * DAYS_PER_YEAR * input.performanceRatio;
  const annualGenerationPerPanel =
    (input.panelWatts / 1000) * annualYieldPerKw;
  const targetGenerationKwh =
    history.annualConsumptionKwh * input.coverageTarget;
  const panelCount = Math.ceil(targetGenerationKwh / annualGenerationPerPanel);
  const systemDcKw = (panelCount * input.panelWatts) / 1000;
  const annualGenerationKwh = systemDcKw * annualYieldPerKw;
  const estimatedCoverage = annualGenerationKwh / history.annualConsumptionKwh;

  return {
    history,
    panelCount,
    systemDcKw,
    annualGenerationKwh,
    targetGenerationKwh,
    estimatedCoverage,
  };
}

/**
 * @param {Object} input
 * @param {ConsumptionPeriod[]} input.periods
 * @param {'DOMESTIC'|'DAC'|'PDBT'|'GDBT'|'GDMTO'|'GDMTH'|'OTHER'} input.tariffCode
 * @param {number} input.panelWatts
 * @param {number} input.peakSunHoursPerDay
 * @param {number} input.performanceRatio
 * @param {number} input.coverageTarget
 * @param {'per_watt'|'per_panel'} [input.pricingMode]
 * @param {number} [input.pricePerWattMxn]
 * @param {number} [input.pricePerPanelMxn]
 * @param {boolean} input.priceIncludesVat
 * @param {number} input.vatRate
 * @param {number} input.nonOffsettableAnnualChargesMxn
 * @param {number} input.savingsRealizationFactor
 * @param {number} input.tariffEscalationRate
 * @param {number} input.annualPanelDegradationRate
 * @param {number} [input.projectionYears]
 */
export function calculatePreliminaryQuote(input) {
  const sizing = calculatePanelRecommendation(input);
  const pricingMode =
    input.pricingMode ?? (input.pricePerPanelMxn ? 'per_panel' : 'per_watt');
  if (!['per_watt', 'per_panel'].includes(pricingMode)) {
    throw new RangeError('pricingMode must be per_watt or per_panel');
  }
  if (pricingMode === 'per_panel') {
    assertFinitePositive(input.pricePerPanelMxn, 'pricePerPanelMxn');
  } else {
    assertFinitePositive(input.pricePerWattMxn, 'pricePerWattMxn');
  }
  assertRatio(input.vatRate, 'vatRate', { allowZero: true });
  assertFinitePositive(
    input.nonOffsettableAnnualChargesMxn,
    'nonOffsettableAnnualChargesMxn',
    { allowZero: true },
  );
  assertRatio(input.savingsRealizationFactor, 'savingsRealizationFactor');
  assertRatio(input.tariffEscalationRate, 'tariffEscalationRate', { allowZero: true });
  assertRatio(
    input.annualPanelDegradationRate,
    'annualPanelDegradationRate',
    { allowZero: true },
  );

  const projectionYears = input.projectionYears ?? 10;
  if (!Number.isInteger(projectionYears) || projectionYears < 1 || projectionYears > 30) {
    throw new RangeError('projectionYears must be an integer between 1 and 30');
  }

  const {
    history,
    panelCount,
    systemDcKw,
    annualGenerationKwh,
    targetGenerationKwh,
    estimatedCoverage,
  } = sizing;

  const subtotalMxn =
    pricingMode === 'per_panel'
      ? panelCount * input.pricePerPanelMxn
      : systemDcKw * 1000 * input.pricePerWattMxn;
  const totalMxn = input.priceIncludesVat
    ? subtotalMxn
    : subtotalMxn * (1 + input.vatRate);

  const offsettableObservedBillMxn = Math.max(
    history.annualObservedBillMxn - input.nonOffsettableAnnualChargesMxn,
    0,
  );
  const energyOffsetFraction = Math.min(estimatedCoverage, 1);
  const requiresEngineeringReview = ['GDMTH', 'GDMTO'].includes(input.tariffCode);
  const yearOneSavingsMxn = requiresEngineeringReview
    ? null
    : offsettableObservedBillMxn *
      energyOffsetFraction *
      input.savingsRealizationFactor;

  /** @type {ProjectionYear[]} */
  const projection = [];
  let cumulativeCashflowMxn = -totalMxn;

  if (yearOneSavingsMxn !== null) {
    for (let year = 1; year <= projectionYears; year += 1) {
      const generationFactor = (1 - input.annualPanelDegradationRate) ** (year - 1);
      const tariffFactor = (1 + input.tariffEscalationRate) ** (year - 1);
      const avoidedBillMxn = yearOneSavingsMxn * generationFactor * tariffFactor;
      cumulativeCashflowMxn += avoidedBillMxn;
      projection.push({
        year,
        generationKwh: annualGenerationKwh * generationFactor,
        avoidedBillMxn,
        cumulativeCashflowMxn,
      });
    }
  }

  let simplePaybackYears = null;
  if (yearOneSavingsMxn > 0) {
    let priorCumulative = -totalMxn;
    for (const row of projection) {
      if (row.cumulativeCashflowMxn >= 0) {
        const yearSavings = row.cumulativeCashflowMxn - priorCumulative;
        simplePaybackYears =
          row.year - 1 + Math.abs(priorCumulative) / yearSavings;
        break;
      }
      priorCumulative = row.cumulativeCashflowMxn;
    }
  }

  const confidence =
    history.coverageFraction >= 0.95 ? 'high' : history.coverageFraction >= 0.45 ? 'medium' : 'low';
  const warnings = [];
  if (history.coverageFraction < 0.95) warnings.push('INCOMPLETE_HISTORY');
  if (estimatedCoverage > 1) warnings.push('ABOVE_100_PERCENT_ESTIMATED_COVERAGE');
  if (requiresEngineeringReview) warnings.push('HOURLY_OR_DEMAND_TARIFF_REVIEW_REQUIRED');

  return {
    history,
    pricingMode,
    panelCount,
    systemDcKw,
    annualGenerationKwh,
    targetGenerationKwh,
    estimatedCoverage,
    subtotalMxn,
    totalMxn,
    yearOneSavingsMxn,
    simplePaybackYears,
    requiresEngineeringReview,
    confidence,
    warnings,
    projection,
  };
}

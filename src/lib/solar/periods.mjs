export const PERIOD_LIMITS = {
  monthly: 12,
  bimonthly: 6,
};

export function expectedPeriodCount(frequency = 'bimonthly') {
  return PERIOD_LIMITS[frequency] ?? PERIOD_LIMITS.bimonthly;
}

export function isCompletePeriod(period) {
  if (period?.kwh === '' || period?.kwh == null || period?.amountMxn === '' || period?.amountMxn == null) return false;
  const kwh = Number(period?.kwh);
  const amount = Number(period?.amountMxn);
  return Number.isFinite(kwh) && kwh > 0 && Number.isFinite(amount) && amount >= 0;
}

export function validatePeriodHistory(periods = [], frequency = 'bimonthly') {
  const completeIndexes = [];
  const incompleteIndexes = [];
  periods.forEach((period, index) => {
    (isCompletePeriod(period) ? completeIndexes : incompleteIndexes).push(index);
  });
  const minimumPeriods = 2;
  const expectedPeriods = expectedPeriodCount(frequency);
  return {
    ok: completeIndexes.length >= minimumPeriods,
    completeIndexes,
    incompleteIndexes,
    completeCount: completeIndexes.length,
    expectedPeriods,
    minimumPeriods,
    isPartial: completeIndexes.length >= minimumPeriods && completeIndexes.length < expectedPeriods,
  };
}

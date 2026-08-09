export function calculateInverterSizing(inverter, systemDcKw, maxDcAcRatio = 1.2) {
  const capacityKw = Number(inverter?.ac_capacity_kw ?? 0);
  const dcKw = Number(systemDcKw ?? 0);
  if (!(capacityKw > 0) || !(dcKw > 0) || !(maxDcAcRatio >= 1)) return null;
  const quantity = Math.max(1, Math.ceil(dcKw / (capacityKw * maxDcAcRatio)));
  return {
    quantity,
    combinedAcKw: capacityKw * quantity,
    loadingPercent: (dcKw / (capacityKw * quantity)) * 100,
  };
}

export function selectSuggestedInverter(inverters, systemDcKw, maxDcAcRatio = 1.2) {
  const dcKw = Number(systemDcKw);
  if (!(dcKw > 0)) return null;

  const candidates = (inverters ?? [])
    .filter((item) => item.active)
    .map((item) => ({ item, sizing: calculateInverterSizing(item, dcKw, maxDcAcRatio) }))
    .filter(({ sizing }) => sizing && sizing.loadingPercent <= maxDcAcRatio * 100 + 0.01)
    .sort((a, b) => (
      a.sizing.quantity - b.sizing.quantity
      || a.sizing.combinedAcKw - b.sizing.combinedAcKw
      || Number(b.item.ac_capacity_kw) - Number(a.item.ac_capacity_kw)
    ));

  return candidates[0]?.item ?? null;
}

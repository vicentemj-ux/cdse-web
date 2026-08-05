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
  const active = (inverters ?? [])
    .filter((item) => item.active)
    .sort((a, b) => Number(a.ac_capacity_kw) - Number(b.ac_capacity_kw));
  if (!active.length || !(Number(systemDcKw) > 0)) return null;
  return active.find((item) => Number(systemDcKw) <= Number(item.ac_capacity_kw) * maxDcAcRatio)
    ?? active.at(-1);
}

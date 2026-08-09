const DAY_MS = 86_400_000;

export function serviceTargetHours(priority) {
  return { critical: 24, high: 72, normal: 168, low: 336 }[priority] ?? 168;
}

export function generationCoverage(actualKwh, expectedKwh) {
  const expected = Number(expectedKwh);
  if (!Number.isFinite(expected) || expected <= 0) return null;
  return Number(actualKwh ?? 0) / expected * 100;
}

export function warrantyDaysRemaining(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const end = new Date(`${expiresAt}T12:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
}

export function afterSalesPortfolioMetrics(projects, now = new Date()) {
  const cases = projects.flatMap((project) => project.solar_service_cases ?? []);
  const warranties = projects.flatMap((project) => project.solar_warranties ?? []);
  const activeCases = cases.filter((item) => !['closed', 'cancelled'].includes(item.status));
  return {
    openCases: activeCases.length,
    overdueCases: activeCases.filter((item) => item.internal_target_at && new Date(item.internal_target_at) < now).length,
    expiringWarranties: warranties.filter((item) => item.status === 'active' && (() => { const days = warrantyDaysRemaining(item.expires_at, now); return days !== null && days >= 0 && days < 90; })()).length,
    underperformingProjects: projects.filter((project) => (project.solar_generation_readings ?? []).some((reading) => { const coverage = generationCoverage(reading.actual_kwh, reading.expected_kwh); return coverage !== null && coverage < 80; })).length,
  };
}

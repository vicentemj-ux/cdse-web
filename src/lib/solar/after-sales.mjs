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

export const WARRANTY_CLAIM_TRANSITIONS = Object.freeze({
  diagnosing: ['awaiting_evidence', 'submitted', 'cancelled'],
  awaiting_evidence: ['diagnosing', 'submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled'],
  approved: ['replacement_in_transit', 'resolved', 'cancelled'],
  rejected: ['diagnosing', 'closed'],
  replacement_in_transit: ['replacement_received', 'cancelled'],
  replacement_received: ['resolved'],
  resolved: ['closed'],
  closed: [],
  cancelled: [],
});

const EVIDENCE_FIELDS = Object.freeze([
  ['purchaseDocumentReference', 'Comprobante de compra o instalación'],
  ['serialEvidenceReference', 'Fotografía de placa y número de serie'],
  ['diagnosticEvidenceReference', 'Diagnóstico o mediciones del técnico'],
  ['faultEvidenceReference', 'Fotografía, video o código de la falla'],
]);

export function canTransitionWarrantyClaim(previousStatus, nextStatus) {
  if (!previousStatus || !nextStatus || previousStatus === nextStatus) return false;
  return WARRANTY_CLAIM_TRANSITIONS[previousStatus]?.includes(nextStatus) ?? false;
}

export function warrantyClaimReadiness(claim) {
  const evidence = claim?.evidence ?? {};
  const missing = EVIDENCE_FIELDS
    .filter(([key]) => !String(evidence[key] ?? '').trim())
    .map(([, label]) => label);
  if (claim?.claim_type === 'manufacturer_warranty' && !String(evidence.systemConfiguration ?? '').trim()) {
    missing.push('Configuración del sistema y de strings');
  }
  return { ready: missing.length === 0, missing };
}

export function warrantyClaimPortfolioMetrics(claims, now = new Date()) {
  const terminal = new Set(['closed', 'cancelled']);
  const nowMs = now.getTime();
  return (claims ?? []).reduce((summary, claim) => {
    if (!terminal.has(claim.status)) summary.open += 1;
    if (claim.status === 'awaiting_evidence') summary.awaitingEvidence += 1;
    if (['submitted', 'approved', 'replacement_in_transit'].includes(claim.status)) summary.withSupplier += 1;
    if (!terminal.has(claim.status) && claim.next_follow_up_at && new Date(claim.next_follow_up_at).getTime() < nowMs) summary.overdueFollowUp += 1;
    return summary;
  }, { open: 0, awaitingEvidence: 0, withSupplier: 0, overdueFollowUp: 0 });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterSalesPortfolioMetrics, canTransitionWarrantyClaim, generationCoverage, serviceTargetHours,
  warrantyClaimPortfolioMetrics, warrantyClaimReadiness, warrantyDaysRemaining,
} from '../src/lib/solar/after-sales.mjs';

test('clasifica objetivos internos de servicio sin prometer SLA comercial', () => {
  assert.equal(serviceTargetHours('critical'), 24);
  assert.equal(serviceTargetHours('high'), 72);
  assert.equal(serviceTargetHours('unknown'), 168);
});

test('calcula cobertura sólo cuando existe base esperada válida', () => {
  assert.equal(generationCoverage(800, 1000), 80);
  assert.equal(generationCoverage(100, 0), null);
  assert.equal(generationCoverage(100, null), null);
});

test('resume cartera activa, vencimientos y bajo desempeño', () => {
  const now = new Date('2026-08-08T12:00:00');
  const result = afterSalesPortfolioMetrics([{
    solar_service_cases: [
      { status: 'open', internal_target_at: '2026-08-07T12:00:00Z' },
      { status: 'closed', internal_target_at: '2026-08-01T12:00:00Z' },
    ],
    solar_warranties: [{ status: 'active', expires_at: '2026-09-01' }],
    solar_generation_readings: [{ actual_kwh: 700, expected_kwh: 1000 }],
  }], now);
  assert.deepEqual(result, { openCases: 1, overdueCases: 1, expiringWarranties: 1, underperformingProjects: 1 });
  assert.equal(warrantyDaysRemaining(null, now), null);
});

test('una reclamación de fabricante no puede enviarse sin expediente técnico completo', () => {
  const incomplete = warrantyClaimReadiness({
    claim_type: 'manufacturer_warranty',
    evidence: { purchaseDocumentReference: 'Factura F-102', serialEvidenceReference: 'Foto placa' },
  });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.missing, [
    'Diagnóstico o mediciones del técnico',
    'Fotografía, video o código de la falla',
    'Configuración del sistema y de strings',
  ]);
  assert.equal(warrantyClaimReadiness({
    claim_type: 'manufacturer_warranty',
    evidence: {
      purchaseDocumentReference: 'Factura F-102', serialEvidenceReference: 'Foto placa',
      diagnosticEvidenceReference: 'Reporte RT-10', faultEvidenceReference: 'Error 300',
      systemConfiguration: '8 paneles, 2 strings, 240 V / 60 Hz',
    },
  }).ready, true);
});

test('el flujo RMA impide saltar diagnóstico, aprobación o recepción', () => {
  assert.equal(canTransitionWarrantyClaim('diagnosing', 'submitted'), true);
  assert.equal(canTransitionWarrantyClaim('diagnosing', 'approved'), false);
  assert.equal(canTransitionWarrantyClaim('submitted', 'approved'), true);
  assert.equal(canTransitionWarrantyClaim('approved', 'replacement_received'), false);
  assert.equal(canTransitionWarrantyClaim('replacement_in_transit', 'replacement_received'), true);
  assert.equal(canTransitionWarrantyClaim('replacement_received', 'cancelled'), false);
  assert.equal(canTransitionWarrantyClaim('resolved', 'closed'), true);
  assert.equal(canTransitionWarrantyClaim('closed', 'diagnosing'), false);
});

test('resume reclamaciones pendientes, proveedor y seguimientos vencidos', () => {
  const now = new Date('2026-08-09T12:00:00Z');
  assert.deepEqual(warrantyClaimPortfolioMetrics([
    { status: 'awaiting_evidence', next_follow_up_at: '2026-08-08T12:00:00Z' },
    { status: 'submitted', next_follow_up_at: '2026-08-10T12:00:00Z' },
    { status: 'replacement_in_transit', next_follow_up_at: '2026-08-07T12:00:00Z' },
    { status: 'closed', next_follow_up_at: '2026-08-01T12:00:00Z' },
  ], now), { open: 3, awaitingEvidence: 1, withSupplier: 2, overdueFollowUp: 2 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { afterSalesPortfolioMetrics, generationCoverage, serviceTargetHours, warrantyDaysRemaining } from '../src/lib/solar/after-sales.mjs';

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

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExecutiveAnalytics, median } from '../src/lib/solar/executive-analytics.mjs';

test('calcula mediana sin deformarla por valores extremos', () => {
  assert.equal(median([1, 2, 90]), 2);
  assert.equal(median([2, 4]), 3);
  assert.equal(median([]), null);
});

test('reconstruye embudo, ciclos, alertas y margen antes de IVA', () => {
  const data = {
    leads: [
      { id: 'l1', owner_user_id: 's1', created_at: '2026-08-01T12:00:00Z' },
      { id: 'l2', owner_user_id: 's1', created_at: '2026-08-02T12:00:00Z' },
    ],
    quotes: [{ id: 'q1', lead_id: 'l1', created_by: 's1', created_at: '2026-08-03T12:00:00Z' }],
    projects: [{
      id: 'p1', quote_id: 'q1', lead_id: 'l1', seller_user_id: 's1', folio: 'P-1', status: 'operational', health: 'on_track',
      accepted_at: '2026-08-05T12:00:00Z', commissioned_at: '2026-08-09T12:00:00Z', amount_before_vat_mxn: 100_000,
      solar_project_cost_entries: [{ cost_stage: 'actual', status: 'paid', amount_before_vat_mxn: 60_000 }],
      solar_commissions: [{ status: 'paid', payable_amount_mxn: 5_000, recovered_amount_mxn: 0, net_commission_mxn: 5_000 }],
    }],
    workOrders: [{ id: 'w1', project_id: 'p1', status: 'completed', completed_at: '2026-08-08T12:00:00Z', scheduled_end: '2026-08-08T12:00:00Z' }],
    cfeCases: [{ id: 'c1', project_id: 'p1', status: 'interconnected', waiting_on: 'none', interconnected_at: '2026-08-09T12:00:00Z' }],
    tasks: [{ id: 't1', project_id: 'p1', status: 'pending', due_at: '2026-08-08T12:00:00Z', title: 'Validar evidencia', solar_projects: { folio: 'P-1' } }],
    profiles: [{ user_id: 's1', role: 'seller', full_name: 'Vendedor Uno' }],
  };
  const result = buildExecutiveAnalytics(data, { from: '2026-08-01', to: '2026-08-31', seller: 'all' }, '2026-08-10T12:00:00Z');
  assert.deepEqual(result.funnel.map((item) => item.count), [2, 1, 1, 1]);
  assert.equal(result.cycles[0].days, 2);
  assert.equal(result.cycles[1].days, 2);
  assert.equal(result.cycles[2].days, 3);
  assert.equal(result.cycles[3].days, 1);
  assert.equal(result.financial.revenueBeforeVat, 100_000);
  assert.equal(result.financial.actualMargin, 35_000);
  assert.equal(result.financial.marginPercent, 35);
  assert.equal(result.exceptions[0].type, 'Tarea vencida');
  assert.equal(result.sellers[0].conversion, 100);
});

test('respeta vendedor y fechas sin ocultar sus alertas operativas vigentes', () => {
  const result = buildExecutiveAnalytics({
    leads: [{ id: 'l1', owner_user_id: 's2', created_at: '2026-07-01T00:00:00Z' }],
    quotes: [],
    projects: [{ id: 'p2', seller_user_id: 's2', folio: 'P-2', health: 'blocked', blocked_reason: 'Acceso pendiente', created_at: '2026-07-02T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', solar_project_cost_entries: [], solar_commissions: [] }],
    workOrders: [], cfeCases: [], tasks: [], profiles: [],
  }, { from: '2026-08-01', to: '2026-08-31', seller: 's2' }, '2026-08-10T00:00:00Z');
  assert.equal(result.funnel[0].count, 0);
  assert.equal(result.financial.projectCount, 0);
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].title, 'Acceso pendiente');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { financeReportRows, financeRowsToCsv, projectFinancials } from '../src/lib/solar/financial-control.mjs';

test('calcula cobro neto, costos y margen sin mezclar IVA', () => {
  const result = projectFinancials({
    amount_before_vat_mxn: 100000, agreed_total_mxn: 116000,
    solar_payments: [{ status: 'reconciled', amount_mxn: 58000 }, { status: 'refunded', amount_mxn: 58000 }],
    solar_payment_refunds: [{ status: 'approved', amount_mxn: 16000 }],
    solar_project_cost_entries: [
      { cost_stage: 'budget', status: 'approved', amount_before_vat_mxn: 50000 },
      { cost_stage: 'actual', status: 'paid', amount_before_vat_mxn: 48000 },
      { cost_stage: 'actual', status: 'void', amount_before_vat_mxn: 9000 },
    ],
    solar_commissions: [{ status: 'paid', payable_amount_mxn: 7000, net_commission_mxn: 3500, recovered_amount_mxn: 3500 }],
  });
  assert.equal(result.netCollections, 100000);
  assert.equal(result.estimatedMargin, 46500);
  assert.equal(result.actualMargin, 48500);
});

test('genera CSV contable con comillas y columnas estables', () => {
  const rows = financeReportRows([{ folio: 'P-1', customer_name: 'Cliente, Norte', accepted_at: '2026-08-08T00:00:00Z', amount_before_vat_mxn: 100, agreed_total_mxn: 116 }]);
  const csv = financeRowsToCsv(rows);
  assert.match(csv, /Folio,Cliente,Vendedor/);
  assert.match(csv, /"Cliente, Norte"/);
  assert.equal(csv.split('\r\n').length, 2);
});

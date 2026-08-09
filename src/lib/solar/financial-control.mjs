export const COST_CATEGORY_LABELS = {
  modules: 'Paneles', inverter: 'Inversor', structure: 'Estructura', electrical: 'Material eléctrico',
  labor: 'Mano de obra', engineering: 'Ingeniería', interconnection: 'Interconexión CFE',
  travel: 'Traslados', subcontractor: 'Subcontratista', warranty: 'Garantía', other: 'Otro',
};

const amount = (value) => Number(value ?? 0) || 0;
const sum = (items, selector) => items.reduce((total, item) => total + selector(item), 0);

export function projectFinancials(project) {
  const payments = project.solar_payments ?? [];
  const refunds = project.solar_payment_refunds ?? [];
  const costs = project.solar_project_cost_entries ?? [];
  const commission = project.solar_commissions?.[0] ?? null;
  const grossCollections = sum(payments.filter((item) => ['reconciled', 'refunded'].includes(item.status)), (item) => amount(item.amount_mxn));
  const approvedRefunds = sum(refunds.filter((item) => item.status === 'approved'), (item) => amount(item.amount_mxn));
  const budgetCost = sum(costs.filter((item) => item.cost_stage === 'budget' && item.status !== 'void'), (item) => amount(item.amount_before_vat_mxn));
  const committedCost = sum(costs.filter((item) => item.cost_stage === 'actual' && ['committed', 'paid'].includes(item.status)), (item) => amount(item.amount_before_vat_mxn));
  const actualCost = sum(costs.filter((item) => item.cost_stage === 'actual' && item.status === 'paid'), (item) => amount(item.amount_before_vat_mxn));
  const commissionNet = commission ? amount(commission.net_commission_mxn ?? commission.payable_amount_mxn) : 0;
  const commissionCash = commission?.status === 'paid' ? Math.max(amount(commission.payable_amount_mxn) - amount(commission.recovered_amount_mxn), 0) : 0;
  const revenueBeforeVat = amount(project.amount_before_vat_mxn);
  return {
    revenueBeforeVat,
    totalWithVat: amount(project.agreed_total_mxn),
    grossCollections,
    approvedRefunds,
    netCollections: Math.max(grossCollections - approvedRefunds, 0),
    budgetCost,
    committedCost,
    actualCost,
    commissionNet,
    commissionCash,
    estimatedMargin: revenueBeforeVat - budgetCost - commissionNet,
    actualMargin: revenueBeforeVat - actualCost - commissionCash,
    estimatedMarginPercent: revenueBeforeVat ? (revenueBeforeVat - budgetCost - commissionNet) / revenueBeforeVat * 100 : 0,
    actualMarginPercent: revenueBeforeVat ? (revenueBeforeVat - actualCost - commissionCash) / revenueBeforeVat * 100 : 0,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function financeReportRows(projects, profileMap = {}) {
  return projects.map((project) => {
    const values = projectFinancials(project);
    return {
      folio: project.folio,
      cliente: project.customer_name,
      vendedor: profileMap[project.seller_user_id]?.full_name ?? 'Sin asignar',
      fechaVenta: String(project.accepted_at ?? '').slice(0, 10),
      ingresoAntesIVA: values.revenueBeforeVat.toFixed(2),
      totalConIVA: values.totalWithVat.toFixed(2),
      cobradoNeto: values.netCollections.toFixed(2),
      costoPresupuestado: values.budgetCost.toFixed(2),
      costoRealPagado: values.actualCost.toFixed(2),
      comisionNeta: values.commissionNet.toFixed(2),
      margenEstimado: values.estimatedMargin.toFixed(2),
      margenReal: values.actualMargin.toFixed(2),
      margenRealPorcentaje: values.actualMarginPercent.toFixed(2),
    };
  });
}

export function financeRowsToCsv(rows) {
  const columns = [
    ['folio', 'Folio'], ['cliente', 'Cliente'], ['vendedor', 'Vendedor'], ['fechaVenta', 'Fecha de venta'],
    ['ingresoAntesIVA', 'Ingreso antes de IVA'], ['totalConIVA', 'Total con IVA'], ['cobradoNeto', 'Cobrado neto'],
    ['costoPresupuestado', 'Costo presupuestado antes de IVA'], ['costoRealPagado', 'Costo real pagado antes de IVA'],
    ['comisionNeta', 'Comisión neta'], ['margenEstimado', 'Margen estimado'], ['margenReal', 'Margen real'],
    ['margenRealPorcentaje', 'Margen real %'],
  ];
  return [columns.map(([, label]) => csvCell(label)).join(','), ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(','))].join('\r\n');
}

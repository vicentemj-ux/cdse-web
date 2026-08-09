import { projectFinancials } from './financial-control.mjs';

const DAY_MS = 86_400_000;
const TERMINAL_TASKS = new Set(['completed', 'cancelled']);
const TERMINAL_ORDERS = new Set(['completed', 'cancelled']);
const TERMINAL_CFE = new Set(['interconnected', 'closed', 'cancelled']);

const time = (value) => {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const inRange = (value, from, to) => {
  const stamp = time(value);
  if (stamp === null) return false;
  return (!from || stamp >= from) && (!to || stamp <= to);
};

const daysBetween = (start, end) => {
  const first = time(start);
  const last = time(end);
  return first === null || last === null || last < first ? null : (last - first) / DAY_MS;
};

export function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function cycle(label, values) {
  const valid = values.filter(Number.isFinite);
  return { label, days: median(valid), sample: valid.length };
}

function sellerForQuote(quote, leadMap) {
  return quote.created_by ?? leadMap.get(quote.lead_id)?.owner_user_id ?? null;
}

function sellerAllowed(sellerId, selectedSeller) {
  return !selectedSeller || selectedSeller === 'all' || sellerId === selectedSeller;
}

function endOfDate(value) {
  if (!value) return null;
  const stamp = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

function startOfDate(value) {
  if (!value) return null;
  const stamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

export function buildExecutiveAnalytics(data, filters = {}, nowValue = new Date()) {
  const now = time(nowValue) ?? Date.now();
  const from = startOfDate(filters.from);
  const to = endOfDate(filters.to);
  const selectedSeller = filters.seller ?? 'all';
  const leads = data.leads ?? [];
  const quotes = data.quotes ?? [];
  const projects = data.projects ?? [];
  const workOrders = data.workOrders ?? [];
  const cfeCases = data.cfeCases ?? [];
  const tasks = data.tasks ?? [];
  const profiles = data.profiles ?? [];
  const leadMap = new Map(leads.map((item) => [item.id, item]));
  const quoteMap = new Map(quotes.map((item) => [item.id, item]));
  const projectMap = new Map(projects.map((item) => [item.id, item]));

  const cohortLeads = leads.filter((lead) => sellerAllowed(lead.owner_user_id, selectedSeller) && inRange(lead.created_at, from, to));
  const cohortLeadIds = new Set(cohortLeads.map((item) => item.id));
  const cohortQuotes = quotes.filter((quote) => cohortLeadIds.has(quote.lead_id) && sellerAllowed(sellerForQuote(quote, leadMap), selectedSeller));
  const quotedLeadIds = new Set(cohortQuotes.map((item) => item.lead_id));
  const cohortQuoteIds = new Set(cohortQuotes.map((item) => item.id));
  const cohortProjects = projects.filter((project) => cohortQuoteIds.has(project.quote_id));
  const soldLeadIds = new Set(cohortProjects.map((item) => item.lead_id));
  const operationalLeadIds = new Set(cohortProjects.filter((item) => item.status === 'operational' || item.commissioned_at).map((item) => item.lead_id));

  const funnel = [
    { id: 'leads', label: 'Leads recibidos', count: cohortLeads.length, rate: 100 },
    { id: 'quoted', label: 'Leads cotizados', count: quotedLeadIds.size, rate: cohortLeads.length ? quotedLeadIds.size / cohortLeads.length * 100 : 0 },
    { id: 'sold', label: 'Proyectos vendidos', count: soldLeadIds.size, rate: cohortLeads.length ? soldLeadIds.size / cohortLeads.length * 100 : 0 },
    { id: 'operational', label: 'Sistemas operando', count: operationalLeadIds.size, rate: cohortLeads.length ? operationalLeadIds.size / cohortLeads.length * 100 : 0 },
  ];

  const scopedProjects = projects.filter((project) => sellerAllowed(project.seller_user_id, selectedSeller));
  const periodProjects = scopedProjects.filter((project) => inRange(project.accepted_at ?? project.created_at, from, to));
  const projectIds = new Set(periodProjects.map((item) => item.id));
  const quoteToProject = new Map(scopedProjects.map((item) => [item.quote_id, item]));
  const completedOrderByProject = new Map();
  workOrders.filter((item) => item.status === 'completed' && item.completed_at).forEach((order) => {
    const existing = completedOrderByProject.get(order.project_id);
    if (!existing || time(order.completed_at) < time(existing.completed_at)) completedOrderByProject.set(order.project_id, order);
  });
  const cfeByProject = new Map(cfeCases.map((item) => [item.project_id, item]));

  const leadToQuoteDurations = cohortLeads.map((lead) => {
    const first = cohortQuotes.filter((quote) => quote.lead_id === lead.id).sort((a, b) => time(a.created_at) - time(b.created_at))[0];
    return daysBetween(lead.created_at, first?.created_at);
  });
  const quoteToSaleDurations = cohortQuotes.map((quote) => {
    const project = quoteToProject.get(quote.id);
    return daysBetween(quote.created_at, project?.accepted_at ?? project?.created_at);
  });
  const saleToInstallDurations = periodProjects.map((project) => daysBetween(project.accepted_at ?? project.created_at, completedOrderByProject.get(project.id)?.completed_at));
  const installToGridDurations = periodProjects.map((project) => {
    const order = completedOrderByProject.get(project.id);
    const cfe = cfeByProject.get(project.id);
    return daysBetween(order?.completed_at, cfe?.interconnected_at ?? project.commissioned_at);
  });
  const cycles = [
    cycle('Lead → cotización', leadToQuoteDurations),
    cycle('Cotización → venta', quoteToSaleDurations),
    cycle('Venta → instalación', saleToInstallDurations),
    cycle('Instalación → red CFE', installToGridDurations),
  ];

  const exceptionProjects = scopedProjects.filter((item) => ['at_risk', 'blocked', 'overdue'].includes(item.health));
  const scopedProjectIds = new Set(scopedProjects.map((item) => item.id));
  const overdueTasks = tasks.filter((item) => scopedProjectIds.has(item.project_id) && !TERMINAL_TASKS.has(item.status) && time(item.due_at) !== null && time(item.due_at) < now);
  const lateOrders = workOrders.filter((item) => scopedProjectIds.has(item.project_id) && !TERMINAL_ORDERS.has(item.status) && time(item.scheduled_end) !== null && time(item.scheduled_end) < now);
  const pendingCfe = cfeCases.filter((item) => scopedProjectIds.has(item.project_id) && !TERMINAL_CFE.has(item.status) && item.waiting_on && item.waiting_on !== 'none');
  const exceptions = [
    ...exceptionProjects.map((project) => ({ id: `project-${project.id}`, type: 'Proyecto', severity: project.health, projectId: project.id, folio: project.folio, title: project.blocked_reason || project.next_action || 'Proyecto requiere intervención', ageDays: daysBetween(project.updated_at, nowValue) })),
    ...overdueTasks.map((task) => ({ id: `task-${task.id}`, type: 'Tarea vencida', severity: 'overdue', projectId: task.project_id, folio: task.solar_projects?.folio ?? projectMap.get(task.project_id)?.folio, title: task.title, ageDays: daysBetween(task.due_at, nowValue) })),
    ...lateOrders.map((order) => ({ id: `order-${order.id}`, type: 'Instalación', severity: order.status === 'paused' ? 'blocked' : 'overdue', projectId: order.project_id, folio: order.solar_projects?.folio ?? projectMap.get(order.project_id)?.folio, title: order.status === 'paused' ? order.safety_stop_reason : 'La ventana planeada terminó', ageDays: daysBetween(order.scheduled_end, nowValue) })),
    ...pendingCfe.map((item) => ({ id: `cfe-${item.id}`, type: 'Expediente CFE', severity: item.waiting_on === 'cdse' ? 'blocked' : 'at_risk', projectId: item.project_id, folio: item.solar_projects?.folio ?? projectMap.get(item.project_id)?.folio, title: `En espera de ${item.waiting_on.toUpperCase()}`, ageDays: daysBetween(item.waiting_since, nowValue) })),
  ].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

  const financial = periodProjects.reduce((result, project) => {
    const values = projectFinancials(project);
    result.revenueBeforeVat += values.revenueBeforeVat;
    result.actualCost += values.actualCost;
    result.actualMargin += values.actualMargin;
    result.commissionNet += values.commissionNet;
    result.commissionPaid += values.commissionCash;
    return result;
  }, { revenueBeforeVat: 0, actualCost: 0, actualMargin: 0, commissionNet: 0, commissionPaid: 0 });
  financial.marginPercent = financial.revenueBeforeVat ? financial.actualMargin / financial.revenueBeforeVat * 100 : 0;
  financial.projectCount = periodProjects.length;

  const sellerIds = new Set([
    ...profiles.filter((item) => ['admin', 'seller'].includes(item.role)).map((item) => item.user_id),
    ...quotes.map((item) => sellerForQuote(item, leadMap)).filter(Boolean),
    ...projects.map((item) => item.seller_user_id).filter(Boolean),
  ]);
  const sellers = [...sellerIds].map((sellerId) => {
    const sellerQuotes = quotes.filter((quote) => sellerForQuote(quote, leadMap) === sellerId && inRange(quote.created_at, from, to));
    const sellerProjects = projects.filter((project) => project.seller_user_id === sellerId && inRange(project.accepted_at ?? project.created_at, from, to));
    const sellerQuoteIds = new Set(sellerQuotes.map((item) => item.id));
    const soldQuotes = sellerProjects.filter((item) => sellerQuoteIds.has(item.quote_id)).length;
    const totals = sellerProjects.reduce((result, project) => {
      const values = projectFinancials(project);
      result.revenue += values.revenueBeforeVat;
      result.margin += values.actualMargin;
      result.commission += values.commissionNet;
      return result;
    }, { revenue: 0, margin: 0, commission: 0 });
    return {
      id: sellerId,
      name: profiles.find((item) => item.user_id === sellerId)?.full_name ?? 'Vendedor sin perfil',
      quotes: sellerQuotes.length,
      sales: sellerProjects.length,
      cohortSales: soldQuotes,
      conversion: sellerQuotes.length ? soldQuotes / sellerQuotes.length * 100 : 0,
      ...totals,
    };
  }).filter((item) => selectedSeller === 'all' || item.id === selectedSeller).sort((a, b) => b.revenue - a.revenue);

  return {
    funnel,
    cycles,
    exceptions,
    financial,
    sellers,
    meta: { cohortSize: cohortLeads.length, periodProjectCount: periodProjects.length, generatedAt: new Date(now).toISOString() },
  };
}

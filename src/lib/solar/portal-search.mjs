const TYPE_PRIORITY = { project: 0, quote: 1, cfe: 2, asset: 3, serial: 3, lead: 4, receipt: 5 };

export function normalizePortalSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-MX')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function entry(type, id, view, title, subtitle, fields = {}, projectId = null) {
  const searchable = normalizePortalSearch([title, subtitle, ...Object.values(fields)].filter(Boolean).join(' '));
  return { type, id, view, title, subtitle, fields, projectId, searchable };
}

export function buildPortalSearchIndex(data = {}) {
  const rows = [];
  for (const project of data.projects ?? []) {
    rows.push(entry('project', project.id, 'projects', project.folio, project.customer_name, {
      service: project.service_number,
      quote: project.solar_quotes?.folio,
      cfe: project.cfe_tracking_folio,
      status: project.status,
    }, project.id));
    for (const asset of project.solar_assets ?? []) {
      if (!asset.serial_number) continue;
      rows.push(entry('asset', asset.id, 'post-sales', asset.serial_number, `${asset.manufacturer ?? ''} ${asset.model ?? ''}`.trim(), {
        project: project.folio,
        customer: project.customer_name,
        service: project.service_number,
      }, project.id));
    }
  }
  for (const quote of data.quotes ?? []) {
    const customer = quote.solar_leads?.name ?? quote.customer_name ?? 'Prospecto';
    rows.push(entry('quote', quote.id, 'quotes', quote.folio, customer, {
      phone: quote.solar_leads?.phone_e164,
      email: quote.solar_leads?.email,
      municipality: quote.solar_leads?.municipality,
      service: quote.service_number ?? quote.solar_receipts?.service_number,
    }));
  }
  for (const serial of data.inventorySerials ?? []) {
    rows.push(entry('serial', serial.id, 'inventory', serial.serial_number, serial.solar_inventory_items?.name ?? 'Equipo serializado', {
      sku: serial.solar_inventory_items?.sku,
      project: serial.solar_projects?.folio,
      customer: serial.solar_projects?.customer_name,
      status: serial.status,
      workOrder: serial.solar_work_orders?.folio,
    }, serial.project_id));
  }
  for (const cfeCase of data.cfeCases ?? []) {
    rows.push(entry('cfe', cfeCase.id, 'cfe', cfeCase.tracking_folio || 'Trámite CFE sin folio', cfeCase.solar_projects?.customer_name ?? 'Proyecto CFE', {
      project: cfeCase.solar_projects?.folio,
      service: cfeCase.service_number,
      oldMeter: cfeCase.previous_meter_serial,
      newMeter: cfeCase.bidirectional_meter_serial,
      contracts: `${cfeCase.interconnection_contract_number ?? ''} ${cfeCase.compensation_contract_number ?? ''}`,
    }, cfeCase.project_id));
  }
  for (const lead of data.leads ?? []) {
    rows.push(entry('lead', lead.id, 'leads', lead.name, lead.phone_e164 ?? lead.email ?? 'Lead', {
      email: lead.email,
      municipality: lead.municipality,
      postalCode: lead.postal_code,
    }));
  }
  for (const receipt of data.receipts ?? []) {
    rows.push(entry('receipt', receipt.id, 'leads', receipt.customer_name || 'Recibo CFE', receipt.service_number ?? receipt.tariff_code ?? 'Recibo', {
      service: receipt.service_number,
      tariff: receipt.tariff_code,
    }));
  }
  return rows;
}

export function searchPortalIndex(index, query, limit = 10) {
  const normalized = normalizePortalSearch(query);
  if (normalized.length < 2) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return index
    .filter((item) => tokens.every((token) => item.searchable.includes(token)))
    .map((item) => {
      const title = normalizePortalSearch(item.title);
      const score = title === normalized ? -30 : title.startsWith(normalized) ? -20 : title.includes(normalized) ? -10 : 0;
      return { ...item, score: score + (TYPE_PRIORITY[item.type] ?? 9) };
    })
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'es-MX'))
    .slice(0, Math.max(1, limit));
}

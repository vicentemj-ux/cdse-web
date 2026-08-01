const COLORS = {
  navy: '#071f38',
  navy2: '#123858',
  lime: '#9bd400',
  amber: '#e9a91b',
  teal: '#078f88',
  ink: '#10263e',
  slate: '#62758a',
  line: '#d8e2ea',
  mist: '#f2f6f8',
  paper: '#fbfcfa',
  white: '#ffffff',
};

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value, fallback = 'Por confirmar') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function color(doc, hex, stroke = false) {
  const rgb = hexToRgb(hex);
  if (stroke) doc.setDrawColor(...rgb);
  else doc.setTextColor(...rgb);
}

function fill(doc, hex) {
  doc.setFillColor(...hexToRgb(hex));
}

function line(doc, x1, y1, x2, y2, hex = COLORS.line, width = 0.25) {
  color(doc, hex, true);
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
}

function text(doc, value, x, y, options = {}) {
  const {
    size = 9, weight = 'normal', tone = COLORS.ink, align = 'left',
    maxWidth, lineHeight = 1.25,
  } = options;
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  color(doc, tone);
  doc.setLineHeightFactor(lineHeight);
  const content = maxWidth ? doc.splitTextToSize(clean(value, ''), maxWidth) : clean(value, '');
  doc.text(content, x, y, { align });
  return Array.isArray(content) ? content.length : 1;
}

function rounded(doc, x, y, w, h, background, radius = 3, border = null) {
  fill(doc, background);
  if (border) color(doc, border, true);
  else doc.setDrawColor(...hexToRgb(background));
  doc.roundedRect(x, y, w, h, radius, radius, border ? 'FD' : 'F');
}

async function urlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar el recurso PDF: ${url}`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function normalizedPeriods(quote) {
  const periods = quote.solar_receipts?.solar_consumption_periods
    ?? quote.solar_consumption_periods
    ?? [];
  return [...periods]
    .sort((a, b) => n(a.sequence) - n(b.sequence))
    .filter((item) => n(item.kwh) > 0)
    .slice(0, 6);
}

function periodLabel(period, index) {
  if (period.period_start && period.period_end) {
    const start = new Date(`${period.period_start}T12:00:00`);
    const end = new Date(`${period.period_end}T12:00:00`);
    const month = new Intl.DateTimeFormat('es-MX', { month: 'short' });
    return `${month.format(start)}-${month.format(end)}`.replace('.', '').toUpperCase();
  }
  return `PERIODO ${index + 1}`;
}

function metricsFor(quote) {
  const result = quote.result_snapshot ?? {};
  const input = quote.input_snapshot ?? {};
  const periods = normalizedPeriods(quote);
  const coveredMonths = periods.reduce((sum, item) => sum + n(item.covered_months, 2), 0);
  const capturedKwh = periods.reduce((sum, item) => sum + n(item.kwh), 0);
  const capturedBill = periods.reduce((sum, item) => sum + n(item.amount_mxn), 0);
  const annualConsumption = n(result.annualConsumptionKwh ?? input.annualConsumptionKwh,
    coveredMonths ? capturedKwh * (12 / coveredMonths) : capturedKwh);
  const annualBill = coveredMonths ? capturedBill * (12 / coveredMonths) : capturedBill;
  const annualGeneration = n(result.annualGenerationKwh);
  const coverage = n(result.estimatedCoverage, annualConsumption ? annualGeneration / annualConsumption : 0);
  const residualRatio = annualConsumption ? Math.max(0.08, 1 - Math.min(coverage, 0.92)) : 0;
  const projectedBill = annualBill ? annualBill * residualRatio : 0;
  const annualSavings = Math.max(0, annualBill - projectedBill);
  const total = n(quote.total_mxn);
  const roiYears = annualSavings ? total / annualSavings : 0;
  return {
    result, input, periods, annualConsumption, annualBill, annualGeneration,
    coverage, projectedBill, annualSavings, total, roiYears,
  };
}

function header(doc, logo, ciae, quote, page, title) {
  rounded(doc, 14, 10, 54, 15, COLORS.navy, 2);
  text(doc, 'CDSE', 18, 19, { size: 12, weight: 'bold', tone: COLORS.white });
  text(doc, 'ENERGIA SOLAR', 48, 18.5, { size: 5.5, weight: 'bold', tone: COLORS.lime });
  if (logo) doc.addImage(logo, 'PNG', 14, 10, 54, 15, 'cdse-logo', 'FAST');
  text(doc, title.toUpperCase(), 196, 14, { size: 7.5, weight: 'bold', tone: COLORS.navy, align: 'right' });
  text(doc, clean(quote.folio), 196, 20, { size: 12, weight: 'bold', tone: COLORS.navy, align: 'right' });
  text(doc, new Date(quote.created_at ?? Date.now()).toLocaleDateString('es-MX'), 196, 25, { size: 7.5, tone: COLORS.slate, align: 'right' });
  line(doc, 14, 31, 196, 31, COLORS.line, 0.4);
  fill(doc, COLORS.navy);
  doc.rect(0, 280, 210, 17, 'F');
  fill(doc, COLORS.amber);
  doc.rect(0, 280, 210, 1.2, 'F');
  text(doc, 'Calle Morelos #209 Ote. | Col. Centro | Los Mochis, Sinaloa.', 14, 287, { size: 6.1, tone: COLORS.white });
  text(doc, 'Tel: 668.1774845  |  cdse.com.mx/solar', 14, 293, { size: 6, tone: '#cad7e2' });
  if (ciae) doc.addImage(ciae, 'PNG', 171.5, 281.5, 13.5, 13.5, `ciae-footer-${page}`, 'FAST');
  text(doc, `PAGINA ${page} DE 3`, 205, 293, { size: 6.8, weight: 'bold', tone: COLORS.white, align: 'right' });
}

function labelValue(doc, label, value, x, y, width = 38) {
  text(doc, label.toUpperCase(), x, y, { size: 6.5, weight: 'bold', tone: COLORS.slate });
  text(doc, value, x, y + 6, { size: 11, weight: 'bold', tone: COLORS.navy, maxWidth: width });
}

function benefit(doc, x, y, title, detail, glyph) {
  rounded(doc, x, y, 42, 25, COLORS.mist, 2);
  rounded(doc, x + 3, y + 4, 7, 7, COLORS.lime, 2);
  text(doc, glyph, x + 6.5, y + 9.2, { size: 7, weight: 'bold', tone: COLORS.navy, align: 'center' });
  text(doc, title, x + 13, y + 8, { size: 7.5, weight: 'bold', tone: COLORS.navy, maxWidth: 26 });
  text(doc, detail, x + 3, y + 18, { size: 6.2, tone: COLORS.slate, maxWidth: 36, lineHeight: 1.15 });
}

function drawPageOne(doc, quote, assets, m) {
  header(doc, assets.logoData, assets.ciaeData, quote, 1, 'Propuesta solar personalizada');
  text(doc, 'SISTEMA FOTOVOLTAICO', 14, 45, { size: 8, weight: 'bold', tone: COLORS.amber });
  text(doc, 'Energia propia,', 14, 58, { size: 27, weight: 'bold', tone: COLORS.navy });
  text(doc, 'decision inteligente.', 14, 70, { size: 27, weight: 'bold', tone: COLORS.teal });
  text(doc, 'Propuesta tecnica y comercial preparada con base en el recibo CFE y el dimensionamiento solar de la zona.', 14, 79, { size: 8.5, tone: COLORS.slate, maxWidth: 115 });

  rounded(doc, 139, 40, 57, 44, COLORS.navy, 4);
  text(doc, 'INVERSION DEL PROYECTO', 145, 51, { size: 7, weight: 'bold', tone: COLORS.lime });
  text(doc, MXN.format(m.total), 145, 65, { size: 21, weight: 'bold', tone: COLORS.white });
  text(doc, 'IVA incluido', 145, 74, { size: 7, tone: '#cad7e2' });

  rounded(doc, 14, 92, 182, 32, COLORS.mist, 3, COLORS.line);
  labelValue(doc, 'Cliente', quote.solar_leads?.name, 20, 101, 62);
  labelValue(doc, 'Tarifa CFE', m.input.tariffCode ?? quote.solar_receipts?.tariff_code, 91, 101, 28);
  labelValue(doc, 'Ubicacion', quote.solar_leads?.municipality ?? 'Los Mochis', 128, 101, 52);

  text(doc, 'RESUMEN EJECUTIVO', 14, 138, { size: 10, weight: 'bold', tone: COLORS.navy });
  line(doc, 14, 143, 196, 143, COLORS.amber, 0.7);
  const statWidth = 43.5;
  const stats = [
    ['SISTEMA', `${NUM.format(n(m.result.systemDcKw))} kWp`],
    ['PANELES', `${n(quote.panel_count ?? m.result.panelCount)} paneles`],
    ['PRODUCCION', `${NUM.format(m.annualGeneration)} kWh/año`],
    ['COBERTURA', m.coverage ? `${NUM.format(m.coverage * 100)}% estimada` : 'Por validar'],
  ];
  stats.forEach(([label, value], index) => {
    const x = 14 + index * 46;
    rounded(doc, x, 150, statWidth, 31, index === 0 ? COLORS.navy : COLORS.mist, 2);
    text(doc, label, x + 4, 159, { size: 6.2, weight: 'bold', tone: index === 0 ? COLORS.lime : COLORS.slate });
    text(doc, value, x + 4, 171, { size: 11, weight: 'bold', tone: index === 0 ? COLORS.white : COLORS.navy, maxWidth: 35 });
  });

  rounded(doc, 14, 190, 88, 42, COLORS.navy, 3);
  text(doc, 'SISTEMA PROPUESTO', 20, 201, { size: 9, weight: 'bold', tone: COLORS.lime });
  text(doc, `${n(quote.panel_count ?? m.result.panelCount)} paneles de ${n(quote.solar_modules?.watts ?? quote.configuration_snapshot?.module?.watts)} W`, 20, 214, { size: 14, weight: 'bold', tone: COLORS.white });
  text(doc, 'Proyecto llave en mano: materiales, ingenieria, instalacion, puesta en marcha y gestion ante CFE.', 20, 223, { size: 6.8, tone: '#cad7e2', maxWidth: 72 });

  rounded(doc, 108, 190, 88, 42, COLORS.mist, 3, COLORS.line);
  text(doc, 'CONSUMO ACTUAL SEGUN RECIBO', 114, 201, { size: 8, weight: 'bold', tone: COLORS.navy });
  text(doc, `${NUM.format(m.annualConsumption)} kWh/año`, 114, 214, { size: 14, weight: 'bold', tone: COLORS.teal });
  text(doc, `No. de servicio: ${clean(quote.solar_receipts?.service_number ?? quote.solar_receipts?.service_number_last4, 'Por confirmar')}`, 114, 223, { size: 6.8, tone: COLORS.slate });

  text(doc, 'RESPALDO QUE ACOMPANA TU PROYECTO', 14, 247, { size: 9, weight: 'bold', tone: COLORS.navy });
  benefit(doc, 14, 253, 'Instalacion profesional', 'Revision y montaje por tecnicos.', '01');
  benefit(doc, 60, 253, 'Gestion ante CFE', 'Acompanamiento de interconexion.', '02');
  benefit(doc, 106, 253, 'Monitoreo', 'Seguimiento de la produccion.', '03');
  benefit(doc, 152, 253, 'Financiamiento', 'Disponible desde 8 paneles.', '04');
}

function drawBars(doc, periods, m) {
  const x = 24; const y = 83; const w = 162; const h = 54;
  const values = periods.flatMap((item) => [n(item.kwh), m.annualGeneration / Math.max(periods.length, 1)]);
  const max = Math.max(...values, 1) * 1.12;
  [0, .25, .5, .75, 1].forEach((fraction) => line(doc, x, y + h * fraction, x + w, y + h * fraction, COLORS.line, 0.2));
  periods.forEach((period, index) => {
    const group = w / periods.length;
    const baseX = x + group * index + group * .22;
    const consumptionH = (n(period.kwh) / max) * h;
    const generationH = ((m.annualGeneration / periods.length) / max) * h;
    fill(doc, COLORS.teal); doc.rect(baseX, y + h - consumptionH, group * .22, consumptionH, 'F');
    fill(doc, COLORS.amber); doc.rect(baseX + group * .27, y + h - generationH, group * .22, generationH, 'F');
    text(doc, periodLabel(period, index), baseX + group * .24, y + h + 6, { size: 5.4, tone: COLORS.slate, align: 'center' });
  });
  rounded(doc, 24, 145, 4, 4, COLORS.teal, 1); text(doc, 'Consumo CFE', 31, 148.5, { size: 6.5, tone: COLORS.slate });
  rounded(doc, 62, 145, 4, 4, COLORS.amber, 1); text(doc, 'Generacion solar estimada', 69, 148.5, { size: 6.5, tone: COLORS.slate });
}

function drawPageTwo(doc, quote, assets, m) {
  header(doc, assets.logoData, assets.ciaeData, quote, 2, 'Estudio solar');
  text(doc, 'ESTUDIO SOLAR', 14, 48, { size: 8, weight: 'bold', tone: COLORS.amber });
  text(doc, 'Tu recibo, convertido en una decision clara.', 14, 61, { size: 22, weight: 'bold', tone: COLORS.navy });
  text(doc, 'Comparacion entre el consumo registrado y la energia que puede producir el sistema recomendado.', 14, 70, { size: 8.5, tone: COLORS.slate, maxWidth: 155 });

  const periods = m.periods.length ? m.periods : [{ kwh: m.annualConsumption / 6 }, { kwh: m.annualConsumption / 6 }, { kwh: m.annualConsumption / 6 }, { kwh: m.annualConsumption / 6 }, { kwh: m.annualConsumption / 6 }, { kwh: m.annualConsumption / 6 }];
  drawBars(doc, periods, m);

  text(doc, 'HISTORIAL Y PROYECCION', 14, 163, { size: 9.5, weight: 'bold', tone: COLORS.navy });
  const columns = [14, 50, 78, 108, 140, 169, 196];
  rounded(doc, 14, 169, 182, 10, COLORS.navy, 2);
  const heads = ['Periodo', 'Consumo', 'Generacion', 'Pago actual', 'Pago solar', 'Ahorro'];
  heads.forEach((head, index) => text(doc, head, columns[index] + 2, 175.5, { size: 6.2, weight: 'bold', tone: COLORS.white }));
  periods.forEach((period, index) => {
    const rowY = 179 + index * 8.5;
    if (index % 2 === 0) { fill(doc, COLORS.mist); doc.rect(14, rowY, 182, 8.5, 'F'); }
    const generation = m.annualGeneration / periods.length;
    const bill = n(period.amount_mxn);
    const residualRatio = n(period.kwh) ? Math.max(.08, 1 - Math.min(generation / n(period.kwh), .92)) : 0;
    const solarBill = bill * residualRatio;
    const values = [periodLabel(period, index), `${NUM.format(n(period.kwh))}`, `${NUM.format(generation)}`, bill ? MXN.format(bill) : '-', bill ? MXN.format(solarBill) : '-', bill ? MXN.format(Math.max(0, bill - solarBill)) : '-'];
    values.forEach((value, col) => text(doc, value, columns[col] + 2, rowY + 5.8, { size: 6.2, tone: COLORS.ink }));
  });
  const totalY = 179 + periods.length * 8.5;
  line(doc, 14, totalY, 196, totalY, COLORS.navy, 0.5);
  text(doc, 'TOTAL ANUAL', 16, totalY + 8, { size: 7, weight: 'bold', tone: COLORS.navy });
  text(doc, `${NUM.format(m.annualConsumption)} kWh`, 52, totalY + 8, { size: 7, weight: 'bold' });
  text(doc, `${NUM.format(m.annualGeneration)} kWh`, 80, totalY + 8, { size: 7, weight: 'bold' });
  text(doc, m.annualBill ? MXN.format(m.annualBill) : 'Sin monto', 110, totalY + 8, { size: 7, weight: 'bold' });
  text(doc, m.projectedBill ? MXN.format(m.projectedBill) : 'Por validar', 142, totalY + 8, { size: 7, weight: 'bold' });
  text(doc, m.annualSavings ? MXN.format(m.annualSavings) : 'Por validar', 171, totalY + 8, { size: 7, weight: 'bold', tone: COLORS.teal });

  const calloutY = totalY + 17;
  rounded(doc, 14, calloutY, 58, 24, COLORS.navy, 3);
  text(doc, 'COBERTURA ESTIMADA', 20, calloutY + 9, { size: 6.5, weight: 'bold', tone: COLORS.lime });
  text(doc, m.coverage ? `${NUM.format(m.coverage * 100)}%` : 'Por validar', 20, calloutY + 21, { size: 18, weight: 'bold', tone: COLORS.white });
  rounded(doc, 77, calloutY, 119, 24, COLORS.mist, 3, COLORS.line);
  text(doc, 'LECTURA HONESTA', 83, calloutY + 9, { size: 7, weight: 'bold', tone: COLORS.navy });
  text(doc, 'Los resultados dependen de sombras, orientacion, temperatura, tarifa y condiciones del inmueble. CDSE valida estos datos antes de instalar.', 83, calloutY + 16, { size: 6.5, tone: COLORS.slate, maxWidth: 103 });
}

function drawProjection(doc, x, y, w, h, m) {
  if (!m.annualSavings) {
    rounded(doc, x, y, w, h, COLORS.mist, 3, COLORS.line);
    text(doc, 'La proyeccion financiera se completa al validar los importes del recibo CFE.', x + 8, y + 19, { size: 8, tone: COLORS.slate, maxWidth: w - 16 });
    return;
  }
  const values = Array.from({ length: 5 }, (_, index) => m.annualSavings * (index + 1));
  const max = values.at(-1);
  line(doc, x, y + h, x + w, y + h, COLORS.line);
  values.forEach((value, index) => {
    const barW = 18;
    const barH = (value / max) * (h - 12);
    const barX = x + 10 + index * ((w - 20) / 5);
    fill(doc, index === 4 ? COLORS.lime : COLORS.navy);
    doc.rect(barX, y + h - barH, barW, barH, 'F');
    text(doc, MXN.format(value), barX + barW / 2, y + h - barH - 3, { size: 5.4, weight: 'bold', tone: COLORS.navy, align: 'center' });
    text(doc, `Ano ${index + 1}`, barX + barW / 2, y + h + 6, { size: 5.8, tone: COLORS.slate, align: 'center' });
  });
}

function checklistRow(doc, y, label, detail) {
  rounded(doc, 14, y, 88, 15, COLORS.mist, 2, COLORS.line);
  rounded(doc, 18, y + 4, 7, 7, COLORS.lime, 2);
  color(doc, COLORS.navy, true); doc.setLineWidth(0.8); doc.line(20, y + 7.5, 21.2, y + 9); doc.line(21.2, y + 9, 23.5, y + 6);
  text(doc, label, 29, y + 6.5, { size: 7.2, weight: 'bold', tone: COLORS.navy });
  text(doc, detail, 29, y + 11.8, { size: 5.8, tone: COLORS.slate, maxWidth: 66 });
}

function drawPageThree(doc, quote, assets, m) {
  header(doc, assets.logoData, assets.ciaeData, quote, 3, 'Propuesta comercial');
  text(doc, 'VALOR DEL PROYECTO', 14, 48, { size: 8, weight: 'bold', tone: COLORS.amber });
  text(doc, 'Una inversion respaldada por servicio local.', 14, 61, { size: 22, weight: 'bold', tone: COLORS.navy });
  text(doc, 'Ahorro proyectado, alcance y condiciones principales en una sola vista.', 14, 70, { size: 8.5, tone: COLORS.slate });

  // Sales-focused comparison inspired by the clearest competitor layouts:
  // the customer sees the current CFE cost, projected solar cost and the
  // resulting value before reading the technical conditions.
  rounded(doc, 14, 80, 182, 11, COLORS.teal, 3);
  text(doc, 'AHORRO EN SISTEMA SOLAR', 20, 87.5, { size: 11, weight: 'bold', tone: COLORS.white });
  text(doc, `Inversion total: ${MXN.format(m.total)}`, 190, 87.5, { size: 6.5, tone: '#d9f2ee', align: 'right' });

  rounded(doc, 14, 95, 91, 40, COLORS.mist, 3, COLORS.line);
  text(doc, 'PAGO CFE ANUAL', 20, 104, { size: 7.2, weight: 'bold', tone: COLORS.navy });
  text(doc, m.annualBill ? MXN.format(m.annualBill) : 'Por validar', 20, 120, { size: 15, weight: 'bold', tone: COLORS.navy });
  text(doc, 'Total observado en el recibo.', 20, 129, { size: 6.2, tone: COLORS.slate });
  rounded(doc, 108, 95, 88, 40, COLORS.amber, 3);
  text(doc, 'AHORRO ESTIMADO', 114, 104, { size: 7.2, weight: 'bold', tone: COLORS.navy });
  text(doc, m.annualSavings ? MXN.format(m.annualSavings) : 'Por validar', 114, 120, { size: 15, weight: 'bold', tone: COLORS.navy });
  text(doc, 'Lo que podria dejar de pagarse anualmente.', 114, 129, { size: 6.2, tone: COLORS.navy });

  rounded(doc, 14, 140, 91, 24, COLORS.mist, 3, COLORS.line);
  text(doc, 'PAGO PROYECTADO CON SOLAR', 20, 149, { size: 6.8, weight: 'bold', tone: COLORS.navy });
  text(doc, m.projectedBill ? MXN.format(m.projectedBill) : 'Por validar', 20, 159, { size: 12, weight: 'bold', tone: COLORS.teal });
  rounded(doc, 108, 140, 88, 24, COLORS.navy, 3);
  text(doc, 'RETORNO SIMPLE', 114, 149, { size: 6.8, weight: 'bold', tone: COLORS.lime });
  text(doc, m.roiYears ? `${NUM.format(m.roiYears)} años` : 'Por validar', 114, 159, { size: 12, weight: 'bold', tone: COLORS.white });

  text(doc, 'AHORRO ACUMULADO PROYECTADO', 14, 171, { size: 9.5, weight: 'bold', tone: COLORS.navy });
  text(doc, m.annualBill && m.annualSavings ? `${NUM.format((m.annualSavings / m.annualBill) * 100)}% de ahorro anual estimado` : 'Se completa al validar los importes del recibo.', 196, 171, { size: 6.5, tone: COLORS.slate, align: 'right' });
  drawProjection(doc, 14, 177, 182, 37, m);

  text(doc, 'QUE INCLUYE TU PROPUESTA', 14, 222, { size: 9.5, weight: 'bold', tone: COLORS.navy });
  checklistRow(doc, 228, 'Visita y levantamiento', 'Revision tecnica del sitio.');
  checklistRow(doc, 245, 'Ingenieria e instalacion', 'Diseno, montaje y puesta en marcha.');
  checklistRow(doc, 262, 'Interconexion y monitoreo', 'Acompanamiento ante CFE y seguimiento.');

  rounded(doc, 108, 228, 88, 48, COLORS.navy, 3);
  text(doc, 'CONDICIONES COMERCIALES', 115, 238, { size: 8, weight: 'bold', tone: COLORS.lime });
  const packageOffer = m.result.package ?? m.result.packageOffer;
  const financing = m.result.financing;
  text(doc, packageOffer?.name ?? `${n(quote.panel_count)} paneles instalados`, 115, 249, { size: 9.5, weight: 'bold', tone: COLORS.white, maxWidth: 70 });
  text(doc, financing ? `${financing.name}. Enganche ${MXN.format(n(financing.downPaymentMxn))}.` : 'Forma de pago y anticipo sujetos a la propuesta seleccionada.', 115, 260, { size: 6.7, tone: '#cad7e2', maxWidth: 70 });
  text(doc, 'Validacion final: techo, sombras, tablero y disponibilidad.', 115, 271, { size: 6.5, tone: '#cad7e2', maxWidth: 70 });
}

export async function createSolarQuotePdf(quote, providedAssets = {}) {
  const [{ jsPDF }, logoData, ciaeData] = await Promise.all([
    import('jspdf'),
    providedAssets.logoData ?? urlToDataUrl('/cdse-solar-logo-cropped.png'),
    providedAssets.ciaeData ?? urlToDataUrl('/ciae-certificado.png'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const assets = { logoData, ciaeData };
  const metrics = metricsFor(quote);
  doc.setProperties({
    title: `${clean(quote.folio)} - Propuesta CDSE Solar`,
    subject: 'Propuesta tecnica y comercial de sistema fotovoltaico',
    author: 'CDSE Solar',
    creator: 'Cotizador CDSE Solar',
  });
  drawPageOne(doc, quote, assets, metrics);
  doc.addPage();
  drawPageTwo(doc, quote, assets, metrics);
  doc.addPage();
  drawPageThree(doc, quote, assets, metrics);
  return doc;
}

export async function downloadSolarQuotePdf(quote) {
  const doc = await createSolarQuotePdf(quote);
  const folio = clean(quote.folio, 'CDSE-SOLAR').replace(/[^A-Za-z0-9_-]/g, '-');
  doc.save(`${folio}-propuesta.pdf`);
}

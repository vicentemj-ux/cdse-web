import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { calculatePanelRecommendation } from '../../../lib/solar/calculator.mjs';
import { parseCfeReceiptText } from '../../../lib/solar/cfe-receipt-parser.mjs';
import { extractReceiptText } from '../../../lib/solar/pdf-text.js';
import { expectedPeriodCount, isCompletePeriod, validatePeriodHistory } from '../../../lib/solar/periods.mjs';
import { downloadSolarQuotePdf } from '../../../lib/solar/quote-pdf.js';
import { calculateInverterSizing, selectSuggestedInverter } from '../../../lib/solar/inverter-sizing.mjs';
import { STAFF_ROLES, canOpenModule, canPerform, navigationForRole, roleLabel } from '../../../lib/solar/access-control.mjs';
import { COST_CATEGORY_LABELS, financeReportRows, financeRowsToCsv, projectFinancials } from '../../../lib/solar/financial-control.mjs';
import {
  downloadAuthorizationLetter,
  downloadDossierIndex,
  downloadSiteSurveyReport,
  exportProjectDossierZip,
} from '../../../lib/solar/project-documents.js';
import Installations from './Installations.jsx';
import CfeTracking from './CfeTracking.jsx';
import MobilePortalNavigation from './MobilePortalNavigation.jsx';
import PortalSearch from './PortalSearch.jsx';
import {
  getSupabaseClient,
  getSupabaseFunctionsUrl,
  hasSupabaseConfig,
} from '../../../lib/supabase/client.js';

const PostSales = lazy(() => import('./PostSales.jsx'));
const Inventory = lazy(() => import('./Inventory.jsx'));

const TARIFFS = ['1F', 'DAC', 'PDBT', 'GDBT', 'GDMTO', 'GDMTH', 'OTHER'];
const STATUS_LABELS = {
  borrador: 'Borrador',
  preliminar: 'Preliminar',
  validada: 'Lista para enviar',
  enviada: 'Propuesta enviada',
  aceptada: 'Venta cerrada',
  rechazada: 'Perdida',
  vencida: 'Vencida',
};
const STATUS_OPTIONS = ['borrador', 'preliminar', 'validada', 'enviada', 'aceptada', 'rechazada', 'vencida'];
const PROJECT_STATUS_LABELS = {
  sold_pending_validation: 'Entrega comercial',
  site_survey_scheduled: 'Visita programada',
  engineering: 'Ingeniería',
  documents_pending: 'Expediente pendiente',
  ready_for_submission: 'Listo para CFE',
  submitted_to_cfe: 'Ingresado a CFE',
  cfe_observation: 'Observación CFE',
  approved_for_installation: 'Aprobado para instalar',
  installation_scheduled: 'Instalación programada',
  installation_in_progress: 'En instalación',
  installed_pending_interconnection: 'Instalado, espera interconexión',
  meter_change_pending: 'Cambio de medidor',
  commissioning: 'Puesta en marcha',
  operational: 'Operando',
  on_hold: 'En pausa',
  cancelled: 'Cancelado',
};
const PROJECT_HEALTH_LABELS = {
  on_track: 'En tiempo',
  at_risk: 'En riesgo',
  blocked: 'Bloqueado',
  overdue: 'Vencido',
};
const DOCUMENT_STAGE_LABELS = {
  commercial: 'Comercial',
  site_survey: 'Levantamiento',
  engineering: 'Ingeniería',
  cfe: 'Interconexión CFE',
  installation: 'Instalación',
  handover: 'Entrega',
};
const TASK_TYPE_LABELS = {
  follow_up: 'Seguimiento',
  site_survey: 'Visita técnica',
  customer_document: 'Documento del cliente',
  engineering_review: 'Revisión de ingeniería',
  cfe_submission: 'Ingreso CFE',
  cfe_follow_up: 'Seguimiento CFE',
  installation: 'Instalación',
  inspection: 'Inspección y pruebas',
  meter_change: 'Cambio de medidor',
  commissioning: 'Puesta en marcha',
  collection: 'Cobro',
  warranty: 'Garantía',
  other: 'Otro',
};
const TECHNICAL_STATUS_LABELS = {
  draft: 'Borrador',
  submitted: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Requiere corrección',
};
const COMMISSION_STATUS_LABELS = {
  estimated: 'Proyectada',
  partially_earned: 'Devengada parcialmente',
  earned: 'Devengada',
  approved: 'Autorizada',
  paid: 'Pagada',
  void: 'Cancelada',
};
const PAYMENT_STATUS_LABELS = {
  pending: 'Por conciliar',
  reconciled: 'Conciliado',
  rejected: 'Rechazado',
  refunded: 'Reembolsado',
  partially_paid: 'Pago parcial',
  paid: 'Cubierto',
  overdue: 'Vencido',
  waived: 'Condonado',
  cancelled: 'Cancelado',
};
const ROOF_TYPE_LABELS = {
  concrete_slab: 'Losa de concreto',
  metal_sheet: 'Lámina metálica',
  tile: 'Teja',
  ground: 'Montaje en suelo',
  other: 'Otro',
};
const money = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

function quoteShareText(quote) {
  const lead = quote.solar_leads?.name ?? 'prospecto';
  const watts = quote.solar_modules?.watts ?? quote.configuration_snapshot?.module?.watts ?? '—';
  const panels = quote.panel_count ?? quote.result_snapshot?.panelCount ?? '—';
  return `Hola ${lead}, te compartimos la propuesta solar ${quote.folio}: ${panels} paneles de ${watts} W por ${money.format(Number(quote.total_mxn ?? 0))}. En CDSE podemos revisar los detalles y agendar el siguiente paso.`;
}

function printQuote(quote) {
  const lead = quote.solar_leads?.name ?? 'Prospecto';
  const module = quote.solar_modules ?? quote.configuration_snapshot?.module ?? {};
  const result = quote.result_snapshot ?? {};
  const packageOffer = result.package ?? result.packageOffer;
  const financing = result.financing;
  const annualConsumption = Number(result.annualConsumptionKwh ?? quote.input_snapshot?.annualConsumptionKwh ?? 0);
  const annualGeneration = Number(result.annualGenerationKwh ?? 0);
  const coverage = Number(result.estimatedCoverage ?? 0);
  const phone = quote.solar_leads?.phone_e164 ?? '';
  const email = quote.solar_leads?.email ?? '';
  const tariff = quote.input_snapshot?.tariffCode ?? quote.configuration_snapshot?.receipt?.tariffCode ?? 'PDBT';
  const annualBill = Number(quote.input_snapshot?.annualBillMxn ?? 0);
  const address = 'Calle Jose Maria Morelos 209, Col. Centro, C.P. 81200, Los Mochis, Sinaloa';
  // Abrimos la ventana desde el gesto del usuario; agregar noopener aquí puede
  // hacer que algunos navegadores la consideren un popup bloqueado.
  const printable = window.open('', '_blank');
  if (!printable) return;
  printable.opener = null;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const date = quote.created_at ? new Date(quote.created_at).toLocaleDateString('es-MX') : new Date().toLocaleDateString('es-MX');
  printable.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(quote.folio)} - CDSE Solar</title><style>
    :root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#10243e}*{box-sizing:border-box}body{margin:0;background:#e9eef2;color:#10243e}.page{width:210mm;min-height:297mm;margin:0 auto 20px;padding:17mm 17mm 15mm;background:#fff;position:relative;overflow:hidden;page-break-after:always}.page:last-child{page-break-after:auto}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.18em;color:#1767a5;font-size:12px}.brand-mark{width:34px;height:34px;border-radius:9px;background:#e6a21a;color:#10243e;display:grid;place-items:center;font-weight:900;font-size:18px}.topline{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #dbe4eb;padding-bottom:14px}.folio{font-size:12px;color:#1767a5;letter-spacing:.16em;font-weight:800}.date{font-size:12px;color:#708094;text-align:right}.date strong{display:block;color:#10243e;font-size:16px;margin-top:4px}.cover{margin-top:18mm;display:grid;grid-template-columns:1.08fr .92fr;gap:12mm;align-items:center}.cover h1{font-size:42px;line-height:1.02;margin:13px 0;color:#10243e;letter-spacing:-.04em}.cover h1 span{color:#1767a5}.cover p{font-size:16px;line-height:1.55;color:#53677b}.cover-image{height:230px;border-radius:22px;background:linear-gradient(145deg,#10243eaa,#1767a5aa),url('/og-solar-los-mochis.webp') center/cover;box-shadow:0 20px 40px #10243e22}.eyebrow{font-size:12px;letter-spacing:.17em;font-weight:800;color:#e09a14;text-transform:uppercase}.investment{margin-top:15mm;padding:22px 26px;border-radius:16px;background:#10243e;color:#fff;display:flex;align-items:end;justify-content:space-between;gap:20px}.investment .label{color:#b9c8d5}.investment strong{font-size:43px;line-height:1}.investment p{margin:7px 0 0;color:#d4e0e8;font-size:12px}.client-card{margin-top:12mm;border-left:4px solid #e6a21a;padding:5px 0 5px 16px}.label{display:block;color:#718092;font-size:10px;text-transform:uppercase;letter-spacing:.13em;margin-bottom:6px}.value{font-weight:800;font-size:19px}.section-title{font-size:19px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 16px;color:#10243e}.page-header{margin:9mm 0 12mm}.page-header h2{font-size:30px;margin:6px 0}.page-header p{color:#53677b;margin:0}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#dbe4eb;border:1px solid #dbe4eb}.stats div{background:#fff;padding:18px 14px;min-height:92px}.stats .value{display:block;font-size:22px;margin-top:10px}.chart-card{margin-top:14mm;border:1px solid #dbe4eb;border-radius:14px;padding:20px}.chart-row{display:grid;grid-template-columns:125px 1fr 75px;align-items:center;gap:12px;margin:17px 0}.chart-label{font-size:12px;color:#53677b}.bar{height:18px;background:#edf1f4;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;border-radius:99px;background:#e6a21a}.bar.blue i{background:#1767a5}.chart-row b{text-align:right;font-size:13px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:12mm;margin-top:14mm}.card{border:1px solid #dbe4eb;border-radius:14px;padding:20px}.card h3{margin:0 0 10px;font-size:18px}.card p{color:#53677b;line-height:1.5;margin:7px 0}.accent{border-top:5px solid #e6a21a}.price{font-size:31px;font-weight:800;color:#1767a5}.checklist{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:15mm}.check{padding:14px;border-radius:10px;background:#f2f6f8;color:#53677b;font-size:13px}.check b{display:block;color:#10243e;margin-bottom:5px}.cta{margin-top:18mm;padding:25px;border-radius:16px;background:#10243e;color:#fff}.cta h2{margin:0 0 8px;font-size:25px}.cta p{color:#d4e0e8;line-height:1.5}.footer{position:absolute;left:17mm;right:17mm;bottom:10mm;border-top:1px solid #dbe4eb;padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#718092}.disclaimer{font-size:11px;line-height:1.5;color:#718092;margin-top:15mm}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}
  .dark-cover{background:#061d35;color:#fff;padding:14mm 14mm 12mm}.dark-cover .topline{border-color:#31516b}.dark-cover .brand{color:#fff}.dark-cover .brand-mark{background:#9bd400;color:#061d35}.dark-cover .date{color:#b8cad8}.dark-cover .date strong{color:#fff}.dark-cover .label{color:#b8cad8}.dark-cover .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:8mm}.dark-cover .metric{display:grid;grid-template-columns:245px 1fr;align-items:center;gap:12px;font-size:17px}.dark-cover .metric b{font-size:15px;letter-spacing:.04em}.dark-cover .metric span{font-size:18px;color:#fff}.dark-cover .metric strong{font-size:20px;color:#9bd400}.dark-cover .proposal-box{margin-top:7mm;border-radius:18px;padding:7mm;background:#d5dce1;display:grid;grid-template-columns:1.15fr .85fr;gap:5mm;color:#061d35}.dark-cover .proposal-left{border-radius:13px;padding:6mm;background:linear-gradient(135deg,#006f7a,#00b89d);color:#fff}.dark-cover .proposal-left h2{font-size:25px;margin:0 0 5mm}.dark-cover .proposal-left .big{font-size:24px;font-weight:800}.dark-cover .proposal-right{padding:4mm 3mm}.dark-cover .proposal-right h3{font-size:17px;font-weight:400;margin:0 0 4mm}.dark-cover .proposal-right .price{color:#061d35;font-size:29px}.dark-cover .proposal-right p{color:#263d50;font-size:13px;line-height:1.4}.dark-cover .strip{margin-top:6mm;border-radius:12px;padding:3mm 5mm;background:linear-gradient(90deg,#007875,#00b89d);font-size:25px;color:#fff}.dark-cover .savings{display:grid;grid-template-columns:1.15fr .85fr;gap:3mm;margin-top:5mm}.dark-cover .save-card{border-radius:12px;padding:4mm;background:#d5dce1;color:#061d35}.dark-cover .save-card h3{font-size:18px;text-align:center;margin:0 0 2mm}.dark-cover .save-card .amount{display:block;border-radius:8px;padding:2mm;background:#007f78;color:#fff;text-align:center;font-size:20px;font-weight:800}.dark-cover .save-card p{font-size:11px;margin:3mm 0 0;line-height:1.35}.dark-cover .highlight{border-radius:12px;padding:4mm;background:linear-gradient(135deg,#ffba00,#f04418);color:#fff}.dark-cover .highlight.green{background:#00a58f}.dark-cover .highlight h3{font-size:17px;margin:0;text-align:center;font-weight:400}.dark-cover .highlight strong{display:block;text-align:center;font-size:30px;margin-top:2mm}.dark-cover .signature{margin-top:8mm;display:flex;justify-content:space-between;align-items:end;border-top:1px solid #31516b;padding-top:4mm;color:#d7e4ec;font-size:10px}.dark-cover .ciae{width:62px;height:62px;border:2px solid #a5b0b9;border-radius:50%;display:grid;place-items:center;text-align:center;font-size:8px;color:#dbe4ea}.dark-cover .footer{border-color:#31516b;color:#b8cad8}
  .page:not(.dark-cover){background:#061d35;color:#fff}.page:not(.dark-cover) .topline{border-color:#31516b}.page:not(.dark-cover) .brand{color:#fff}.page:not(.dark-cover) .folio,.page:not(.dark-cover) .eyebrow{color:#9bd400}.page:not(.dark-cover) .page-header h2,.page:not(.dark-cover) .section-title{color:#fff}.page:not(.dark-cover) .page-header p,.page:not(.dark-cover) .card p,.page:not(.dark-cover) .disclaimer{color:#b8cad8}.page:not(.dark-cover) .stats,.page:not(.dark-cover) .chart-card,.page:not(.dark-cover) .card{border-color:#31516b;background:#102d48}.page:not(.dark-cover) .stats div{background:#102d48}.page:not(.dark-cover) .stats .label,.page:not(.dark-cover) .chart-label,.page:not(.dark-cover) .label{color:#b8cad8}.page:not(.dark-cover) .check{background:#102d48;color:#b8cad8}.page:not(.dark-cover) .check b{color:#fff}.page:not(.dark-cover) .price{color:#9bd400}.page:not(.dark-cover) .footer{border-color:#31516b;color:#b8cad8}
  </style></head><body>
  <section class="page dark-cover"><div class="topline"><div class="brand"><span class="brand-mark">C</span><img src="/cdse-solar-logo-cropped.png" alt="CDSE Energia Solar Inteligente" style="width:150px;height:42px;object-fit:cover;object-position:center;border-radius:7px;margin-left:4px"></div><div class="date">COTIZACION<strong>${esc(quote.folio)}</strong><span>${esc(date)}</span></div></div>
    <div class="metric-grid"><div class="metric"><b>TOTAL DE INVERSION DEL PROYECTO</b><span><strong>${esc(money.format(Number(quote.total_mxn ?? 0)))}</strong> MXN</span></div><div class="metric"><b>RETORNO DE INVERSION</b><span><strong>Por confirmar</strong></span></div><div class="metric"><b>CLIENTE</b><span>${esc(lead)}</span></div><div class="metric"><b>TARIFA</b><span>${esc(tariff)}</span></div><div class="metric"><b>GENERACION ANUAL</b><span>${annualGeneration ? `${esc(number.format(annualGeneration))} kWh` : 'Por confirmar'}</span></div></div>
    <div class="proposal-box"><div class="proposal-left"><h2>Sistema Propuesto</h2><div class="big">⚡ ${esc(result.systemDcKw ?? '-')} kW</div><p>*Total de potencia solar.</p><div class="big">▱ ${esc(quote.panel_count ?? result.panelCount ?? '-')} <span style="font-size:16px;font-weight:400">de ${esc(module.watts ?? '-')} W</span></div><p>*Numero de paneles y su capacidad.</p></div><div class="proposal-right"><h3>Costo total del sistema solar</h3><div class="price">${esc(money.format(Number(quote.total_mxn ?? 0)))} MXN</div><p>IVA incluido.</p><p><b>*Proyecto llave en mano:</b> materiales, ingenieria, instalacion, puesta en marcha y tramite ante CFE.</p></div></div>
    <div class="strip">Ahorro en <b>Sistema Solar</b></div><div class="savings"><div><div class="save-card"><h3>Pago CFE Anual antes</h3><span class="amount">${annualBill ? esc(money.format(annualBill)) : 'Validar recibo CFE'}</span><p>*Total que se paga actualmente en la energia solar.</p></div><div class="save-card" style="margin-top:3mm"><h3>Pago CFE Anual con solar</h3><span class="amount">Se calcula en visita</span><p>*Proyeccion del pago residual por energia electrica.</p></div><div class="strip" style="margin-top:3mm;background:#d5dce1;color:#061d35;font-size:21px">Porcentaje de <b>Ahorro</b></div></div><div><div class="highlight"><h3>AHORRO <b>ESTIMADO</b></h3><strong>Por confirmar</strong><p style="color:#fff">*Depende de tarifa, consumo y condiciones del sitio.</p></div><div class="highlight green" style="margin-top:3mm"><h3>RETORNO DE <b>INVERSION</b></h3><strong>Por confirmar</strong><p style="color:#fff">*Se define con el recibo validado y la visita tecnica.</p></div></div></div>
    <div class="signature"><div><b>Ing. Vicente Munguia Jaime</b><br>Director e instalador certificado<br>${esc(address)}<br>cdse.com.mx/solar</div><img class="ciae" src="/ciae-certificado.png" alt="Instalador certificado CIAE"></div><div class="footer"><span>CDSE Solar - Energia solar inteligente</span><span>01 / 03</span></div></section>
  <section class="page"><div class="topline"><div class="brand"><span class="brand-mark">C</span> CDSE SOLAR</div><div class="folio">DIMENSIONAMIENTO</div></div><div class="page-header"><div class="eyebrow">La propuesta en numeros</div><h2>Un sistema pensado para tu consumo</h2><p>Dimensionamiento calculado con los datos del recibo CFE y las condiciones solares de la zona.</p></div>
    <div class="stats"><div><span class="label">Paneles</span><span class="value">${esc(quote.panel_count ?? result.panelCount ?? '-')}</span></div><div><span class="label">Potencia total</span><span class="value">${esc(result.systemDcKw ?? '-')} kW</span></div><div><span class="label">Generacion anual</span><span class="value">${esc(annualGeneration ? number.format(annualGeneration) : '-')} kWh</span></div><div><span class="label">Cobertura estimada</span><span class="value">${esc(coverage ? number.format(coverage * 100) : '-')}%</span></div></div>
    <div class="chart-card"><h3 class="section-title">Consumo vs generacion</h3><div class="chart-row"><span class="chart-label">Consumo anual</span><div class="bar"><i style="width:${annualConsumption ? Math.min(100, Math.round((annualConsumption / Math.max(annualConsumption, annualGeneration)) * 100)) : 0}%"></i></div><b>${annualConsumption ? number.format(annualConsumption) : '-'} kWh</b></div><div class="chart-row"><span class="chart-label">Generacion solar</span><div class="bar blue"><i style="width:${annualGeneration ? Math.min(100, Math.round((annualGeneration / Math.max(annualConsumption, annualGeneration)) * 100)) : 0}%"></i></div><b>${annualGeneration ? number.format(annualGeneration) : '-'} kWh</b></div><p style="color:#718092;font-size:11px;margin:20px 0 0">La generacion real puede variar por sombras, orientacion, temperatura y condiciones del sitio.</p></div>
    <div class="columns"><div class="card accent"><span class="label">Panel seleccionado</span><h3>${esc(module.brand ?? 'Panel solar')} ${esc(module.model ?? '')}</h3><p><b>${esc(module.watts ?? '-')} W</b> de potencia por modulo</p><p>Instalacion incluida en la tarifa configurada.</p></div><div class="card"><span class="label">Paquete sugerido</span><h3>${esc(packageOffer?.name ?? 'Precio por panel')}</h3><div class="price">${esc(money.format(Number(packageOffer?.priceMxn ?? quote.total_mxn ?? 0)))}</div><p>${packageOffer ? `${esc(packageOffer.panelCount)} paneles con precio preferente.` : 'Precio calculado por panel instalado.'}</p></div></div>
    <div class="footer"><span>${esc(quote.folio)} - Propuesta comercial</span><span>02 / 03</span></div></section>
  <section class="page"><div class="topline"><div class="brand"><span class="brand-mark">C</span> CDSE SOLAR</div><div class="folio">PLAN DE CIERRE</div></div><div class="page-header"><div class="eyebrow">De la propuesta a tu instalacion</div><h2>Todo claro antes de decidir</h2><p>Te acompanamos para validar el proyecto, resolver dudas y programar el siguiente paso.</p></div>
    ${financing ? `<div class="card accent"><span class="label">Financiamiento disponible</span><h3>${esc(financing.name)}</h3><div class="price">${esc(money.format(Number(financing.downPaymentMxn ?? 0)))} de enganche</div><p>${esc(financing.installments)} mensualidades sin intereses, sujeto a autorizacion y condiciones vigentes.</p></div>` : '<div class="card accent"><span class="label">Forma de pago</span><h3>Propuesta flexible</h3><p>El asesor puede revisar alternativas de pago y condiciones finales del proyecto.</p></div>'}
    <div class="checklist"><div class="check"><b>01. Validacion del recibo</b>Confirmamos tarifa, consumo y datos del servicio.</div><div class="check"><b>02. Visita tecnica</b>Revisamos techo, sombras, orientacion y tablero.</div><div class="check"><b>03. Propuesta final</b>Ajustamos sistema, materiales y calendario.</div><div class="check"><b>04. Instalacion</b>Coordinamos la ejecucion y puesta en marcha.</div></div>
    <div class="cta"><div class="eyebrow" style="color:#e6a21a">Siguiente paso</div><h2>Hablemos de tu proyecto solar</h2><p>Un asesor CDSE validara esta propuesta contigo antes de programar la instalacion.</p><p style="margin-bottom:0"><b>${esc(phone || 'WhatsApp del asesor')}</b>${email ? ` · ${esc(email)}` : ''}</p></div>
    <p class="disclaimer">Esta cotizacion es una estimacion comercial basada en la informacion disponible al momento de su emision. El sistema, precio y condiciones finales quedan sujetos a visita tecnica, disponibilidad de equipo y validacion del proyecto.</p><div class="footer"><span>Gracias por considerar a CDSE Solar</span><span>03 / 03</span></div></section><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  printable.document.close();
}

function QuoteActions({ quote, compact = false }) {
  const whatsappNumber = String(quote.solar_leads?.phone_e164 ?? '').replace(/\D/g, '');
  const shareText = quoteShareText(quote);
  const email = quote.solar_leads?.email ?? '';
  return <div className="sp-inline-actions">
    <button type="button" className="sp-button sp-button--secondary" onClick={() => downloadSolarQuotePdf(quote).catch((error) => { console.error(error); window.alert('No fue posible generar el PDF. Intenta nuevamente.'); })} title="Descargar la propuesta en PDF">{compact ? 'PDF' : 'Descargar PDF'}</button>
    {whatsappNumber ? <a className="sp-button sp-button--secondary" href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">{compact ? 'WhatsApp' : 'Enviar por WhatsApp'}</a> : <button type="button" className="sp-button sp-button--secondary" disabled title="Agrega un WhatsApp al prospecto">WhatsApp</button>}
    {email ? <a className="sp-button sp-button--secondary" href={`mailto:${email}?subject=${encodeURIComponent(`Propuesta solar ${quote.folio}`)}&body=${encodeURIComponent(shareText)}`}>{compact ? 'Correo' : 'Enviar por correo'}</a> : <button type="button" className="sp-button sp-button--secondary" disabled title="Agrega un correo al prospecto">Correo</button>}
  </div>;
}

function blankPeriod() {
  return { kwh: '', amountMxn: '', coveredMonths: 2, periodStart: '', periodEnd: '' };
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  return value?.startsWith('+') ? `+${digits}` : '';
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / 1024 ** 2)} MB`;
}

function errorMessage(error) {
  const raw = error?.message?.replace(/^.*?:\s*/, '') || '';
  const operationalMessages = {
    INCOMPLETE_SITE_SURVEY: 'El levantamiento aún está incompleto. Verifica fecha, techo, área, sombras, servicio eléctrico, tablero, tierra física, medidor y longitud de ruta.',
    INCOMPLETE_ENGINEERING_REVISION: 'Completa paneles, equipos, potencias, strings, protecciones, conductores y puesta a tierra antes de enviar el diseño.',
    APPROVED_SINGLE_LINE_DIAGRAM_REQUIRED: 'Primero sube y aprueba el diagrama unifilar en el expediente. Después podrás enviar esta ingeniería.',
    INVERTER_OVERPRODUCTION_LIMIT_EXCEEDED: 'La relación DC/AC supera 120%. Ajusta potencia o cantidad de inversores antes de continuar.',
    PROJECT_NOT_READY_FOR_CFE: 'El proyecto no puede marcarse listo para CFE: deben estar aprobados el levantamiento, la ingeniería y todos los documentos base.',
    CFE_TRACKING_FOLIO_REQUIRED: 'Para marcar el proyecto como ingresado a CFE debes registrar el folio de seguimiento.',
    SITE_SURVEY_REQUIRED: 'Primero captura el levantamiento técnico para poder generar su reporte.',
    DOSSIER_TOO_LARGE_FOR_MOBILE: 'El expediente supera 125 MB. Expórtalo desde una computadora para evitar que el navegador móvil se cierre.',
    PAYMENT_AMOUNT_INVALID: 'Captura un importe de cobro mayor a cero.',
    PAYMENT_SCHEDULE_INVALID: 'El concepto de cobro no pertenece a este proyecto.',
    PENDING_PAYMENT_REQUIRED: 'Este movimiento ya fue revisado. Actualiza la pantalla para consultar su estado.',
    REJECTION_REASON_REQUIRED: 'Explica por qué el comprobante de pago fue rechazado.',
    COMMISSION_RATE_OUT_OF_RANGE: 'La comisión debe quedar entre 0% y 10%. Para autorizarla, la política normal es de 5% a 10%.',
    ADJUSTMENT_REASON_REQUIRED: 'Todo ajuste manual de comisión requiere una justificación auditable.',
    RECONCILED_PAYMENT_REQUIRED: 'Primero debe existir al menos un cobro conciliado para confirmar el hito de anticipo.',
    APPROVED_HANDOVER_REQUIRED: 'Primero sube y aprueba el acta de entrega y puesta en marcha del proyecto.',
    PENDING_MILESTONE_REQUIRED: 'Este hito ya fue confirmado.',
    FULLY_EARNED_COMMISSION_REQUIRED: 'La comisión debe tener sus dos hitos completos antes de autorizarse.',
    COMMISSION_POLICY_REVIEW_REQUIRED: 'Revisa la tasa: sólo se autoriza dentro de la política de 5% a 10%.',
    SELF_APPROVAL_REASON_REQUIRED: 'Como administrador y vendedor del proyecto, debes documentar el motivo de autorización excepcional.',
    APPROVED_COMMISSION_REQUIRED: 'La comisión debe estar autorizada antes de registrarla como pagada.',
    PAYMENT_REFERENCE_REQUIRED: 'Captura la referencia bancaria o comprobante de pago de la comisión.',
    REFUND_DATA_INVALID: 'Captura un importe válido y explica el motivo del reembolso.',
    REFUND_EXCEEDS_PAYMENT: 'El reembolso solicitado supera el saldo disponible de ese pago.',
    PENDING_REFUND_REQUIRED: 'Este reembolso ya fue revisado. Actualiza la pantalla para consultar su estado.',
    DECISION_REASON_REQUIRED: 'Documenta el motivo del rechazo.',
    COST_AMOUNT_INVALID: 'Revisa la cantidad y el costo unitario antes de guardar.',
    VOID_REASON_REQUIRED: 'Para anular un costo debes documentar el motivo.',
    REVERSAL_REASON_REQUIRED: 'Para revertir un hito debes documentar el motivo.',
    EARNED_MILESTONE_REQUIRED: 'Sólo puede revertirse un hito previamente devengado.',
    RECOVERY_AMOUNT_INVALID: 'El importe a recuperar debe ser mayor a cero y no superar el saldo pendiente.',
    RECOVERY_REFERENCE_REQUIRED: 'Captura la referencia del descuento o recuperación.',
  };
  return operationalMessages[raw] ?? (raw || 'Ocurrió un error inesperado.');
}

function StatusPill({ status }) {
  return <span className={`sp-status sp-status--${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function EmptyState({ title, detail, action }) {
  return (
    <div className="sp-empty">
      <span aria-hidden="true">—</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function Login({ onSession }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMessage('Correo o contraseña incorrectos.');
    onSession(data.session);
  }

  return (
    <main className="sp-login-shell">
      <section className="sp-login-story">
        <a className="sp-brand" href="/solar">
          <img src="/logo.jpg" alt="CDSE" />
          <span>Solar</span>
        </a>
        <div>
          <p className="sp-kicker">Portal comercial</p>
          <h1>Cada recibo, una oportunidad con dueño.</h1>
          <p>
            Cotiza sistemas de interconexión con precios vigentes, historial trazable
            y seguimiento de comisión por vendedor.
          </p>
        </div>
        <p className="sp-login-foot">Uso exclusivo del equipo autorizado de CDSE.</p>
      </section>
      <section className="sp-login-panel">
        <form onSubmit={submit}>
          <p className="sp-section-number">ACCESO / 01</p>
          <h2>Ingresa a tu mesa de trabajo</h2>
          <label>
            <span>Correo</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Contraseña</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {message && <p className="sp-form-error" role="alert">{message}</p>}
          <button className="sp-button sp-button--primary" disabled={busy}>
            {busy ? 'Verificando…' : 'Entrar al cotizador'}
          </button>
        </form>
      </section>
    </main>
  );
}

function SetupRequired() {
  return (
    <main className="sp-config-shell">
      <div className="sp-config-mark">!</div>
      <p className="sp-kicker">Conexión pendiente</p>
      <h1>El portal está listo; falta enlazar el proyecto Supabase.</h1>
      <p>
        Conecta el proyecto Supabase con Vercel o configura las variables públicas
        para activar acceso, almacenamiento y control comercial.
      </p>
      <a className="sp-button sp-button--secondary" href="/solar">Volver a Solar</a>
    </main>
  );
}

function Bootstrap({ session, onReady }) {
  const [name, setName] = useState(session.user.user_metadata?.full_name ?? '');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function bootstrap() {
    if (password.length < 8) {
      return setMessage('La contraseña debe tener al menos 8 caracteres.');
    }
    if (password !== passwordConfirmation) {
      return setMessage('Las contraseñas no coinciden.');
    }
    setBusy(true);
    setMessage('');
    const client = getSupabaseClient();
    const { error: passwordError } = await client.auth.updateUser({ password });
    if (passwordError) {
      setBusy(false);
      return setMessage(errorMessage(passwordError));
    }
    const { error } = await client.rpc('bootstrap_solar_admin', { p_full_name: name });
    setBusy(false);
    if (error) return setMessage(errorMessage(error));
    onReady();
  }

  return (
    <main className="sp-config-shell">
      <div className="sp-config-mark">01</div>
      <p className="sp-kicker">Primer acceso</p>
      <h1>Inicializa la administración solar.</h1>
      <p>Esta acción sólo funciona una vez y convierte la primera cuenta autenticada en administrador.</p>
      <label className="sp-field">
        <span>Nombre del administrador</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="sp-field">
        <span>Define tu contraseña</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label className="sp-field">
        <span>Confirma tu contraseña</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={passwordConfirmation}
          onChange={(event) => setPasswordConfirmation(event.target.value)}
        />
      </label>
      {message && <p className="sp-form-error">{message}</p>}
      <button className="sp-button sp-button--primary" onClick={bootstrap} disabled={busy || name.trim().length < 2 || password.length < 8 || password !== passwordConfirmation}>
        {busy ? 'Guardando acceso…' : 'Inicializar portal'}
      </button>
    </main>
  );
}

function Overview({ data, profile, setView, onOpenQuote }) {
  const won = data.quotes.filter((quote) => quote.status === 'aceptada');
  const open = data.quotes.filter((quote) => !['aceptada', 'rechazada', 'vencida'].includes(quote.status));
  const commission = data.commissions.reduce((sum, item) => sum + Number(item.payable_amount_mxn ?? 0), 0);
  const total = won.reduce((sum, quote) => sum + Number(quote.total_mxn ?? 0), 0);

  return (
    <section className="sp-view">
      <header className="sp-view-header">
        <div>
          <p className="sp-section-number">PULSO COMERCIAL / HOY</p>
          <h1>Buen día, {profile.full_name.split(' ')[0]}.</h1>
        </div>
        <button className="sp-button sp-button--primary" onClick={() => setView('new')}>
          + Nueva cotización
        </button>
      </header>

      <div className="sp-ledger">
        <div><span>Oportunidades abiertas</span><strong>{open.length}</strong><small>requieren seguimiento</small></div>
        <div><span>Ventas cerradas</span><strong>{won.length}</strong><small>{money.format(total)} vendidos</small></div>
        <div><span>Comisión proyectada</span><strong>{money.format(commission)}</strong><small>base antes de IVA</small></div>
        <div><span>Proyectos activos</span><strong>{data.projects.filter((project) => !['operational', 'cancelled'].includes(project.status)).length}</strong><small><button type="button" className="sp-link-button" onClick={() => setView('projects')}>abrir operación</button></small></div>
      </div>

      <div className="sp-split">
        <div>
          <div className="sp-subhead">
            <h2>Trabajo reciente</h2>
            <button onClick={() => setView('quotes')}>Ver todo</button>
          </div>
          {data.quotes.length ? (
            <div className="sp-table-wrap">
              <table>
                <thead><tr><th>Folio</th><th>Cliente</th><th>Sistema</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {data.quotes.slice(0, 6).map((quote) => (
                    <tr key={quote.id}>
                      <td className="sp-folio"><button type="button" className="sp-link-button" onClick={() => onOpenQuote(quote.id)}>{quote.folio}</button></td>
                      <td>{quote.solar_leads?.name ?? 'Sin nombre'}</td>
                      <td>{quote.panel_count ?? '—'} × {quote.solar_modules?.watts ?? '—'} W</td>
                      <td>{money.format(Number(quote.total_mxn ?? 0))}</td>
                      <td><StatusPill status={quote.status} /></td>
                      <td><button type="button" className="sp-text-button" onClick={() => onOpenQuote(quote.id)}>Abrir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="La primera oportunidad empieza con un recibo"
              detail="Carga el PDF o fotografía de CFE y el sistema conservará el vendedor, cálculo y precio utilizado."
              action={<button className="sp-button sp-button--secondary" onClick={() => setView('new')}>Crear cotización</button>}
            />
          )}
        </div>
        <aside className="sp-next">
          <p className="sp-section-number">SIGUIENTE ACCIÓN</p>
          <h2>{open.length ? 'Hay cotizaciones por mover.' : 'Tu mesa está al día.'}</h2>
          <p>
            {open.length
              ? 'Actualiza el estado después de enviar la propuesta o hablar con el prospecto.'
              : 'Captura un nuevo recibo cuando llegue por WhatsApp, mostrador o recomendación.'}
          </p>
          <button onClick={() => setView(open.length ? 'quotes' : 'new')}>
            {open.length ? 'Revisar oportunidades →' : 'Capturar recibo →'}
          </button>
        </aside>
      </div>
    </section>
  );
}

function QuoteForm({ data, session, onCreated, onOpenQuote }) {
  const [file, setFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [periods, setPeriods] = useState([blankPeriod(), blankPeriod()]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    municipality: 'Los Mochis',
    postalCode: '',
    propertyType: 'home',
    roofType: 'concrete',
    tariffCode: 'PDBT',
    billingFrequency: 'bimonthly',
    serviceNumber: '',
    zoneId: data.zones.find((zone) => zone.slug === 'los-mochis')?.id ?? data.zones[0]?.id ?? '',
    moduleId: data.modules[0]?.id ?? '',
    inverterId: '',
    priceOptionId: '',
    promotionId: '',
    packageId: '',
    financingOptionId: '',
    coverageTarget: '1',
  });

  const availablePrices = data.prices.filter((price) => price.module_id === form.moduleId && price.active);
  const availablePromotions = data.promotions.filter(
    (promotion) => promotion.active && (!promotion.module_id || promotion.module_id === form.moduleId),
  );
  const availablePackages = data.packages.filter((item) => item.active && item.module_id === form.moduleId);
  const selectedModule = data.modules.find((module) => module.id === form.moduleId);
  const selectedInverter = data.inverters.find((inverter) => inverter.id === form.inverterId);
  const selectedZone = data.zones.find((zone) => zone.id === form.zoneId);
  const selectedPrice = data.prices.find((price) => price.id === form.priceOptionId);
  const selectedPackage = availablePackages.find((item) => item.id === form.packageId);
  const selectedFinancing = data.financingOptions.find((item) => item.id === form.financingOptionId);
  const selectedPlanPrice = Number(selectedFinancing?.price_per_panel_mxn ?? selectedPrice?.price_per_panel_mxn ?? 0);
  const periodHistory = validatePeriodHistory(periods, form.billingFrequency);

  useEffect(() => {
    if (!form.priceOptionId && availablePrices[0]) {
      setForm((current) => ({ ...current, priceOptionId: availablePrices[0].id }));
    }
  }, [form.moduleId, form.priceOptionId, availablePrices]);

  const preview = useMemo(() => {
    try {
      if (!selectedModule || !selectedZone || !selectedPrice) return null;
      const usable = periods
        .filter((period) => Number(period.kwh) > 0)
        .map((period) => ({
          kwh: Number(period.kwh),
          amountMxn: Number(period.amountMxn || 0),
          coveredMonths: Number(period.coveredMonths),
        }));
      if (!usable.length) return null;
      const sizing = calculatePanelRecommendation({
        periods: usable,
        panelWatts: Number(selectedModule.watts),
        peakSunHoursPerDay: Number(selectedZone.peak_sun_hours_per_day),
        performanceRatio: Number(selectedZone.performance_ratio),
        coverageTarget: Number(form.coverageTarget),
      });
      return {
        ...sizing,
        subtotal: sizing.panelCount * selectedPlanPrice,
      };
    } catch {
      return null;
    }
  }, [periods, selectedModule, selectedZone, selectedPrice, selectedPlanPrice, form.coverageTarget]);

  const selectedInverterSizing = calculateInverterSizing(selectedInverter, preview?.systemDcKw);

  useEffect(() => {
    if (!preview?.systemDcKw || (selectedInverter && selectedInverter.active)) return;
    const suggestion = selectSuggestedInverter(data.inverters, preview.systemDcKw);
    if (suggestion) setForm((current) => ({ ...current, inverterId: suggestion.id }));
  }, [preview?.systemDcKw, selectedInverter?.id, selectedInverter?.active, data.inverters]);

  useEffect(() => {
    if (!preview) return;
    const suggested = availablePackages
      .filter((item) => Number(item.panel_count) >= preview.panelCount)
      .sort((a, b) => Number(a.panel_count) - Number(b.panel_count))[0];
    setForm((current) => ({
      ...current,
      packageId: suggested?.id ?? '',
      financingOptionId: current.financingOptionId && data.financingOptions.some((item) => item.id === current.financingOptionId && Number(item.min_panels) <= Math.max(preview.panelCount, Number(suggested?.panel_count ?? 0)))
        ? current.financingOptionId
        : '',
    }));
  }, [preview?.panelCount, form.moduleId]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'financingOptionId' && value ? { packageId: '' } : {}),
    }));
    if (name === 'billingFrequency') {
      const coveredMonths = value === 'monthly' ? 1 : 2;
      setPeriods((current) => current.map((period) => ({ ...period, coveredMonths })));
    }
  }

  function updatePeriod(index, field, value) {
    setPeriods((current) => current.map((period, itemIndex) =>
      itemIndex === index ? { ...period, [field]: value } : period,
    ));
  }

  async function readReceipt(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) return;
    if (selectedFiles.length > 4) {
      setError('Selecciona hasta 4 archivos del recibo.');
      event.target.value = '';
      return;
    }
    const selected = selectedFiles[0];
    setFile(selected);
    setFiles(selectedFiles);
    setError('');
    if (selected.type !== 'application/pdf') {
      setNotice('Imagen adjunta. Confirma manualmente nombre, tarifa e historial de consumo.');
      // Las imágenes también continúan al OCR; el aviso se actualiza mientras procesa.
    }
    setExtracting(true);
    setNotice('Leyendo el recibo CFE…');
    try {
      const texts = [];
      for (const [index, fileToRead] of selectedFiles.entries()) {
        const text = await extractReceiptText(fileToRead, {
          onProgress: (progress) => setNotice(`Analizando archivo ${index + 1} de ${selectedFiles.length}... ${Math.round(((index + progress) / selectedFiles.length) * 100)}%`),
        });
        texts.push(text);
      }
      const text = texts.join('\n');
      const receipt = parseCfeReceiptText(text);
      const expectedPeriods = expectedPeriodCount(receipt.periodicity === 'monthly' ? 'monthly' : 'bimonthly');
      setForm((current) => ({
        ...current,
        name: receipt.customerName ?? current.name,
        tariffCode: TARIFFS.includes(receipt.tariffCode) ? receipt.tariffCode : current.tariffCode,
        billingFrequency: receipt.periodicity === 'monthly' ? 'monthly' : 'bimonthly',
        serviceNumber: receipt.serviceNumber ?? '',
      }));
      if (receipt.periods.length) {
        const parsedPeriods = receipt.periods.map((period) => ({
          kwh: String(period.kwh),
          amountMxn: String(period.amountMxn ?? 0),
          coveredMonths: period.coveredMonths ?? (receipt.periodicity === 'monthly' ? 1 : 2),
          periodStart: period.periodStart ?? '',
          periodEnd: period.periodEnd ?? '',
        }));
        // El historial editable conserva toda la cadencia esperada:
        // los renglones que el OCR no encontró quedan listos para captura manual.
        while (parsedPeriods.length < expectedPeriods) parsedPeriods.push(blankPeriod());
        setPeriods(parsedPeriods);
      }
      const completePeriods = receipt.periods.filter(isCompletePeriod).length;
      setNotice(
        completePeriods >= expectedPeriods
          ? `Lectura automática completa: ${expectedPeriods} periodos y ${number.format(receipt.annualConsumptionKwh)} kWh.`
          : `Lectura automática incompleta: ${completePeriods} de ${expectedPeriods} periodos completos. Captura manual asistida obligatoria antes de generar.`,
      );
    } catch {
      setNotice('No pudimos leer automáticamente el PDF. Captura los datos visibles del recibo.');
    } finally {
      setExtracting(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setResult(null);
    const client = getSupabaseClient();
    const phoneE164 = normalizePhone(form.phone);
    const history = validatePeriodHistory(periods, form.billingFrequency);
    const validPeriods = periods.filter(isCompletePeriod);
    if (!form.name.trim() || !phoneE164 || !history.ok) {
      return setError('Confirma nombre, teléfono y al menos dos periodos completos (kWh y monto). Los datos leídos se pueden corregir manualmente.');
    }
    if (!form.zoneId || !form.moduleId || !form.priceOptionId || !form.inverterId) {
      return setError('Selecciona zona, panel, inversor y tarifa instalada.');
    }

    setBusy(true);
    let storagePath = '';
    try {
      if (file) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
        storagePath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage
          .from('solar-receipts')
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
      }

      const { data: rpcData, error: rpcError } = await client.rpc('seller_create_solar_quote', {
        p_lead: {
          name: form.name,
          phoneE164,
          email: form.email,
          municipality: form.municipality,
          postalCode: form.postalCode,
          privacyConsentAt: new Date().toISOString(),
          privacyNoticeVersion: '2026-07',
          source: 'seller_portal',
        },
        p_receipt: {
          storagePath,
          mimeType: file?.type ?? '',
          customerName: form.name,
          serviceNumber: form.serviceNumber,
          tariffCode: form.tariffCode,
          billingFrequency: form.billingFrequency,
          captureMethod: file ? 'receipt_upload' : 'manual_receipt',
          propertyType: form.propertyType,
          roofType: form.roofType,
        },
        p_periods: validPeriods.map((period, index) => ({
          sequence: index + 1,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          coveredMonths: Number(period.coveredMonths),
          kwh: Number(period.kwh),
          amountMxn: Number(period.amountMxn || 0),
        })),
        p_pricing: {
          zoneId: form.zoneId,
          moduleId: form.moduleId,
          inverterId: form.inverterId,
          priceOptionId: form.priceOptionId,
          promotionId: form.promotionId,
          packageId: form.packageId,
          financingOptionId: form.financingOptionId,
          coverageTarget: Number(form.coverageTarget),
        },
      });
      if (rpcError) throw rpcError;
      let quoteResult = rpcData?.[0] ?? null;
      if (quoteResult?.quote_id && (form.packageId || form.financingOptionId)) {
        const { data: optionsData, error: optionsError } = await client.rpc('apply_solar_quote_options', {
          p_quote_id: quoteResult.quote_id,
          p_package_id: form.packageId || null,
          p_financing_option_id: form.financingOptionId || null,
        });
        if (optionsError) throw optionsError;
        quoteResult = { ...quoteResult, ...(optionsData?.[0] ?? {}) };
      }
      setResult({
        ...quoteResult,
        created_at: new Date().toISOString(),
        solar_leads: { name: form.name, phone_e164: phoneE164, email: form.email, municipality: form.municipality },
        solar_modules: selectedModule,
        solar_inverters: selectedInverter,
        inverter_quantity: selectedInverterSizing?.quantity,
        inverter_loading_percent: selectedInverterSizing?.loadingPercent,
        input_snapshot: { annualConsumptionKwh: preview?.annualConsumptionKwh, tariffCode: form.tariffCode },
        solar_receipts: {
          tariff_code: form.tariffCode,
          service_number: form.serviceNumber,
          solar_consumption_periods: validPeriods.map((period, index) => ({
            sequence: index + 1,
            period_start: period.periodStart || null,
            period_end: period.periodEnd || null,
            covered_months: Number(period.coveredMonths),
            kwh: Number(period.kwh),
            amount_mxn: Number(period.amountMxn || 0),
          })),
        },
        result_snapshot: {
          ...(preview ?? {}),
          inverter: selectedInverter ? {
            id: selectedInverter.id,
            brand: selectedInverter.brand,
            model: selectedInverter.model,
            acCapacityKw: Number(selectedInverter.ac_capacity_kw),
            quantity: selectedInverterSizing?.quantity ?? 1,
            loadingPercent: selectedInverterSizing?.loadingPercent ?? 0,
          } : undefined,
          ...(quoteResult.result_snapshot ?? {}),
          package: selectedPackage ? { name: selectedPackage.name, panelCount: selectedPackage.panel_count, priceMxn: selectedPackage.price_mxn } : undefined,
          financing: selectedFinancing ? { name: selectedFinancing.name, downPaymentMxn: Number((selectedPackage?.price_mxn ?? preview?.subtotal ?? quoteResult.total_mxn) * Number(selectedFinancing.down_payment_percent) / 100), installments: selectedFinancing.installments } : undefined,
        },
      });
      await onCreated();
    } catch (submissionError) {
      setError(errorMessage(submissionError));
    } finally {
      setBusy(false);
    }
  }

  if (!data.modules.length || !data.inverters.length || !data.prices.length || !data.zones.length) {
    return (
      <section className="sp-view">
        <header className="sp-view-header"><div><p className="sp-section-number">COTIZADOR / NUEVO</p><h1>Falta preparar el catálogo.</h1></div></header>
        <EmptyState
          title="El administrador debe publicar zona, panel y precio"
          detail="No es posible emitir una cotización comercial sin una tarifa vigente por panel."
        />
      </section>
    );
  }

  return (
    <section className="sp-view">
      <header className="sp-view-header">
        <div><p className="sp-section-number">COTIZADOR / NUEVO</p><h1>Convierte un recibo en propuesta.</h1></div>
        <p className="sp-header-note">El vendedor y la tarifa quedan registrados en el folio.</p>
      </header>
      <form className="sp-quote-grid" onSubmit={submit}>
        <div className="sp-quote-main">
          <fieldset>
            <legend><span>01</span> Recibo CFE</legend>
            <label className="sp-upload">
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={readReceipt} />
              <strong>{file ? file.name : 'Seleccionar PDF o fotografía'}</strong>
              <small>Hasta 10 MB · almacenamiento privado</small>
            </label>
            {notice && <p className="sp-inline-notice">{extracting ? '↻ ' : '✓ '}{notice}</p>}
            <div className="sp-form-grid">
              <label className="sp-field sp-field--wide"><span>Nombre del titular</span><input name="name" value={form.name} onChange={updateForm} /></label>
              <label className="sp-field"><span>WhatsApp</span><input name="phone" value={form.phone} onChange={updateForm} placeholder="668 000 0000" /></label>
              <label className="sp-field"><span>Correo opcional</span><input name="email" type="email" value={form.email} onChange={updateForm} /></label>
              <label className="sp-field"><span>No. de servicio</span><input name="serviceNumber" value={form.serviceNumber} onChange={updateForm} /></label>
              <label className="sp-field"><span>Tarifa CFE</span><select name="tariffCode" value={form.tariffCode} onChange={updateForm}>{TARIFFS.map((tariff) => <option key={tariff}>{tariff}</option>)}</select></label>
              <label className="sp-field"><span>Inmueble</span><select name="propertyType" value={form.propertyType} onChange={updateForm}><option value="home">Casa</option><option value="business">Negocio</option><option value="industrial">Industrial</option></select></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><span>02</span> Historial de consumo</legend>
            <div className="sp-period-tools">
              <label className="sp-field sp-field--compact"><span>Cada periodo es</span><select name="billingFrequency" value={form.billingFrequency} onChange={updateForm}><option value="bimonthly">Bimestral</option><option value="monthly">Mensual</option></select></label>
              <p className={`sp-inline-notice ${periodHistory.ok ? '' : 'sp-inline-notice--warning'}`} role="status">
                {periodHistory.ok
                  ? `Lectura completa: ${periodHistory.completeCount} de ${periodHistory.expectedPeriods} periodos. Puedes corregir cualquier dato leído.`
                  : `Lectura incompleta: ${periodHistory.completeCount} de ${periodHistory.expectedPeriods} periodos. Captura manual asistida obligatoria para continuar.`}
              </p>
            </div>
            <div className="sp-period-list">
              {periods.map((period, index) => (
                <div className={`sp-period-row ${!isCompletePeriod(period) ? 'sp-period-row--incomplete' : ''}`} key={index}>
                  <strong>{String(index + 1).padStart(2, '0')}</strong>
                  <label><span>kWh</span><input type="number" min="1" value={period.kwh} onChange={(event) => updatePeriod(index, 'kwh', event.target.value)} /></label>
                  <label><span>Monto</span><input type="number" min="0" value={period.amountMxn} onChange={(event) => updatePeriod(index, 'amountMxn', event.target.value)} /></label>
                  <button type="button" disabled={periods.length <= 2} onClick={() => setPeriods((current) => current.length <= 2 ? current : current.filter((_, item) => item !== index))} aria-label={`Eliminar periodo ${index + 1}`}>×</button>
                </div>
              ))}
            </div>
            <button className="sp-text-button" type="button" onClick={() => setPeriods((current) => [...current, blankPeriod()])}>+ Agregar periodo</button>
          </fieldset>

          <fieldset>
            <legend><span>03</span> Configuración comercial</legend>
            <div className="sp-form-grid">
              <label className="sp-field"><span>Zona</span><select name="zoneId" value={form.zoneId} onChange={updateForm}>{data.zones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}{zone.distance_from_los_mochis_km ? ` · ${zone.distance_from_los_mochis_km} km` : ' · base Los Mochis'}</option>)}</select></label>
              <label className="sp-field"><span>Panel disponible</span><select name="moduleId" value={form.moduleId} onChange={(event) => setForm((current) => ({ ...current, moduleId: event.target.value, priceOptionId: '' }))}>{data.modules.filter((module) => module.active).map((module) => <option value={module.id} key={module.id}>{module.brand} {module.model} · {module.watts} W</option>)}</select></label>
              <label className="sp-field"><span>Tarifa instalada</span><select name="priceOptionId" value={form.priceOptionId} onChange={updateForm}>{availablePrices.map((price) => <option value={price.id} key={price.id}>{price.name} · {money.format(price.price_per_panel_mxn)} / panel</option>)}</select></label>
              <label className="sp-field"><span>Promoción</span><select name="promotionId" value={form.promotionId} onChange={updateForm}><option value="">Sin promoción</option>{availablePromotions.map((promotion) => <option value={promotion.id} key={promotion.id}>{promotion.name}</option>)}</select></label>
              <label className="sp-field"><span>Paquete sugerido</span><select name="packageId" value={form.packageId} onChange={updateForm}><option value="">Precio por panel</option>{availablePackages.map((item) => <option value={item.id} key={item.id}>{item.name} · {money.format(item.price_mxn)}</option>)}</select></label>
              {data.financingOptions.some((item) => Number(item.min_panels) <= Math.max(preview?.panelCount ?? 0, Number(selectedPackage?.panel_count ?? 0))) && <label className="sp-field"><span>Financiamiento</span><select name="financingOptionId" value={form.financingOptionId} onChange={updateForm}><option value="">Sin financiamiento</option>{data.financingOptions.filter((item) => item.active && Number(item.min_panels) <= Math.max(preview?.panelCount ?? 0, Number(selectedPackage?.panel_count ?? 0))).map((item) => <option value={item.id} key={item.id}>{item.name} · enganche {number.format(item.down_payment_percent)}%</option>)}</select></label>}
              <label className="sp-field"><span>Inversor recomendado</span><select name="inverterId" value={form.inverterId} onChange={updateForm}><option value="">Selecciona un inversor</option>{data.inverters.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.brand} {item.model} · {number.format(item.ac_capacity_kw)} kW AC</option>)}</select></label>
              <label className="sp-field"><span>Cobertura objetivo</span><select name="coverageTarget" value={form.coverageTarget} onChange={updateForm}><option value="0.9">90%</option><option value="1">100%</option><option value="1.1">110%</option></select></label>
              <label className="sp-field"><span>Tipo de techo</span><select name="roofType" value={form.roofType} onChange={updateForm}><option value="unknown">Por confirmar</option><option value="concrete">Losa</option><option value="metal">Lámina</option><option value="tile">Teja</option><option value="ground">Suelo</option></select></label>
            </div>
          </fieldset>
        </div>

        <aside className="sp-quote-summary">
          <p className="sp-section-number">RESUMEN DINÁMICO</p>
          {preview ? (
            <>
              <div className="sp-panel-count"><strong>{preview.panelCount}</strong><span>paneles sugeridos</span></div>
              <dl>
                <div><dt>Potencia</dt><dd>{number.format(preview.systemDcKw)} kW</dd></div>
                <div><dt>Generación</dt><dd>{number.format(preview.annualGenerationKwh)} kWh/año</dd></div>
                <div><dt>Precio por panel</dt><dd>{money.format(selectedPlanPrice)}</dd></div>
                <div><dt>Inversor</dt><dd>{selectedInverter ? `${selectedInverterSizing?.quantity ?? 1} × ${selectedInverter.brand} ${selectedInverter.model}` : 'Por seleccionar'}</dd></div>
                <div><dt>Carga DC/AC</dt><dd>{selectedInverterSizing ? `${number.format(selectedInverterSizing.loadingPercent)}%` : '—'} <small>máx. 120%</small></dd></div>
                <div><dt>{selectedPackage ? 'Paquete seleccionado' : 'Subtotal'}</dt><dd>{money.format(selectedPackage ? selectedPackage.price_mxn : preview.subtotal)}</dd></div>
              </dl>
              {selectedPackage && <p className="sp-inline-notice">Se ofrecerá automáticamente {selectedPackage.name}. Puedes cambiar a precio por panel.</p>}
              {selectedFinancing && <p className="sp-inline-notice">Financiamiento disponible: enganche estimado {money.format(Number((selectedPackage?.price_mxn ?? preview.subtotal) * Number(selectedFinancing.down_payment_percent) / 100))}.</p>}
              <p>El servidor recalculará paneles, descuento y comisión antes de guardar.</p>
            </>
          ) : (
            <p>Captura consumo y selecciona una tarifa para ver el dimensionamiento.</p>
          )}
          {error && <p className="sp-form-error" role="alert">{error}</p>}
          {result && (
            <div className="sp-success">
              <strong>Cotización generada</strong>
              <span>{result.folio} · {result.panel_count} paneles · {money.format(result.total_mxn)}</span>
              <QuoteActions quote={result} />
              <button type="button" className="sp-text-button" onClick={() => onOpenQuote(result.quote_id)}>Ver en Resumen y seguimiento →</button>
            </div>
          )}
          <button className="sp-button sp-button--primary" disabled={busy}>
            {busy ? 'Guardando cotización…' : 'Generar folio y cotización'}
          </button>
        </aside>
      </form>
    </section>
  );
}

function Quotes({ data, refresh, isAdmin, openQuoteId, onOpenQuote }) {
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const selectedQuote = data.quotes.find((quote) => quote.id === openQuoteId) ?? null;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleQuotes = data.quotes.filter((quote) => {
    const haystack = [quote.folio, quote.solar_leads?.name, quote.solar_leads?.phone_e164, quote.solar_leads?.email].filter(Boolean).join(' ').toLowerCase();
    return (!normalizedSearch || haystack.includes(normalizedSearch)) && (statusFilter === 'all' || quote.status === statusFilter);
  });

  async function changeStatus(id, status) {
    let lostReason = null;
    if (status === 'rechazada') {
      lostReason = window.prompt('Motivo por el que se perdió la oportunidad:')?.trim();
      if (!lostReason) return;
    }
    if (status === 'aceptada' && !window.confirm('¿Confirmar la venta y registrar la comisión del vendedor?')) {
      return;
    }
    setBusyId(id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('set_solar_quote_status', {
      p_quote_id: id,
      p_status: status,
      p_lost_reason: lostReason,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    await refresh();
  }

  return (
    <section className="sp-view">
      <header className="sp-view-header"><div><p className="sp-section-number">PIPELINE / COTIZACIONES</p><h1>Seguimiento y cierre.</h1></div></header>
      {message && <p className="sp-form-error">{message}</p>}
      <div className="sp-quote-filters">
        <label className="sp-field"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Folio, cliente o teléfono" /></label>
        <label className="sp-field"><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option>{STATUS_OPTIONS.map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label>
      </div>
      {selectedQuote && <article id="quote-detail" className="sp-quote-detail">
        <div><p className="sp-section-number">COTIZACIÓN SELECCIONADA</p><h2>{selectedQuote.folio}</h2><p>{selectedQuote.solar_leads?.name} · {selectedQuote.panel_count} paneles de {selectedQuote.solar_modules?.watts} W · {money.format(Number(selectedQuote.total_mxn ?? 0))}</p></div>
        <QuoteActions quote={selectedQuote} />
      </article>}
      {data.quotes.length ? (
        <div className="sp-table-wrap sp-table-wrap--full">
          <table>
            <thead><tr><th>Folio</th><th>Cliente</th><th>Vendedor</th><th>Sistema</th><th>Total</th><th>Comisión</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {visibleQuotes.map((quote) => (
                <tr key={quote.id}>
                    <td><button type="button" className="sp-link-button sp-folio" onClick={() => onOpenQuote(quote.id)}>{quote.folio}</button><small>{new Date(quote.created_at).toLocaleDateString('es-MX')}</small></td>
                  <td><strong>{quote.solar_leads?.name}</strong><small>{quote.solar_leads?.phone_e164}</small></td>
                  <td>{data.profileMap[quote.seller_user_id]?.full_name ?? 'Sin asignar'}</td>
                  <td>{quote.panel_count ?? '—'} × {quote.solar_modules?.watts ?? '—'} W</td>
                  <td>{money.format(Number(quote.total_mxn ?? 0))}</td>
                  <td>
                    {quote.status === 'aceptada'
                      ? money.format(Number(quote.commission_amount_mxn ?? 0))
                      : <small>Pendiente de cierre</small>}
                  </td>
                  <td>
                    <select
                      className="sp-status-select"
                      value={quote.status}
                      disabled={busyId === quote.id || (!isAdmin && ['aceptada', 'rechazada'].includes(quote.status))}
                      onChange={(event) => changeStatus(quote.id, event.target.value)}
                    >
                      {STATUS_OPTIONS
                        .filter((status) =>
                          isAdmin
                          || status === quote.status
                          || !['aceptada', 'rechazada'].includes(status))
                        .map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                    </select>
                  </td>
                  <td><QuoteActions quote={quote} compact /><button type="button" className="sp-text-button" onClick={() => onOpenQuote(quote.id)}>Seleccionar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title={data.quotes.length ? 'No hay coincidencias' : 'No hay cotizaciones todavía'} detail={data.quotes.length ? 'Prueba con otro folio, cliente o estado.' : 'Los folios creados por vendedores aparecerán aquí con su comisión y estado.'} />}
    </section>
  );
}

function Agenda({ data, profile, isAdmin, refresh, onOpenProject }) {
  const canManageTasks = canPerform(profile.role, 'project.tasks');
  const teamView = isAdmin || ['operations', 'finance'].includes(profile.role);
  const [ownerFilter, setOwnerFilter] = useState(teamView ? 'all' : 'mine');
  const [typeFilter, setTypeFilter] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 8);
  const activeTasks = data.tasks
    .filter((task) => !['completed', 'cancelled'].includes(task.status))
    .filter((task) => ownerFilter === 'all' || task.assigned_to === profile.user_id)
    .filter((task) => typeFilter === 'all' || task.task_type === typeFilter)
    .sort((a, b) => String(a.due_at ?? '9999').localeCompare(String(b.due_at ?? '9999')));

  const groups = [
    ['overdue', 'Vencidas', activeTasks.filter((task) => task.due_at && new Date(task.due_at) < todayStart)],
    ['today', 'Hoy', activeTasks.filter((task) => task.due_at && new Date(task.due_at) >= todayStart && new Date(task.due_at) < tomorrowStart)],
    ['week', 'Próximos 7 días', activeTasks.filter((task) => task.due_at && new Date(task.due_at) >= tomorrowStart && new Date(task.due_at) < weekEnd)],
    ['later', 'Más adelante', activeTasks.filter((task) => task.due_at && new Date(task.due_at) >= weekEnd)],
    ['unscheduled', 'Sin fecha', activeTasks.filter((task) => !task.due_at)],
  ];

  async function complete(task) {
    setBusyId(task.id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('complete_solar_project_task', { p_task_id: task.id });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage('Tarea completada y registrada en la bitácora.');
    await refresh();
  }

  return <section className="sp-view">
    <header className="sp-view-header">
      <div><p className="sp-section-number">AGENDA / EQUIPO SOLAR</p><h1>Lo que sigue, con dueño.</h1></div>
      <p className="sp-header-note">Prioriza compromisos vencidos, coordina visitas e instalaciones y conserva cada cierre dentro del proyecto correcto.</p>
    </header>
    <div className="sp-ledger">
      <div><span>Vencidas</span><strong>{groups[0][2].length}</strong><small>resolver primero</small></div>
      <div><span>Para hoy</span><strong>{groups[1][2].length}</strong><small>{todayStart.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}</small></div>
      <div><span>Próximos 7 días</span><strong>{groups[2][2].length}</strong><small>capacidad próxima</small></div>
      <div><span>Sin fecha</span><strong>{groups[4][2].length}</strong><small>requieren programación</small></div>
    </div>
    <div className="sp-quote-filters">
      {isAdmin && <label className="sp-field"><span>Responsable</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Todo el equipo</option><option value="mine">Sólo mis tareas</option></select></label>}
      <label className="sp-field"><span>Tipo de compromiso</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos</option>{Object.entries(TASK_TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
    </div>
    {message && <p className="sp-inline-notice">{message}</p>}
    <div className="sp-agenda">
      {groups.map(([key, label, tasks]) => <section className={`sp-agenda-group sp-agenda-group--${key}`} key={key}>
        <header><h2>{label}</h2><span>{tasks.length}</span></header>
        {tasks.length ? tasks.map((task) => <article className="sp-agenda-row" key={task.id}>
          <time>{task.due_at ? new Date(task.due_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Por programar'}</time>
          <div><span>{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</span><strong>{task.title}</strong><small>{task.solar_projects?.folio} · {task.solar_projects?.customer_name} · {data.profileMap[task.assigned_to]?.full_name ?? 'Sin asignar'}</small></div>
          <div className="sp-agenda-actions"><button type="button" onClick={() => onOpenProject(task.project_id)}>Proyecto</button>{canManageTasks && (isAdmin || task.assigned_to === profile.user_id) && <button type="button" disabled={busyId === task.id} onClick={() => complete(task)}>{busyId === task.id ? '…' : 'Completar'}</button>}</div>
        </article>) : <p>No hay compromisos en este bloque.</p>}
      </section>)}
    </div>
  </section>;
}

function Finance({ data, profile, isAdmin, refresh, onOpenProject }) {
  const canCapturePayment = canPerform(profile.role, 'finance.capture');
  const eligibleProjects = data.projects.filter((project) => isAdmin || profile.role === 'finance' || project.seller_user_id === profile.user_id);
  const [selectedId, setSelectedId] = useState(eligibleProjects[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [paymentForm, setPaymentForm] = useState({ scheduleId: '', amount: '', receivedAt: new Date().toISOString().slice(0, 16), method: 'transfer', reference: '', notes: '' });
  const [commissionForm, setCommissionForm] = useState({ rate: '', adjustment: '0', reason: '', approvalReason: '', paymentReference: '', payrollReference: '' });
  const [refundForm, setRefundForm] = useState({ paymentId: '', amount: '', reason: '', reference: '' });
  const [costForm, setCostForm] = useState({ stage: 'actual', category: 'modules', description: '', quantity: '1', unitCost: '', vatRate: '16', status: 'paid', incurredAt: new Date().toISOString().slice(0, 10), supplier: '', reference: '' });
  const [recoveryForm, setRecoveryForm] = useState({ amount: '', reference: '', reason: '' });
  const [reportFilter, setReportFilter] = useState({ from: '', to: '', seller: 'all' });

  const visible = eligibleProjects.filter((project) => {
    const query = search.trim().toLowerCase();
    return !query || `${project.folio} ${project.customer_name} ${project.solar_quotes?.folio ?? ''}`.toLowerCase().includes(query);
  });
  const selected = eligibleProjects.find((project) => project.id === selectedId) ?? visible[0] ?? null;
  const schedules = selected?.solar_payment_schedules ?? [];
  const payments = [...(selected?.solar_payments ?? [])].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  const refunds = [...(selected?.solar_payment_refunds ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const costs = [...(selected?.solar_project_cost_entries ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const commission = selected?.solar_commissions?.[0] ?? null;
  const milestones = commission?.solar_commission_milestones ?? [];
  const selectedFinancials = selected ? projectFinancials(selected) : null;
  const reconciled = selectedFinancials?.netCollections ?? 0;
  const totalPortfolio = eligibleProjects.reduce((sum, item) => sum + Number(item.agreed_total_mxn ?? 0), 0);
  const collectedPortfolio = eligibleProjects.reduce((sum, item) => sum + projectFinancials(item).netCollections, 0);
  const pendingCommissions = data.commissions.filter((item) => (isAdmin || item.seller_user_id === profile.user_id) && ['earned', 'approved'].includes(item.status)).reduce((sum, item) => sum + Number(item.net_commission_mxn ?? item.payable_amount_mxn ?? 0), 0);
  const paidCommissions = data.commissions.filter((item) => (isAdmin || item.seller_user_id === profile.user_id) && item.status === 'paid').reduce((sum, item) => sum + Math.max(Number(item.payable_amount_mxn ?? 0) - Number(item.recovered_amount_mxn ?? 0), 0), 0);
  const reportProjects = eligibleProjects.filter((project) => {
    const date = String(project.accepted_at ?? '').slice(0, 10);
    return (!reportFilter.from || date >= reportFilter.from) && (!reportFilter.to || date <= reportFilter.to) && (reportFilter.seller === 'all' || project.seller_user_id === reportFilter.seller);
  });
  const reportTotals = reportProjects.reduce((totals, project) => {
    const item = projectFinancials(project);
    totals.revenue += item.revenueBeforeVat; totals.cost += item.actualCost; totals.margin += item.actualMargin;
    return totals;
  }, { revenue: 0, cost: 0, margin: 0 });

  useEffect(() => {
    if (!selected) return;
    const nextCommission = selected.solar_commissions?.[0];
    setCommissionForm({
      rate: String(nextCommission?.rate_percent ?? ''),
      adjustment: String(nextCommission?.adjustment_mxn ?? 0),
      reason: nextCommission?.adjustment_reason ?? '',
      approvalReason: '', paymentReference: '', payrollReference: '',
    });
    const firstPending = (selected.solar_payment_schedules ?? []).find((item) => !['paid', 'waived', 'cancelled'].includes(item.status));
    setPaymentForm((current) => ({ ...current, scheduleId: firstPending?.id ?? '', amount: firstPending ? String(Math.max(Number(firstPending.amount_mxn) - Number(firstPending.paid_amount_mxn), 0)) : '' }));
  }, [selectedId, selected?.updated_at]);

  async function run(key, callback, success) {
    setBusy(key); setMessage('');
    const error = await callback();
    setBusy('');
    if (error) return setMessage(errorMessage(error));
    setMessage(success);
    await refresh();
  }

  async function recordPayment(event) {
    event.preventDefault();
    await run('payment', async () => {
      const { error } = await getSupabaseClient().rpc('record_solar_payment', {
        p_project_id: selected.id,
        p_schedule_id: paymentForm.scheduleId || null,
        p_amount_mxn: Number(paymentForm.amount),
        p_received_at: new Date(paymentForm.receivedAt).toISOString(),
        p_payment_method: paymentForm.method,
        p_reference: paymentForm.reference || null,
        p_notes: paymentForm.notes || null,
      });
      return error;
    }, 'Cobro registrado. Un administrador debe conciliarlo contra el movimiento bancario o comprobante.');
  }

  async function decidePayment(payment, decision) {
    const reason = decision === 'rejected' ? window.prompt('Motivo del rechazo del comprobante:') : '';
    if (decision === 'rejected' && !reason?.trim()) return;
    await run(`payment-${payment.id}`, async () => {
      const { error } = await getSupabaseClient().rpc('decide_solar_payment', { p_payment_id: payment.id, p_decision: decision, p_reason: reason || null });
      return error;
    }, decision === 'reconciled' ? 'Pago conciliado y saldo actualizado.' : 'Comprobante rechazado con motivo registrado.');
  }

  async function requestRefund(event) {
    event.preventDefault();
    await run('refund', async () => {
      const { error } = await getSupabaseClient().rpc('request_solar_payment_refund', {
        p_payment_id: refundForm.paymentId, p_amount_mxn: Number(refundForm.amount),
        p_reason: refundForm.reason, p_reference: refundForm.reference || null,
      });
      return error;
    }, 'Reembolso solicitado. El saldo sólo cambiará cuando un administrador lo autorice.');
    setRefundForm({ paymentId: '', amount: '', reason: '', reference: '' });
  }

  async function decideRefund(refund, decision) {
    const reason = decision === 'rejected' ? window.prompt('Motivo del rechazo del reembolso:') : window.prompt('Referencia del reembolso realizado:');
    if (!reason?.trim()) return;
    await run(`refund-${refund.id}`, async () => {
      const { error } = await getSupabaseClient().rpc('decide_solar_payment_refund', {
        p_refund_id: refund.id, p_decision: decision,
        p_decision_reason: decision === 'rejected' ? reason : null,
        p_reference: decision === 'approved' ? reason : refund.reference || null,
      });
      return error;
    }, decision === 'approved' ? 'Reembolso autorizado y aplicado al saldo del proyecto.' : 'Reembolso rechazado con motivo registrado.');
  }

  async function addCost(event) {
    event.preventDefault();
    await run('cost', async () => {
      const { error } = await getSupabaseClient().rpc('add_solar_project_cost', {
        p_project_id: selected.id, p_cost_stage: costForm.stage, p_category: costForm.category,
        p_description: costForm.description, p_quantity: Number(costForm.quantity),
        p_unit_cost_before_vat_mxn: Number(costForm.unitCost), p_vat_rate: Number(costForm.vatRate) / 100,
        p_status: costForm.status, p_incurred_at: costForm.incurredAt || null,
        p_supplier: costForm.supplier || null, p_reference: costForm.reference || null, p_notes: null,
      });
      return error;
    }, 'Costo guardado en la bitácora del proyecto.');
    setCostForm((current) => ({ ...current, description: '', quantity: '1', unitCost: '', supplier: '', reference: '' }));
  }

  async function voidCost(cost) {
    const reason = window.prompt('Motivo para anular este costo sin borrarlo:');
    if (!reason?.trim()) return;
    await run(`cost-${cost.id}`, async () => {
      const { error } = await getSupabaseClient().rpc('void_solar_project_cost', { p_cost_id: cost.id, p_reason: reason });
      return error;
    }, 'Costo anulado; el movimiento permanece visible para auditoría.');
  }

  async function reverseMilestone(milestone) {
    const reason = window.prompt('Motivo del reverso de comisión:');
    if (!reason?.trim()) return;
    await run(`reverse-${milestone.id}`, async () => {
      const { error } = await getSupabaseClient().rpc('reverse_solar_commission_milestone', {
        p_commission_id: commission.id, p_milestone_code: milestone.milestone_code, p_reason: reason,
      });
      return error;
    }, commission.status === 'paid' ? 'Hito revertido. Se abrió un saldo por recuperar al vendedor.' : 'Hito revertido y comisión recalculada.');
  }

  async function recordRecovery(event) {
    event.preventDefault();
    await run('recovery', async () => {
      const { error } = await getSupabaseClient().rpc('record_solar_commission_recovery', {
        p_commission_id: commission.id, p_amount_mxn: Number(recoveryForm.amount),
        p_reference: recoveryForm.reference, p_reason: recoveryForm.reason || null,
      });
      return error;
    }, 'Recuperación registrada y saldo de reverso actualizado.');
    setRecoveryForm({ amount: '', reference: '', reason: '' });
  }

  function exportFinanceReport() {
    const rows = financeReportRows(reportProjects, data.profileMap);
    const blob = new Blob([`\ufeff${financeRowsToCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `cdse-control-financiero-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }

  async function saveSchedule(schedule) {
    const dueInput = document.getElementById(`schedule-due-${schedule.id}`);
    await run(`schedule-${schedule.id}`, async () => {
      const { error } = await getSupabaseClient().from('solar_payment_schedules').update({
        due_at: dueInput.value || null,
      }).eq('id', schedule.id);
      return error;
    }, 'Fecha de cobro actualizada. El importe permanece ligado a la propuesta aceptada.');
  }

  async function saveCommission(event) {
    event.preventDefault();
    await run('commission-terms', async () => {
      const { error } = await getSupabaseClient().rpc('update_solar_commission_terms', {
        p_commission_id: commission.id,
        p_rate_percent: Number(commissionForm.rate),
        p_adjustment_mxn: Number(commissionForm.adjustment || 0),
        p_reason: commissionForm.reason || null,
      });
      return error;
    }, 'Política de comisión actualizada y asentada en la bitácora.');
  }

  async function confirmMilestone(code) {
    await run(`milestone-${code}`, async () => {
      const { error } = await getSupabaseClient().rpc('confirm_solar_commission_milestone', { p_commission_id: commission.id, p_milestone_code: code });
      return error;
    }, 'Hito confirmado. El porcentaje devengado fue recalculado.');
  }

  async function approveCommission() {
    await run('approve', async () => {
      const { error } = await getSupabaseClient().rpc('approve_solar_commission', { p_commission_id: commission.id, p_self_approval_reason: commissionForm.approvalReason || null });
      return error;
    }, 'Comisión autorizada. Ya puede pasar a pago.');
  }

  async function payCommission(event) {
    event.preventDefault();
    await run('pay', async () => {
      const { error } = await getSupabaseClient().rpc('pay_solar_commission', {
        p_commission_id: commission.id,
        p_payment_reference: commissionForm.paymentReference,
        p_payroll_reference: commissionForm.payrollReference || null,
      });
      return error;
    }, 'Pago de comisión registrado con su referencia.');
  }

  return <section className="sp-view">
    <header className="sp-view-header">
      <div><p className="sp-section-number">FINANZAS / CONTROL INTERNO</p><h1>Cobrar bien. Comisionar con evidencia.</h1></div>
      <p className="sp-header-note">Los cobros se controlan por el total del proyecto. La comisión usa exclusivamente la base aceptada antes de IVA.</p>
    </header>
    <div className="sp-ledger">
      <div><span>Cartera contratada</span><strong>{money.format(totalPortfolio)}</strong><small>importe total de proyectos</small></div>
      <div><span>Cobrado conciliado</span><strong>{money.format(collectedPortfolio)}</strong><small>{totalPortfolio ? number.format(collectedPortfolio / totalPortfolio * 100) : 0}% de la cartera</small></div>
      <div><span>Comisiones por liquidar</span><strong>{money.format(pendingCommissions)}</strong><small>devengadas o autorizadas</small></div>
      <div><span>Comisiones pagadas</span><strong>{money.format(paidCommissions)}</strong><small>con referencia registrada</small></div>
    </div>
    {isAdmin && <section className="sp-finance-report">
      <div><p className="sp-section-number">REPORTE POR PERIODO</p><h2>Rentabilidad operativa</h2><p>Ingresos, costos y margen antes de IVA. Exportación auxiliar para conciliación contable.</p></div>
      <div className="sp-report-filters">
        <label className="sp-field"><span>Desde</span><input type="date" value={reportFilter.from} onChange={(event) => setReportFilter({ ...reportFilter, from: event.target.value })} /></label>
        <label className="sp-field"><span>Hasta</span><input type="date" value={reportFilter.to} onChange={(event) => setReportFilter({ ...reportFilter, to: event.target.value })} /></label>
        <label className="sp-field"><span>Vendedor</span><select value={reportFilter.seller} onChange={(event) => setReportFilter({ ...reportFilter, seller: event.target.value })}><option value="all">Todos</option>{Object.values(data.profileMap).filter((item) => item.role === 'seller' || item.role === 'admin').map((item) => <option value={item.user_id} key={item.user_id}>{item.full_name}</option>)}</select></label>
        <button type="button" className="sp-button sp-button--secondary" onClick={exportFinanceReport} disabled={!reportProjects.length}>Exportar CSV</button>
      </div>
      <div className="sp-report-totals"><div><span>Venta antes de IVA</span><strong>{money.format(reportTotals.revenue)}</strong></div><div><span>Costo real pagado</span><strong>{money.format(reportTotals.cost)}</strong></div><div><span>Margen real</span><strong>{money.format(reportTotals.margin)}</strong><small>{reportTotals.revenue ? number.format(reportTotals.margin / reportTotals.revenue * 100) : 0}%</small></div><div><span>Proyectos</span><strong>{reportProjects.length}</strong></div></div>
    </section>}
    <div className="sp-finance-layout">
      <aside className="sp-finance-index">
        <label className="sp-field"><span>Buscar proyecto</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Folio o cliente" /></label>
        <div className="sp-finance-projects">
          {visible.map((project) => {
            const projectPaid = projectFinancials(project).netCollections;
            return <button type="button" className={selected?.id === project.id ? 'is-active' : ''} onClick={() => setSelectedId(project.id)} key={project.id}>
              <span>{project.folio}</span><strong>{project.customer_name}</strong><small>{money.format(projectPaid)} de {money.format(Number(project.agreed_total_mxn))}</small>
              <i><b style={{ width: `${Math.min(projectPaid / Math.max(Number(project.agreed_total_mxn), 1) * 100, 100)}%` }} /></i>
            </button>;
          })}
          {!visible.length && <p>No hay proyectos que coincidan.</p>}
        </div>
      </aside>
      {selected ? <div className="sp-finance-detail">
        <header className="sp-finance-title"><div><p className="sp-section-number">{selected.folio}</p><h2>{selected.customer_name}</h2></div><button type="button" className="sp-text-button" onClick={() => onOpenProject(selected.id)}>Abrir expediente →</button></header>
        <div className="sp-balance-strip">
          <div><span>Proyecto con IVA</span><strong>{money.format(Number(selected.agreed_total_mxn))}</strong></div>
          <div><span>Conciliado</span><strong>{money.format(reconciled)}</strong></div>
          <div><span>Saldo</span><strong>{money.format(Math.max(Number(selected.agreed_total_mxn) - reconciled, 0))}</strong></div>
        </div>
        {isAdmin && <div className="sp-margin-strip"><div><span>Ingreso antes de IVA</span><strong>{money.format(selectedFinancials.revenueBeforeVat)}</strong></div><div><span>Presupuesto</span><strong>{money.format(selectedFinancials.budgetCost)}</strong></div><div><span>Costo real pagado</span><strong>{money.format(selectedFinancials.actualCost)}</strong></div><div className={selectedFinancials.actualMargin < 0 ? 'is-negative' : ''}><span>Margen real</span><strong>{money.format(selectedFinancials.actualMargin)}</strong><small>{number.format(selectedFinancials.actualMarginPercent)}%</small></div></div>}
        {message && <p className="sp-inline-notice">{message}</p>}

        <section className="sp-finance-section">
          <div className="sp-subhead"><div><p className="sp-section-number">01 / COBRANZA</p><h2>Calendario acordado</h2></div><span>{schedules.length} concepto{schedules.length === 1 ? '' : 's'}</span></div>
          <div className="sp-schedule-list">
            {schedules.sort((a, b) => a.sequence - b.sequence).map((schedule) => <article key={schedule.id}>
              <span className={`sp-finance-status sp-finance-status--${schedule.status}`}>{PAYMENT_STATUS_LABELS[schedule.status] ?? schedule.status}</span>
              <div><strong>{schedule.label}</strong><small>{money.format(Number(schedule.paid_amount_mxn))} aplicado</small></div>
              {isAdmin ? <><b>{money.format(Number(schedule.amount_mxn))}</b><input id={`schedule-due-${schedule.id}`} aria-label={`Vencimiento ${schedule.label}`} type="date" defaultValue={schedule.due_at ?? ''} /><button type="button" className="sp-text-button" disabled={busy === `schedule-${schedule.id}`} onClick={() => saveSchedule(schedule)}>Guardar fecha</button></> : <><b>{money.format(Number(schedule.amount_mxn))}</b><time>{schedule.due_at ? new Date(`${schedule.due_at}T12:00:00`).toLocaleDateString('es-MX') : 'Sin fecha'}</time></>}
            </article>)}
          </div>
          {canCapturePayment && <form className="sp-payment-form" onSubmit={recordPayment}>
            <label className="sp-field"><span>Aplicar a</span><select value={paymentForm.scheduleId} onChange={(event) => { const schedule = schedules.find((item) => item.id === event.target.value); setPaymentForm({ ...paymentForm, scheduleId: event.target.value, amount: schedule ? String(Math.max(Number(schedule.amount_mxn) - Number(schedule.paid_amount_mxn), 0)) : paymentForm.amount }); }}><option value="">Sin concepto</option>{schedules.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="sp-field"><span>Importe recibido</span><input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required /></label>
            <label className="sp-field"><span>Fecha y hora</span><input type="datetime-local" value={paymentForm.receivedAt} onChange={(event) => setPaymentForm({ ...paymentForm, receivedAt: event.target.value })} required /></label>
            <label className="sp-field"><span>Medio</span><select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="check">Cheque</option><option value="financing">Financiamiento</option><option value="other">Otro</option></select></label>
            <label className="sp-field"><span>Referencia</span><input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} placeholder="Folio bancario o recibo" /></label>
            <button className="sp-button sp-button--primary" disabled={busy === 'payment'}>{busy === 'payment' ? 'Registrando…' : 'Registrar para conciliación'}</button>
          </form>}
          <div className="sp-payment-ledger">
            {payments.map((payment) => <article key={payment.id}><time>{new Date(payment.received_at).toLocaleDateString('es-MX')}</time><div><strong>{money.format(Number(payment.amount_mxn))}</strong><small>{payment.payment_method} · {payment.reference || 'sin referencia'}</small></div><span className={`sp-finance-status sp-finance-status--${payment.status}`}>{PAYMENT_STATUS_LABELS[payment.status]}</span><div>{isAdmin && payment.status === 'pending' && <><button type="button" onClick={() => decidePayment(payment, 'reconciled')}>Conciliar</button><button type="button" onClick={() => decidePayment(payment, 'rejected')}>Rechazar</button></>}{['reconciled', 'refunded'].includes(payment.status) && <button type="button" onClick={() => setRefundForm({ ...refundForm, paymentId: payment.id, amount: '', reason: '', reference: payment.reference ?? '' })}>Reembolso</button>}</div></article>)}
            {!payments.length && <p>Aún no hay cobros registrados.</p>}
          </div>
          {refundForm.paymentId && <form className="sp-refund-form" onSubmit={requestRefund}><div><strong>Solicitar reembolso</strong><small>Requiere autorización administrativa y conserva el pago original.</small></div><label className="sp-field"><span>Importe</span><input type="number" min="0.01" step="0.01" required value={refundForm.amount} onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })} /></label><label className="sp-field"><span>Motivo</span><input minLength="5" required value={refundForm.reason} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} /></label><label className="sp-field"><span>Referencia</span><input value={refundForm.reference} onChange={(event) => setRefundForm({ ...refundForm, reference: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'refund'}>Enviar a autorización</button><button type="button" className="sp-text-button" onClick={() => setRefundForm({ paymentId: '', amount: '', reason: '', reference: '' })}>Cancelar</button></form>}
          {!!refunds.length && <div className="sp-refund-ledger"><h3>Reembolsos</h3>{refunds.map((refund) => <article key={refund.id}><div><strong>{money.format(Number(refund.amount_mxn))}</strong><small>{refund.reason}</small></div><span className={`sp-finance-status sp-finance-status--${refund.status}`}>{refund.status === 'approved' ? 'Autorizado' : refund.status === 'rejected' ? 'Rechazado' : 'Por autorizar'}</span>{isAdmin && refund.status === 'pending' && <div><button type="button" onClick={() => decideRefund(refund, 'approved')}>Autorizar</button><button type="button" onClick={() => decideRefund(refund, 'rejected')}>Rechazar</button></div>}</article>)}</div>}
          <p className="sp-compliance-note">Control interno: registrar un pago aquí no emite CFDI. Si la operación es en parcialidades, contabilidad debe revisar el complemento de recepción de pagos aplicable.</p>
        </section>

        {isAdmin && <section className="sp-finance-section">
          <div className="sp-subhead"><div><p className="sp-section-number">02 / COSTOS Y MARGEN</p><h2>Presupuesto contra realidad</h2></div><span>Importes antes de IVA</span></div>
          <div className="sp-cost-summary"><div><span>Presupuesto activo</span><strong>{money.format(selectedFinancials.budgetCost)}</strong></div><div><span>Comprometido</span><strong>{money.format(selectedFinancials.committedCost)}</strong></div><div><span>Pagado real</span><strong>{money.format(selectedFinancials.actualCost)}</strong></div><div><span>Margen estimado</span><strong>{money.format(selectedFinancials.estimatedMargin)}</strong><small>{number.format(selectedFinancials.estimatedMarginPercent)}%</small></div></div>
          <form className="sp-cost-form" onSubmit={addCost}><label className="sp-field"><span>Registro</span><select value={costForm.stage} onChange={(event) => setCostForm({ ...costForm, stage: event.target.value, status: event.target.value === 'budget' ? 'approved' : 'paid' })}><option value="actual">Costo real</option><option value="budget">Presupuesto</option></select></label><label className="sp-field"><span>Categoría</span><select value={costForm.category} onChange={(event) => setCostForm({ ...costForm, category: event.target.value })}>{Object.entries(COST_CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="sp-field sp-field--wide"><span>Concepto</span><input required minLength="2" maxLength="180" value={costForm.description} onChange={(event) => setCostForm({ ...costForm, description: event.target.value })} /></label><label className="sp-field"><span>Cantidad</span><input type="number" min="0.001" step="0.001" required value={costForm.quantity} onChange={(event) => setCostForm({ ...costForm, quantity: event.target.value })} /></label><label className="sp-field"><span>Costo unitario sin IVA</span><input type="number" min="0" step="0.01" required value={costForm.unitCost} onChange={(event) => setCostForm({ ...costForm, unitCost: event.target.value })} /></label><label className="sp-field"><span>IVA</span><select value={costForm.vatRate} onChange={(event) => setCostForm({ ...costForm, vatRate: event.target.value })}><option value="16">16%</option><option value="0">0%</option></select></label><label className="sp-field"><span>Estado</span><select value={costForm.status} onChange={(event) => setCostForm({ ...costForm, status: event.target.value })}><option value="approved">Aprobado</option>{costForm.stage === 'actual' && <><option value="committed">Comprometido</option><option value="paid">Pagado</option></>}</select></label><label className="sp-field"><span>Fecha</span><input type="date" value={costForm.incurredAt} onChange={(event) => setCostForm({ ...costForm, incurredAt: event.target.value })} /></label><label className="sp-field"><span>Proveedor</span><input value={costForm.supplier} onChange={(event) => setCostForm({ ...costForm, supplier: event.target.value })} /></label><label className="sp-field"><span>Referencia</span><input value={costForm.reference} onChange={(event) => setCostForm({ ...costForm, reference: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'cost'}>Agregar costo</button></form>
          <div className="sp-cost-ledger">{costs.map((cost) => <article className={cost.status === 'void' ? 'is-void' : ''} key={cost.id}><span>{cost.cost_stage === 'budget' ? 'PRESUPUESTO' : 'REAL'}</span><div><strong>{cost.description}</strong><small>{COST_CATEGORY_LABELS[cost.category]} · {cost.supplier || 'sin proveedor'} · {cost.status}</small></div><b>{money.format(Number(cost.amount_before_vat_mxn))}</b>{cost.status !== 'void' && <button type="button" onClick={() => voidCost(cost)}>Anular</button>}</article>)}{!costs.length && <p>Captura costos para calcular el margen del proyecto.</p>}</div>
          <p className="sp-compliance-note">Los importes se comparan antes de IVA. Este control es operativo y debe conciliarse con pólizas, CFDI y estados bancarios en contabilidad.</p>
        </section>}

        <section className="sp-finance-section">
          <div className="sp-subhead"><div><p className="sp-section-number">{isAdmin ? '03' : '02'} / COMISIÓN</p><h2>Liquidación del vendedor</h2></div>{commission && <span>{COMMISSION_STATUS_LABELS[commission.status] ?? commission.status}</span>}</div>
          {commission ? <>
            <div className="sp-commission-equation"><div><span>Base antes de IVA</span><strong>{money.format(Number(commission.base_before_vat_mxn))}</strong></div><b>×</b><div><span>Tasa</span><strong>{number.format(Number(commission.rate_percent))}%</strong></div><b>+</b><div><span>Ajuste</span><strong>{money.format(Number(commission.adjustment_mxn))}</strong></div><b>=</b><div className="is-total"><span>Comisión neta</span><strong>{money.format(Number(commission.net_commission_mxn ?? commission.payable_amount_mxn))}</strong>{Number(commission.reversed_amount_mxn ?? 0) > 0 && <small>Reversado: {money.format(Number(commission.reversed_amount_mxn))}</small>}</div></div>
            <div className="sp-milestones">{milestones.sort((a, b) => a.milestone_code.localeCompare(b.milestone_code)).map((milestone) => <article className={milestone.status === 'earned' ? 'is-earned' : milestone.status === 'reversed' ? 'is-reversed' : ''} key={milestone.id}><span>{milestone.status === 'earned' ? '✓' : milestone.status === 'reversed' ? '↶' : milestone.weight_percent + '%'}</span><div><strong>{milestone.label}</strong><small>{milestone.status === 'earned' ? `Confirmado ${new Date(milestone.earned_at).toLocaleDateString('es-MX')}` : milestone.status === 'reversed' ? `Revertido: ${milestone.reversal_reason}` : 'Pendiente de evidencia'}</small></div>{isAdmin && milestone.status !== 'earned' && commission.status !== 'paid' && <button type="button" onClick={() => confirmMilestone(milestone.milestone_code)} disabled={busy === `milestone-${milestone.milestone_code}`}>Confirmar</button>}{isAdmin && milestone.status === 'earned' && <button type="button" onClick={() => reverseMilestone(milestone)} disabled={busy === `reverse-${milestone.id}`}>Revertir</button>}</article>)}</div>
            {isAdmin && !['approved', 'paid', 'void'].includes(commission.status) && <form className="sp-commission-policy" onSubmit={saveCommission}><label className="sp-field"><span>Tasa (5%–10%)</span><input type="number" min="0" max="10" step="0.1" value={commissionForm.rate} onChange={(event) => setCommissionForm({ ...commissionForm, rate: event.target.value })} /></label><label className="sp-field"><span>Ajuste MXN</span><input type="number" step="0.01" value={commissionForm.adjustment} onChange={(event) => setCommissionForm({ ...commissionForm, adjustment: event.target.value })} /></label><label className="sp-field"><span>Justificación si hay ajuste</span><input value={commissionForm.reason} onChange={(event) => setCommissionForm({ ...commissionForm, reason: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'commission-terms'}>Guardar política</button></form>}
            {isAdmin && commission.status === 'earned' && <div className="sp-commission-action"><label className="sp-field"><span>Motivo de autorización propia (sólo si aplica)</span><input value={commissionForm.approvalReason} onChange={(event) => setCommissionForm({ ...commissionForm, approvalReason: event.target.value })} placeholder="Se audita cuando administrador y vendedor son la misma persona" /></label><button type="button" className="sp-button sp-button--primary" onClick={approveCommission} disabled={busy === 'approve'}>Autorizar comisión</button></div>}
            {isAdmin && commission.status === 'approved' && <form className="sp-commission-action" onSubmit={payCommission}><label className="sp-field"><span>Referencia de pago</span><input required value={commissionForm.paymentReference} onChange={(event) => setCommissionForm({ ...commissionForm, paymentReference: event.target.value })} /></label><label className="sp-field"><span>Referencia de nómina/contabilidad</span><input value={commissionForm.payrollReference} onChange={(event) => setCommissionForm({ ...commissionForm, payrollReference: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'pay'}>Registrar comisión pagada</button></form>}
            {isAdmin && Number(commission.clawback_balance_mxn ?? 0) > 0 && <form className="sp-recovery-form" onSubmit={recordRecovery}><div><strong>Saldo por recuperar</strong><span>{money.format(Number(commission.clawback_balance_mxn))}</span><small>Comisión ya pagada cuyo hito fue revertido.</small></div><label className="sp-field"><span>Importe recuperado</span><input type="number" min="0.01" max={Number(commission.clawback_balance_mxn)} step="0.01" required value={recoveryForm.amount} onChange={(event) => setRecoveryForm({ ...recoveryForm, amount: event.target.value })} /></label><label className="sp-field"><span>Referencia</span><input required value={recoveryForm.reference} onChange={(event) => setRecoveryForm({ ...recoveryForm, reference: event.target.value })} /></label><label className="sp-field"><span>Nota</span><input value={recoveryForm.reason} onChange={(event) => setRecoveryForm({ ...recoveryForm, reason: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'recovery'}>Registrar recuperación</button></form>}
            <p className="sp-compliance-note">La comisión no se calcula sobre IVA. Para personal subordinado, el registro interno debe conciliarse con nómina y el comprobante fiscal correspondiente.</p>
          </> : <EmptyState title="Sin comisión asignada" detail="Este proyecto no tiene vendedor o política de comisión asociada." />}
        </section>
      </div> : <EmptyState title="Aún no hay proyectos vendidos" detail="Al aceptar una cotización se abrirá automáticamente su control de cobros y comisión." />}
    </div>
  </section>;
}

function Projects({ data, refresh, isAdmin, profile, openProjectId }) {
  const permissions = {
    tasks: canPerform(profile.role, 'project.tasks'),
    documents: canPerform(profile.role, 'project.documents'),
    survey: canPerform(profile.role, 'survey.manage'),
    engineering: canPerform(profile.role, 'engineering.manage'),
  };
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(data.projects[0]?.id ?? null);
  const [busyId, setBusyId] = useState('');
  const [uploadingId, setUploadingId] = useState('');
  const [taskForm, setTaskForm] = useState(null);
  const [operationsForm, setOperationsForm] = useState(null);
  const [surveyForm, setSurveyForm] = useState(null);
  const [engineeringForm, setEngineeringForm] = useState(null);
  const [exportProgress, setExportProgress] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (openProjectId) setSelectedId(openProjectId);
  }, [openProjectId]);
  useEffect(() => {
    setSurveyForm(null);
    setEngineeringForm(null);
    setOperationsForm(null);
    setExportProgress(null);
  }, [selectedId]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleProjects = data.projects.filter((project) => {
    const haystack = [
      project.folio,
      project.customer_name,
      project.service_number,
      project.cfe_tracking_folio,
      project.solar_quotes?.folio,
    ].filter(Boolean).join(' ').toLowerCase();
    return (!normalizedSearch || haystack.includes(normalizedSearch))
      && (statusFilter === 'all' || project.status === statusFilter);
  });
  const selected = data.projects.find((project) => project.id === selectedId)
    ?? visibleProjects[0]
    ?? null;
  const blocked = data.projects.filter((project) => ['blocked', 'overdue'].includes(project.health));
  const cfeOpen = data.projects.filter((project) => [
    'ready_for_submission', 'submitted_to_cfe', 'cfe_observation', 'meter_change_pending',
  ].includes(project.status));
  const installations = data.projects.filter((project) => [
    'approved_for_installation', 'installation_scheduled', 'installation_in_progress',
  ].includes(project.status));

  async function completeTask(task) {
    setBusyId(task.id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('complete_solar_project_task', {
      p_task_id: task.id,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage('Tarea completada y registrada en el proyecto.');
    await refresh();
  }

  async function uploadDocument(document, files) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;
    const invalidFile = selectedFiles.find((file) => !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15728640);
    if (invalidFile) {
      return setMessage(`${invalidFile.name}: usa PDF, JPG, PNG o WEBP de máximo 15 MB.`);
    }
    setUploadingId(document.id);
    setMessage('');
    const client = getSupabaseClient();
    for (const file of selectedFiles) {
      const safeName = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);
      const storagePath = `${document.project_id}/${document.document_code}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage.from('solar-projects').upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) {
        setUploadingId('');
        return setMessage(errorMessage(uploadError));
      }
      const { error: registerError } = await client.rpc('register_solar_project_document_upload', {
        p_document_id: document.id,
        p_storage_path: storagePath,
        p_mime_type: file.type,
        p_file_size_bytes: file.size,
        p_original_name: file.name,
      });
      if (registerError) {
        setUploadingId('');
        return setMessage(errorMessage(registerError));
      }
    }
    setUploadingId('');
    setMessage(`${selectedFiles.length} archivo${selectedFiles.length === 1 ? '' : 's'} agregado${selectedFiles.length === 1 ? '' : 's'} al expediente.`);
    await refresh();
  }

  async function openProjectFile(file) {
    const client = getSupabaseClient();
    const { error: auditError } = await client.rpc('log_solar_project_access', {
      p_project_id: file.project_id,
      p_action: 'document_opened',
      p_document_id: file.document_id,
      p_metadata: { fileId: file.id, originalName: file.original_name },
    });
    if (auditError) return setMessage(errorMessage(auditError));
    const { data: signed, error } = await client.storage
      .from('solar-projects')
      .createSignedUrl(file.storage_path, 300);
    if (error) return setMessage(errorMessage(error));
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function reviewDocument(document, decision) {
    let reason = null;
    if (decision === 'rejected') {
      reason = window.prompt('Indica exactamente qué debe corregirse:')?.trim();
      if (!reason) return;
    }
    setBusyId(document.id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('review_solar_project_document', {
      p_document_id: document.id,
      p_decision: decision,
      p_rejection_reason: reason,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage(decision === 'approved' ? 'Documento aprobado y requisito completado.' : 'Documento rechazado; la corrección quedó registrada.');
    await refresh();
  }

  async function setApplicability(document, applies) {
    setBusyId(document.id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('set_solar_document_applicability', {
      p_document_id: document.id,
      p_applies: applies,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage(applies ? 'El requisito condicional ahora es obligatorio.' : 'El requisito quedó marcado como no aplicable.');
    await refresh();
  }

  async function createTask(event) {
    event.preventDefault();
    if (!taskForm || !selected) return;
    setBusyId('new-task');
    setMessage('');
    const { error } = await getSupabaseClient().rpc('create_solar_project_task', {
      p_project_id: selected.id,
      p_title: taskForm.title,
      p_task_type: taskForm.type,
      p_due_at: taskForm.dueAt ? new Date(taskForm.dueAt).toISOString() : null,
      p_assigned_to: taskForm.assignedTo || null,
      p_priority: taskForm.priority,
      p_description: taskForm.description || null,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setTaskForm(null);
    setMessage('Compromiso agregado a la agenda del proyecto.');
    await refresh();
  }

  function beginOperationsUpdate() {
    setOperationsForm({
      status: selected.status,
      health: selected.health,
      nextAction: selected.next_action ?? '',
      blockedReason: selected.blocked_reason ?? '',
      cfeFolio: selected.cfe_tracking_folio ?? '',
      siteSurveyAt: selected.target_site_survey_at?.slice(0, 16) ?? '',
      installationAt: selected.target_installation_at?.slice(0, 16) ?? '',
    });
  }

  async function updateOperations(event) {
    event.preventDefault();
    setBusyId('operations');
    setMessage('');
    const { error } = await getSupabaseClient().rpc('update_solar_project_operations', {
      p_project_id: selected.id,
      p_status: operationsForm.status,
      p_health: operationsForm.health,
      p_next_action: operationsForm.nextAction,
      p_blocked_reason: operationsForm.blockedReason || null,
      p_cfe_tracking_folio: operationsForm.cfeFolio || null,
      p_target_site_survey_at: operationsForm.siteSurveyAt ? new Date(operationsForm.siteSurveyAt).toISOString() : null,
      p_target_installation_at: operationsForm.installationAt ? new Date(operationsForm.installationAt).toISOString() : null,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setOperationsForm(null);
    setMessage('Etapa, salud y próximos compromisos actualizados.');
    await refresh();
  }

  function beginSurvey() {
    const current = [...(selected.solar_site_surveys ?? [])]
      .sort((a, b) => b.version - a.version)[0];
    setEngineeringForm(null);
    setSurveyForm({
      visitedAt: current?.visited_at?.slice(0, 16) ?? selected.target_site_survey_at?.slice(0, 16) ?? '',
      technicianUserId: current?.technician_user_id ?? profile.user_id,
      latitude: current?.latitude ?? '',
      longitude: current?.longitude ?? '',
      roofType: current?.roof_type ?? 'concrete_slab',
      roofCondition: current?.roof_condition ?? '',
      usableAreaM2: current?.usable_area_m2 ?? '',
      orientationDegrees: current?.orientation_degrees ?? '',
      tiltDegrees: current?.tilt_degrees ?? '',
      shadingLevel: current?.shading_level ?? '',
      electricalService: current?.electrical_service ?? '',
      serviceVoltage: current?.service_voltage ?? '',
      mainBreakerAmps: current?.main_breaker_amps ?? '',
      panelboardCondition: current?.panelboard_condition ?? '',
      groundingAvailable: current?.grounding_available == null ? '' : String(current.grounding_available),
      meterAccessible: current?.meter_accessible == null ? '' : String(current.meter_accessible),
      routeLengthM: current?.route_length_m ?? '',
      structureNotes: current?.structure_notes ?? '',
      electricalNotes: current?.electrical_notes ?? '',
      safetyNotes: current?.safety_notes ?? '',
      generalNotes: current?.general_notes ?? '',
    });
  }

  async function saveSurvey(event) {
    event.preventDefault();
    const submit = event.nativeEvent.submitter?.value === 'submit';
    setBusyId('site-survey');
    setMessage('');
    const { error } = await getSupabaseClient().rpc('save_solar_site_survey', {
      p_project_id: selected.id,
      p_survey: surveyForm,
      p_submit: submit,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setSurveyForm(null);
    setMessage(submit ? 'Levantamiento enviado a revisión técnica.' : 'Borrador de levantamiento guardado.');
    await refresh();
  }

  async function reviewSurvey(survey, decision) {
    let reason = null;
    if (decision === 'rejected') {
      reason = window.prompt('Indica exactamente qué debe corregirse en el levantamiento:')?.trim();
      if (!reason) return;
    }
    setBusyId(survey.id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('review_solar_site_survey', {
      p_survey_id: survey.id,
      p_decision: decision,
      p_rejection_reason: reason,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage(decision === 'approved' ? 'Levantamiento técnico aprobado.' : 'Levantamiento devuelto con observaciones.');
    await refresh();
  }

  function beginEngineering() {
    const current = [...(selected.solar_engineering_revisions ?? [])]
      .sort((a, b) => b.version - a.version)[0];
    const scope = selected.sold_scope_snapshot ?? {};
    const result = scope.results ?? {};
    const configuration = scope.configuration ?? {};
    setSurveyForm(null);
    setEngineeringForm({
      panelCount: current?.panel_count ?? scope.panelCount ?? result.panelCount ?? '',
      moduleModel: current?.module_model ?? configuration.module?.name ?? configuration.module?.model ?? '',
      inverterModel: current?.inverter_model ?? configuration.inverter?.name ?? configuration.inverter?.model ?? '',
      inverterQuantity: current?.inverter_quantity ?? scope.inverterQuantity ?? 1,
      systemDcKw: current?.system_dc_kw ?? result.systemDcKw ?? '',
      inverterAcKw: current?.inverter_ac_kw ?? configuration.inverter?.acPowerKw ?? configuration.inverter?.nominalPowerKw ?? '',
      stringConfiguration: current?.string_configuration ?? '',
      mpptConfiguration: current?.mppt_configuration ?? '',
      dcProtection: current?.dc_protection ?? '',
      acProtection: current?.ac_protection ?? '',
      conductorSpecification: current?.conductor_specification ?? '',
      groundingDesign: current?.grounding_design ?? '',
      designNotes: current?.design_notes ?? '',
    });
  }

  async function saveEngineering(event) {
    event.preventDefault();
    const submit = event.nativeEvent.submitter?.value === 'submit';
    setBusyId('engineering');
    setMessage('');
    const { error } = await getSupabaseClient().rpc('save_solar_engineering_revision', {
      p_project_id: selected.id,
      p_design: engineeringForm,
      p_submit: submit,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setEngineeringForm(null);
    setMessage(submit ? 'Diseño enviado a revisión. El unifilar aprobado quedó vinculado.' : 'Borrador de ingeniería guardado.');
    await refresh();
  }

  async function reviewEngineering(revision, decision) {
    let reason = null;
    if (decision === 'rejected') {
      reason = window.prompt('Indica exactamente qué debe corregirse en el diseño:')?.trim();
      if (!reason) return;
    }
    setBusyId(revision.id);
    setMessage('');
    const { error } = await getSupabaseClient().rpc('review_solar_engineering_revision', {
      p_revision_id: revision.id,
      p_decision: decision,
      p_rejection_reason: reason,
    });
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage(decision === 'approved' ? 'Ingeniería aprobada y habilitada para el expediente CFE.' : 'Diseño devuelto con observaciones.');
    await refresh();
  }

  async function generateProjectResource(kind) {
    const project = { ...selected, _profileMap: data.profileMap };
    const actions = {
      survey: {
        audit: 'site_survey_report_generated',
        run: () => downloadSiteSurveyReport(project),
        success: 'Reporte de levantamiento descargado.',
      },
      authorization: {
        audit: 'authorization_template_generated',
        run: () => downloadAuthorizationLetter(project),
        success: 'Carta de autorización generada. Recuerda validar si aplica antes de firmarla.',
      },
      index: {
        audit: 'dossier_index_generated',
        run: () => downloadDossierIndex(project),
        success: 'Índice actualizado del expediente descargado.',
      },
    };
    const action = actions[kind];
    if (!action) return;
    setBusyId(`resource-${kind}`);
    setMessage('');
    try {
      await action.run();
      const { error } = await getSupabaseClient().rpc('log_solar_project_access', {
        p_project_id: selected.id,
        p_action: action.audit,
        p_document_id: null,
        p_metadata: { projectFolio: selected.folio },
      });
      if (error) throw error;
      setMessage(action.success);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyId('');
    }
  }

  async function exportDossier() {
    setBusyId('resource-export');
    setMessage('');
    setExportProgress({ current: 0, total: 1, label: 'Preparando expediente privado' });
    const client = getSupabaseClient();
    try {
      const result = await exportProjectDossierZip(
        { ...selected, _profileMap: data.profileMap },
        client,
        setExportProgress,
      );
      const { error } = await client.rpc('log_solar_project_access', {
        p_project_id: selected.id,
        p_action: 'dossier_exported',
        p_document_id: null,
        p_metadata: { fileCount: result.fileCount, totalBytes: result.totalBytes },
      });
      if (error) throw error;
      setMessage(`Expediente privado exportado con ${result.fileCount} archivo${result.fileCount === 1 ? '' : 's'} fuente.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyId('');
      setTimeout(() => setExportProgress(null), 1800);
    }
  }

  const requiredChecklist = selected?.solar_project_checklist_items?.filter((item) => item.required) ?? [];
  const completedChecklist = requiredChecklist.filter((item) => item.status === 'complete').length;
  const integrity = requiredChecklist.length
    ? Math.round((completedChecklist / requiredChecklist.length) * 100)
    : 0;
  const pendingTasks = (selected?.solar_project_tasks ?? [])
    .filter((task) => !['completed', 'cancelled'].includes(task.status))
    .sort((a, b) => String(a.due_at ?? '9999').localeCompare(String(b.due_at ?? '9999')));
  const documentsByStage = (selected?.solar_project_documents ?? []).reduce((groups, document) => {
    const stage = document.solar_document_requirements?.stage ?? 'commercial';
    groups[stage] = [...(groups[stage] ?? []), document];
    return groups;
  }, {});
  const commission = selected?.solar_commissions?.[0];
  const latestSurvey = [...(selected?.solar_site_surveys ?? [])].sort((a, b) => b.version - a.version)[0];
  const latestEngineering = [...(selected?.solar_engineering_revisions ?? [])].sort((a, b) => b.version - a.version)[0];
  const surveyApproved = (selected?.solar_site_surveys ?? []).some((item) => item.status === 'approved');
  const engineeringApproved = (selected?.solar_engineering_revisions ?? []).some((item) => item.status === 'approved');
  const missingCfeDocuments = requiredChecklist.filter((item) => (
    ['commercial', 'site_survey', 'engineering', 'cfe'].includes(item.stage)
    && !['cfe_acknowledgement', 'cfe_response', 'interconnection_contract', 'compensation_contract'].includes(item.item_code)
    && item.status !== 'complete'
  ));
  const readyForCfe = surveyApproved && engineeringApproved && missingCfeDocuments.length === 0;
  const engineeringRatio = engineeringForm?.systemDcKw && engineeringForm?.inverterAcKw
    ? Number(engineeringForm.systemDcKw) / Number(engineeringForm.inverterAcKw) * 100
    : 0;
  const projectFiles = (selected?.solar_project_documents ?? [])
    .flatMap((document) => document.solar_project_document_files ?? []);
  const projectFileBytes = projectFiles.reduce((sum, file) => sum + Number(file.file_size_bytes ?? 0), 0);

  return (
    <section className="sp-view">
      <header className="sp-view-header">
        <div><p className="sp-section-number">OPERACIÓN / PROYECTOS</p><h1>De la venta a la energía.</h1></div>
        <p className="sp-header-note">Cada venta aceptada abre automáticamente expediente, tareas y control de comisión antes de IVA.</p>
      </header>

      <div className="sp-ledger">
        <div><span>Proyectos activos</span><strong>{data.projects.filter((project) => !['operational', 'cancelled'].includes(project.status)).length}</strong><small>requieren ejecución</small></div>
        <div><span>Bloqueados o vencidos</span><strong>{blocked.length}</strong><small>acción prioritaria</small></div>
        <div><span>En flujo CFE</span><strong>{cfeOpen.length}</strong><small>expediente o seguimiento</small></div>
        <div><span>Por instalar</span><strong>{installations.length}</strong><small>capacidad operativa</small></div>
      </div>

      <div className="sp-quote-filters">
        <label className="sp-field"><span>Buscar proyecto</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Proyecto, cliente, servicio o folio CFE" /></label>
        <label className="sp-field"><span>Etapa</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todas</option>{Object.entries(PROJECT_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
      </div>

      {data.projects.length ? <>
        <div className="sp-table-wrap sp-table-wrap--full">
          <table>
            <thead><tr><th>Proyecto</th><th>Cliente</th><th>Responsable</th><th>Etapa</th><th>Salud</th><th>Próxima acción</th></tr></thead>
            <tbody>{visibleProjects.map((project) => <tr key={project.id} className={selected?.id === project.id ? 'is-selected' : ''}>
              <td><button type="button" className="sp-link-button sp-folio" onClick={() => setSelectedId(project.id)}>{project.folio}</button><small>{project.solar_quotes?.folio}</small></td>
              <td><strong>{project.customer_name}</strong><small>{project.service_number ? `Servicio ${project.service_number}` : 'Servicio por confirmar'}</small></td>
              <td>{data.profileMap[project.seller_user_id]?.full_name ?? 'Sin asignar'}</td>
              <td><span className="sp-status">{PROJECT_STATUS_LABELS[project.status] ?? project.status}</span></td>
              <td><span className={`sp-health sp-health--${project.health}`}>{PROJECT_HEALTH_LABELS[project.health] ?? project.health}</span></td>
              <td><button type="button" className="sp-text-button" onClick={() => setSelectedId(project.id)}>{project.next_action ?? 'Abrir proyecto'}</button></td>
            </tr>)}</tbody>
          </table>
        </div>

        {selected && <article className="sp-project" id="project-detail">
          <header className="sp-project-hero">
            <div><p className="sp-section-number">{selected.folio} / {PROJECT_STATUS_LABELS[selected.status]}</p><h2>{selected.customer_name}</h2><p>{selected.next_action ?? 'Define la siguiente acción del proyecto.'}</p></div>
            <div className="sp-project-score"><strong>{integrity}%</strong><span>expediente requerido completo</span>{isAdmin && <button type="button" className="sp-text-button" onClick={beginOperationsUpdate}>Actualizar control</button>}</div>
          </header>

          {message && <p className="sp-inline-notice">{message}</p>}
          {selected.blocked_reason && <p className="sp-inline-notice sp-inline-notice--warning"><strong>Bloqueo:</strong> {selected.blocked_reason}</p>}

          {operationsForm && <form className="sp-operations-form" onSubmit={updateOperations}>
            <div className="sp-subhead"><h2>Control operativo</h2><button type="button" onClick={() => setOperationsForm(null)}>Cancelar</button></div>
            <div className="sp-form-grid">
              <label className="sp-field"><span>Etapa</span><select value={operationsForm.status} onChange={(event) => setOperationsForm({ ...operationsForm, status: event.target.value })}>{Object.entries(PROJECT_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
              <label className="sp-field"><span>Salud</span><select value={operationsForm.health} onChange={(event) => setOperationsForm({ ...operationsForm, health: event.target.value })}>{Object.entries(PROJECT_HEALTH_LABELS).map(([health, label]) => <option key={health} value={health}>{label}</option>)}</select></label>
              <label className="sp-field sp-field--wide"><span>Próxima acción</span><input value={operationsForm.nextAction} onChange={(event) => setOperationsForm({ ...operationsForm, nextAction: event.target.value })} placeholder="Acción concreta, responsable y resultado esperado" /></label>
              {operationsForm.health === 'blocked' && <label className="sp-field sp-field--wide"><span>Motivo del bloqueo</span><input required value={operationsForm.blockedReason} onChange={(event) => setOperationsForm({ ...operationsForm, blockedReason: event.target.value })} /></label>}
              <label className="sp-field"><span>Folio CFE</span><input value={operationsForm.cfeFolio} onChange={(event) => setOperationsForm({ ...operationsForm, cfeFolio: event.target.value })} placeholder="Pendiente de ingreso" /></label>
              <label className="sp-field"><span>Visita técnica</span><input type="datetime-local" value={operationsForm.siteSurveyAt} onChange={(event) => setOperationsForm({ ...operationsForm, siteSurveyAt: event.target.value })} /></label>
              <label className="sp-field"><span>Instalación objetivo</span><input type="datetime-local" value={operationsForm.installationAt} onChange={(event) => setOperationsForm({ ...operationsForm, installationAt: event.target.value })} /></label>
            </div>
            <button className="sp-button sp-button--primary" disabled={busyId === 'operations'}>{busyId === 'operations' ? 'Guardando…' : 'Guardar control operativo'}</button>
          </form>}

          <div className="sp-project-facts">
            <div><span>Inversión acordada</span><strong>{money.format(Number(selected.agreed_total_mxn))}</strong></div>
            <div><span>Base antes de IVA</span><strong>{money.format(Number(selected.amount_before_vat_mxn))}</strong></div>
            <div><span>Comisión</span><strong>{commission ? `${number.format(Number(commission.rate_percent))}% · ${money.format(Number(commission.payable_amount_mxn))}` : 'Sin vendedor'}</strong><small>{commission?.requires_review ? 'Requiere revisión administrativa' : commission?.status}</small></div>
            <div><span>Folio CFE</span><strong>{selected.cfe_tracking_folio ?? 'Pendiente'}</strong></div>
          </div>

          <section className="sp-technical-control">
            <header className="sp-technical-header">
              <div><p className="sp-section-number">PUERTA TÉCNICA / CFE</p><h2>Del techo al plano aprobado.</h2></div>
              <span className={`sp-readiness ${readyForCfe ? 'is-ready' : ''}`}>{readyForCfe ? 'Expediente habilitado' : 'Avance protegido'}</span>
            </header>

            <div className="sp-gate-strip" aria-label="Condiciones para presentar a CFE">
              <div className={surveyApproved ? 'is-complete' : ''}><span>01</span><strong>Visita aprobada</strong><small>{surveyApproved ? 'Condiciones verificadas' : 'Falta aprobación'}</small></div>
              <div className={engineeringApproved ? 'is-complete' : ''}><span>02</span><strong>Ingeniería aprobada</strong><small>{engineeringApproved ? 'Diseño ejecutable' : 'Falta diseño aprobado'}</small></div>
              <div className={!missingCfeDocuments.length ? 'is-complete' : ''}><span>03</span><strong>Documentos base</strong><small>{missingCfeDocuments.length ? `${missingCfeDocuments.length} pendiente${missingCfeDocuments.length === 1 ? '' : 's'}` : 'Completos'}</small></div>
            </div>

            <div className="sp-technical-tracks">
              <article>
                <div className="sp-track-heading"><div><span>LEVANTAMIENTO</span><h3>Condiciones reales del sitio</h3></div><b className={`sp-tech-status sp-tech-status--${latestSurvey?.status ?? 'draft'}`}>{latestSurvey ? `v${latestSurvey.version} · ${TECHNICAL_STATUS_LABELS[latestSurvey.status]}` : 'Sin captura'}</b></div>
                {latestSurvey ? <dl className="sp-tech-summary">
                  <div><dt>Techo</dt><dd>{ROOF_TYPE_LABELS[latestSurvey.roof_type] ?? 'Por confirmar'} · {latestSurvey.usable_area_m2 ? `${number.format(Number(latestSurvey.usable_area_m2))} m² útiles` : 'área pendiente'}</dd></div>
                  <div><dt>Servicio</dt><dd>{latestSurvey.service_voltage ? `${latestSurvey.service_voltage} V · ${number.format(Number(latestSurvey.main_breaker_amps))} A` : 'Por confirmar'}</dd></div>
                  <div><dt>Ruta</dt><dd>{latestSurvey.route_length_m != null ? `${number.format(Number(latestSurvey.route_length_m))} m` : 'Por confirmar'}</dd></div>
                </dl> : <p className="sp-track-empty">Registra techo, sombras, tablero, acometida, ruta y condiciones de seguridad durante la visita.</p>}
                {latestSurvey?.rejection_reason && <p className="sp-review-note"><strong>Corrección:</strong> {latestSurvey.rejection_reason}</p>}
                <div className="sp-track-actions">
                  {permissions.survey && latestSurvey?.status !== 'submitted' && <button type="button" onClick={beginSurvey}>{latestSurvey ? 'Abrir levantamiento' : 'Capturar visita'}</button>}
                  {isAdmin && latestSurvey?.status === 'submitted' && <><button type="button" onClick={() => reviewSurvey(latestSurvey, 'approved')} disabled={busyId === latestSurvey.id}>Aprobar</button><button type="button" onClick={() => reviewSurvey(latestSurvey, 'rejected')} disabled={busyId === latestSurvey.id}>Solicitar corrección</button></>}
                </div>
              </article>

              <article>
                <div className="sp-track-heading"><div><span>INGENIERÍA</span><h3>Diseño listo para ejecutar</h3></div><b className={`sp-tech-status sp-tech-status--${latestEngineering?.status ?? 'draft'}`}>{latestEngineering ? `v${latestEngineering.version} · ${TECHNICAL_STATUS_LABELS[latestEngineering.status]}` : 'Sin diseño'}</b></div>
                {latestEngineering ? <dl className="sp-tech-summary">
                  <div><dt>Sistema</dt><dd>{latestEngineering.panel_count ?? '—'} paneles · {latestEngineering.system_dc_kw ?? '—'} kWp</dd></div>
                  <div><dt>Inversor</dt><dd>{latestEngineering.inverter_quantity ?? '—'} × {latestEngineering.inverter_model ?? 'Por confirmar'}</dd></div>
                  <div><dt>Relación DC/AC</dt><dd>{latestEngineering.dc_ac_ratio_percent ? `${number.format(Number(latestEngineering.dc_ac_ratio_percent))}%` : 'Por confirmar'} · máximo 120%</dd></div>
                </dl> : <p className="sp-track-empty">Documenta módulos, inversor, strings, protecciones, conductores, tierra física y vincula el unifilar aprobado.</p>}
                {latestEngineering?.rejection_reason && <p className="sp-review-note"><strong>Corrección:</strong> {latestEngineering.rejection_reason}</p>}
                <div className="sp-track-actions">
                  {permissions.engineering && latestEngineering?.status !== 'submitted' && <button type="button" onClick={beginEngineering}>{latestEngineering ? 'Abrir ingeniería' : 'Preparar diseño'}</button>}
                  {isAdmin && latestEngineering?.status === 'submitted' && <><button type="button" onClick={() => reviewEngineering(latestEngineering, 'approved')} disabled={busyId === latestEngineering.id}>Aprobar</button><button type="button" onClick={() => reviewEngineering(latestEngineering, 'rejected')} disabled={busyId === latestEngineering.id}>Solicitar corrección</button></>}
                </div>
              </article>
            </div>

            {permissions.survey && surveyForm && <form className="sp-technical-form" onSubmit={saveSurvey}>
              <div className="sp-subhead"><div><p className="sp-section-number">FORMATO DE CAMPO</p><h2>Levantamiento técnico</h2></div><button type="button" onClick={() => setSurveyForm(null)}>Cerrar</button></div>
              <p className="sp-form-guidance">Puedes guardar un borrador desde el sitio. Para enviarlo a revisión deben quedar completos los datos esenciales eléctricos y de montaje.</p>
              <div className="sp-form-grid sp-form-grid--technical">
                <label className="sp-field"><span>Fecha y hora de visita</span><input type="datetime-local" value={surveyForm.visitedAt} onChange={(event) => setSurveyForm({ ...surveyForm, visitedAt: event.target.value })} /></label>
                <label className="sp-field"><span>Técnico responsable</span><select value={surveyForm.technicianUserId} onChange={(event) => setSurveyForm({ ...surveyForm, technicianUserId: event.target.value })}>{data.profiles.filter((item) => item.active).map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name}</option>)}</select></label>
                <label className="sp-field"><span>Tipo de techo</span><select value={surveyForm.roofType} onChange={(event) => setSurveyForm({ ...surveyForm, roofType: event.target.value })}>{Object.entries(ROOF_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="sp-field"><span>Estado del techo</span><select value={surveyForm.roofCondition} onChange={(event) => setSurveyForm({ ...surveyForm, roofCondition: event.target.value })}><option value="">Seleccionar</option><option value="good">Bueno</option><option value="fair">Requiere atención</option><option value="poor">No apto sin corrección</option></select></label>
                <label className="sp-field"><span>Área útil m²</span><input type="number" min="0" step="0.01" inputMode="decimal" value={surveyForm.usableAreaM2} onChange={(event) => setSurveyForm({ ...surveyForm, usableAreaM2: event.target.value })} /></label>
                <label className="sp-field"><span>Nivel de sombras</span><select value={surveyForm.shadingLevel} onChange={(event) => setSurveyForm({ ...surveyForm, shadingLevel: event.target.value })}><option value="">Seleccionar</option><option value="none">Sin sombras</option><option value="low">Bajas</option><option value="moderate">Moderadas</option><option value="high">Altas</option></select></label>
                <label className="sp-field"><span>Orientación °</span><input type="number" min="0" max="360" step="1" inputMode="numeric" value={surveyForm.orientationDegrees} onChange={(event) => setSurveyForm({ ...surveyForm, orientationDegrees: event.target.value })} placeholder="Ej. 180" /></label>
                <label className="sp-field"><span>Inclinación °</span><input type="number" min="0" max="90" step="1" inputMode="numeric" value={surveyForm.tiltDegrees} onChange={(event) => setSurveyForm({ ...surveyForm, tiltDegrees: event.target.value })} /></label>
                <label className="sp-field"><span>Tipo de servicio</span><select value={surveyForm.electricalService} onChange={(event) => setSurveyForm({ ...surveyForm, electricalService: event.target.value })}><option value="">Seleccionar</option><option value="single_phase">Monofásico</option><option value="two_phase">Bifásico</option><option value="three_phase">Trifásico</option></select></label>
                <label className="sp-field"><span>Voltaje de servicio</span><input type="number" min="90" max="600" inputMode="numeric" value={surveyForm.serviceVoltage} onChange={(event) => setSurveyForm({ ...surveyForm, serviceVoltage: event.target.value })} placeholder="127, 220…" /></label>
                <label className="sp-field"><span>Interruptor principal A</span><input type="number" min="1" step="1" inputMode="numeric" value={surveyForm.mainBreakerAmps} onChange={(event) => setSurveyForm({ ...surveyForm, mainBreakerAmps: event.target.value })} /></label>
                <label className="sp-field"><span>Estado del tablero</span><select value={surveyForm.panelboardCondition} onChange={(event) => setSurveyForm({ ...surveyForm, panelboardCondition: event.target.value })}><option value="">Seleccionar</option><option value="good">Apto</option><option value="requires_adjustment">Requiere adecuación</option><option value="requires_replacement">Requiere reemplazo</option></select></label>
                <label className="sp-field"><span>Tierra física disponible</span><select value={surveyForm.groundingAvailable} onChange={(event) => setSurveyForm({ ...surveyForm, groundingAvailable: event.target.value })}><option value="">Verificar</option><option value="true">Sí</option><option value="false">No</option></select></label>
                <label className="sp-field"><span>Medidor accesible</span><select value={surveyForm.meterAccessible} onChange={(event) => setSurveyForm({ ...surveyForm, meterAccessible: event.target.value })}><option value="">Verificar</option><option value="true">Sí</option><option value="false">No</option></select></label>
                <label className="sp-field"><span>Ruta eléctrica m</span><input type="number" min="0" step="0.1" inputMode="decimal" value={surveyForm.routeLengthM} onChange={(event) => setSurveyForm({ ...surveyForm, routeLengthM: event.target.value })} /></label>
                <label className="sp-field"><span>Latitud</span><input type="number" min="-90" max="90" step="0.000001" inputMode="decimal" value={surveyForm.latitude} onChange={(event) => setSurveyForm({ ...surveyForm, latitude: event.target.value })} /></label>
                <label className="sp-field"><span>Longitud</span><input type="number" min="-180" max="180" step="0.000001" inputMode="decimal" value={surveyForm.longitude} onChange={(event) => setSurveyForm({ ...surveyForm, longitude: event.target.value })} /></label>
                <label className="sp-field sp-field--wide"><span>Observaciones estructurales</span><textarea rows="2" value={surveyForm.structureNotes} onChange={(event) => setSurveyForm({ ...surveyForm, structureNotes: event.target.value })} placeholder="Fisuras, impermeabilización, obstáculos, sistema de anclaje…" /></label>
                <label className="sp-field sp-field--wide"><span>Observaciones eléctricas</span><textarea rows="2" value={surveyForm.electricalNotes} onChange={(event) => setSurveyForm({ ...surveyForm, electricalNotes: event.target.value })} placeholder="Tablero, acometida, canalización, espacios disponibles…" /></label>
                <label className="sp-field sp-field--wide"><span>Riesgos y seguridad</span><textarea rows="2" value={surveyForm.safetyNotes} onChange={(event) => setSurveyForm({ ...surveyForm, safetyNotes: event.target.value })} placeholder="Acceso, trabajo en altura, líneas cercanas y equipo requerido…" /></label>
              </div>
              <div className="sp-form-actions"><button className="sp-button sp-button--secondary" name="intent" value="draft" disabled={busyId === 'site-survey'}>Guardar borrador</button><button className="sp-button sp-button--primary" name="intent" value="submit" disabled={busyId === 'site-survey'}>Enviar a revisión</button></div>
            </form>}

            {permissions.engineering && engineeringForm && <form className="sp-technical-form" onSubmit={saveEngineering}>
              <div className="sp-subhead"><div><p className="sp-section-number">CONTROL DE DISEÑO</p><h2>Revisión de ingeniería</h2></div><button type="button" onClick={() => setEngineeringForm(null)}>Cerrar</button></div>
              <p className="sp-form-guidance">La relación DC/AC se calcula automáticamente. Para enviar a revisión debe existir una versión aprobada del diagrama unifilar.</p>
              <div className="sp-engineering-ratio"><span>Relación DC/AC</span><strong className={engineeringRatio > 120 ? 'is-over' : ''}>{engineeringRatio ? `${number.format(engineeringRatio)}%` : '—'}</strong><small>{engineeringRatio > 120 ? 'Supera el máximo permitido de 120%' : 'Límite de sobredimensionamiento: 120%'}</small></div>
              <div className="sp-form-grid sp-form-grid--technical">
                <label className="sp-field"><span>Cantidad de paneles</span><input type="number" min="1" inputMode="numeric" value={engineeringForm.panelCount} onChange={(event) => setEngineeringForm({ ...engineeringForm, panelCount: event.target.value })} /></label>
                <label className="sp-field"><span>Modelo de panel</span><input value={engineeringForm.moduleModel} onChange={(event) => setEngineeringForm({ ...engineeringForm, moduleModel: event.target.value })} /></label>
                <label className="sp-field"><span>Potencia DC kWp</span><input type="number" min="0.001" step="0.001" inputMode="decimal" value={engineeringForm.systemDcKw} onChange={(event) => setEngineeringForm({ ...engineeringForm, systemDcKw: event.target.value })} /></label>
                <label className="sp-field"><span>Potencia AC del inversor kW</span><input type="number" min="0.001" step="0.001" inputMode="decimal" value={engineeringForm.inverterAcKw} onChange={(event) => setEngineeringForm({ ...engineeringForm, inverterAcKw: event.target.value })} /></label>
                <label className="sp-field"><span>Modelo de inversor</span><input value={engineeringForm.inverterModel} onChange={(event) => setEngineeringForm({ ...engineeringForm, inverterModel: event.target.value })} /></label>
                <label className="sp-field"><span>Cantidad de inversores</span><input type="number" min="1" inputMode="numeric" value={engineeringForm.inverterQuantity} onChange={(event) => setEngineeringForm({ ...engineeringForm, inverterQuantity: event.target.value })} /></label>
                <label className="sp-field sp-field--wide"><span>Configuración de strings</span><input value={engineeringForm.stringConfiguration} onChange={(event) => setEngineeringForm({ ...engineeringForm, stringConfiguration: event.target.value })} placeholder="Ej. 2 strings de 8 módulos" /></label>
                <label className="sp-field sp-field--wide"><span>Asignación MPPT</span><input value={engineeringForm.mpptConfiguration} onChange={(event) => setEngineeringForm({ ...engineeringForm, mpptConfiguration: event.target.value })} placeholder="Ej. MPPT 1: S1 · MPPT 2: S2" /></label>
                <label className="sp-field"><span>Protección DC</span><input value={engineeringForm.dcProtection} onChange={(event) => setEngineeringForm({ ...engineeringForm, dcProtection: event.target.value })} /></label>
                <label className="sp-field"><span>Protección AC</span><input value={engineeringForm.acProtection} onChange={(event) => setEngineeringForm({ ...engineeringForm, acProtection: event.target.value })} /></label>
                <label className="sp-field sp-field--wide"><span>Conductores y canalización</span><input value={engineeringForm.conductorSpecification} onChange={(event) => setEngineeringForm({ ...engineeringForm, conductorSpecification: event.target.value })} /></label>
                <label className="sp-field sp-field--wide"><span>Diseño de puesta a tierra</span><input value={engineeringForm.groundingDesign} onChange={(event) => setEngineeringForm({ ...engineeringForm, groundingDesign: event.target.value })} /></label>
                <label className="sp-field sp-field--wide"><span>Notas de diseño</span><textarea rows="3" value={engineeringForm.designNotes} onChange={(event) => setEngineeringForm({ ...engineeringForm, designNotes: event.target.value })} /></label>
              </div>
              <div className="sp-form-actions"><button className="sp-button sp-button--secondary" name="intent" value="draft" disabled={busyId === 'engineering'}>Guardar borrador</button><button className="sp-button sp-button--primary" name="intent" value="submit" disabled={busyId === 'engineering' || engineeringRatio > 120}>Enviar a revisión</button></div>
            </form>}

            <section className="sp-project-resources">
              <header>
                <div><p className="sp-section-number">RECURSOS / EXPORTACIÓN</p><h2>La carpeta lista para trabajar.</h2></div>
                <p>{projectFiles.length} archivo{projectFiles.length === 1 ? '' : 's'} · {formatBytes(projectFileBytes)} en almacenamiento privado</p>
              </header>
              <div className="sp-resource-ledger">
                <button type="button" onClick={() => generateProjectResource('survey')} disabled={!latestSurvey || Boolean(busyId)}><span>01</span><strong>Reporte de levantamiento</strong><small>{latestSurvey ? `Genera la versión ${latestSurvey.version} con datos de campo y firmas.` : 'Disponible después de capturar la visita.'}</small></button>
                <button type="button" onClick={() => generateProjectResource('authorization')} disabled={Boolean(busyId)}><span>02</span><strong>Carta de autorización</strong><small>Formato condicional precargado para gestión ante CFE.</small></button>
                <button type="button" onClick={() => generateProjectResource('index')} disabled={Boolean(busyId)}><span>03</span><strong>Índice del expediente</strong><small>Estados, versiones, origen y archivos anexos.</small></button>
                <button type="button" className="is-export" onClick={exportDossier} disabled={Boolean(busyId)}><span>04</span><strong>Exportar expediente ZIP</strong><small>Documentos, reportes, manifiesto y huellas SHA-256.</small></button>
              </div>
              {exportProgress && <div className="sp-export-progress" role="status" aria-live="polite"><div><strong>{exportProgress.label}</strong><span>{exportProgress.current} de {exportProgress.total}</span></div><i><b style={{ width: `${Math.min(100, exportProgress.current / Math.max(exportProgress.total, 1) * 100)}%` }} /></i></div>}
              <p className="sp-privacy-note"><strong>Expediente privado:</strong> el ZIP se arma en este dispositivo usando enlaces temporales. No genera una carpeta pública ni debe reenviarse por enlaces abiertos. La descarga queda registrada en la bitácora del proyecto.</p>
            </section>
          </section>

          <div className="sp-project-columns">
            <section>
              <div className="sp-subhead"><h2>Expediente</h2><span>{completedChecklist} de {requiredChecklist.length} requisitos</span></div>
              <div className="sp-progress" aria-label={`Expediente ${integrity}% completo`}><i style={{ width: `${integrity}%` }} /></div>
              <div className="sp-dossier">
                {Object.entries(DOCUMENT_STAGE_LABELS).map(([stage, label]) => {
                  const stageDocuments = documentsByStage[stage] ?? [];
                  if (!stageDocuments.length) return null;
                  return <div className="sp-dossier-stage" key={stage}>
                    <h3>{label}</h3>
                    {stageDocuments.map((document) => {
                      const files = document.solar_project_document_files ?? [];
                      const isConditional = document.solar_document_requirements?.requirement_scope === 'conditional';
                      return <div className="sp-document-row" key={document.id}>
                        <span className={`sp-document-state sp-document-state--${document.status}`} aria-hidden="true" />
                        <div className="sp-document-copy"><strong>{document.title}</strong><small>{isConditional ? 'Condicional' : document.solar_document_requirements?.requirement_scope === 'regulatory' ? 'Regulatorio' : 'Control CDSE'} · {document.status === 'approved' ? 'Aprobado' : document.status === 'uploaded' ? 'Por revisar' : document.status === 'rejected' ? `Corregir: ${document.rejection_reason}` : document.status === 'not_applicable' ? 'No aplica' : 'Pendiente'}</small>
                          {files.length > 0 && <div className="sp-file-list">{files.map((file) => <button type="button" key={file.id} onClick={() => openProjectFile(file)}>{file.original_name}</button>)}</div>}
                        </div>
                        <div className="sp-document-actions">
                          {permissions.documents && document.status !== 'not_applicable' && <label className="sp-upload-action">{uploadingId === document.id ? 'Subiendo…' : files.length ? 'Agregar archivo' : 'Subir archivo'}<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={Boolean(uploadingId)} onChange={(event) => { uploadDocument(document, event.target.files); event.target.value = ''; }} /></label>}
                          {isAdmin && document.status === 'uploaded' && <><button type="button" onClick={() => reviewDocument(document, 'approved')} disabled={busyId === document.id}>Aprobar</button><button type="button" onClick={() => reviewDocument(document, 'rejected')} disabled={busyId === document.id}>Rechazar</button></>}
                          {isAdmin && isConditional && <button type="button" onClick={() => setApplicability(document, document.status === 'not_applicable')} disabled={busyId === document.id}>{document.status === 'not_applicable' ? 'Requerir' : 'No aplica'}</button>}
                        </div>
                      </div>;
                    })}
                  </div>;
                })}
              </div>
            </section>

            <aside className="sp-project-agenda">
              <p className="sp-section-number">PRÓXIMAS ACCIONES</p>
              <div className="sp-subhead"><h2>Agenda del proyecto</h2>{permissions.tasks && <button type="button" onClick={() => setTaskForm(taskForm ? null : { title: '', type: 'follow_up', dueAt: '', assignedTo: selected.seller_user_id ?? profile.user_id, priority: 'normal', description: '' })}>{taskForm ? 'Cancelar' : '+ Agregar'}</button>}</div>
              {permissions.tasks && taskForm && <form className="sp-task-form" onSubmit={createTask}>
                <label className="sp-field"><span>Compromiso</span><input required value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} placeholder="Ej. Recibir identificación del titular" /></label>
                <div className="sp-form-grid">
                  <label className="sp-field"><span>Tipo</span><select value={taskForm.type} onChange={(event) => setTaskForm({ ...taskForm, type: event.target.value })}><option value="follow_up">Seguimiento</option><option value="site_survey">Visita técnica</option><option value="customer_document">Documento del cliente</option><option value="engineering_review">Revisión de ingeniería</option><option value="cfe_submission">Ingreso CFE</option><option value="cfe_follow_up">Seguimiento CFE</option><option value="installation">Instalación</option><option value="inspection">Inspección/pruebas</option><option value="meter_change">Cambio de medidor</option><option value="commissioning">Puesta en marcha</option><option value="collection">Cobro</option><option value="warranty">Garantía</option><option value="other">Otro</option></select></label>
                  <label className="sp-field"><span>Prioridad</span><select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
                  <label className="sp-field sp-field--wide"><span>Fecha y hora</span><input type="datetime-local" value={taskForm.dueAt} onChange={(event) => setTaskForm({ ...taskForm, dueAt: event.target.value })} /></label>
                  {isAdmin && <label className="sp-field sp-field--wide"><span>Responsable</span><select value={taskForm.assignedTo} onChange={(event) => setTaskForm({ ...taskForm, assignedTo: event.target.value })}>{data.profiles.filter((item) => item.active).map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name}</option>)}</select></label>}
                </div>
                <button className="sp-button sp-button--secondary" disabled={busyId === 'new-task'}>{busyId === 'new-task' ? 'Agregando…' : 'Agregar a agenda'}</button>
              </form>}
              {pendingTasks.length ? pendingTasks.map((task) => <div className="sp-task" key={task.id}>
                <div><strong>{task.title}</strong><small>{task.due_at ? new Date(task.due_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin vencimiento'} · {data.profileMap[task.assigned_to]?.full_name ?? 'Sin asignar'}</small></div>
                {permissions.tasks && (isAdmin || task.assigned_to === profile.user_id) && <button type="button" disabled={busyId === task.id} onClick={() => completeTask(task)}>{busyId === task.id ? '…' : 'Completar'}</button>}
              </div>) : <p className="sp-header-note">No hay tareas abiertas. El administrador puede programar la siguiente etapa.</p>}
            </aside>
          </div>
        </article>}
      </> : <EmptyState title="Aún no hay proyectos operativos" detail="Al marcar una cotización como Venta cerrada, el portal generará el proyecto, expediente, tareas iniciales y registro de comisión." />}
    </section>
  );
}

function Leads({ data, refresh }) {
  const [message, setMessage] = useState('');
  const sellers = data.profiles.filter((item) => item.role === 'seller' && item.active);

  async function assign(leadId, sellerId) {
    const { error } = await getSupabaseClient()
      .from('solar_leads')
      .update({ owner_user_id: sellerId || null })
      .eq('id', leadId);
    if (error) return setMessage(errorMessage(error));
    setMessage('Responsable actualizado.');
    await refresh();
  }

  return (
    <section className="sp-view">
      <header className="sp-view-header">
        <div><p className="sp-section-number">BANDEJA / LEADS</p><h1>Recibos que esperan seguimiento.</h1></div>
      </header>
      {message && <p className="sp-inline-notice">{message}</p>}
      {data.leads.length ? (
        <div className="sp-table-wrap sp-table-wrap--full">
          <table>
            <thead><tr><th>Prospecto</th><th>Origen</th><th>Recibo</th><th>Estado</th><th>Responsable</th></tr></thead>
            <tbody>
              {data.leads.map((lead) => {
                const receipt = data.receiptByLead[lead.id];
                return (
                  <tr key={lead.id}>
                    <td><strong>{lead.name}</strong><small>{lead.phone_e164}</small></td>
                    <td>{lead.source === 'seller_portal' ? 'Vendedor' : 'Landing'}<small>{new Date(lead.created_at).toLocaleString('es-MX')}</small></td>
                    <td>{receipt ? <><strong>{receipt.tariff_code}</strong><small>{receipt.customer_name ?? 'Titular por confirmar'}</small></> : 'Sin recibo'}</td>
                    <td><StatusPill status={lead.status === 'ganado' ? 'aceptada' : lead.status === 'perdido' ? 'rechazada' : 'preliminar'} /></td>
                    <td>
                      <select className="sp-status-select" value={lead.owner_user_id ?? ''} onChange={(event) => assign(lead.id, event.target.value)}>
                        <option value="">Sin asignar</option>
                        {sellers.map((seller) => <option value={seller.user_id} key={seller.user_id}>{seller.full_name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="La bandeja está vacía" detail="Los leads captados por la landing y por vendedores aparecerán aquí." />}
    </section>
  );
}

function Catalog({ data, refresh }) {
  const [tab, setTab] = useState('panels');
  const [message, setMessage] = useState('');
  const [moduleForm, setModuleForm] = useState({ sku: '', brand: '', model: '', watts: '590' });
  const [inverterForm, setInverterForm] = useState({ sku: '', brand: 'GROWATT', model: '', capacityKw: '', phases: '1', warrantyYears: '10' });
  const [priceForm, setPriceForm] = useState({ moduleId: data.modules[0]?.id ?? '', name: 'Precio instalado', price: '', min: '1' });
  const [promotionForm, setPromotionForm] = useState({ name: '', moduleId: '', type: 'percentage', value: '', min: '1' });
  const [packageForm, setPackageForm] = useState({ name: '', description: '', moduleId: data.modules[0]?.id ?? '', panelCount: '4', price: '' });
  const [financingForm, setFinancingForm] = useState({ name: '', description: '', minPanels: '1', pricePerPanel: '', downPayment: '50', installments: '12', interestRate: '0' });

  async function addModule(event) {
    event.preventDefault();
    const { error } = await getSupabaseClient().from('solar_modules').insert({
      sku: moduleForm.sku,
      brand: moduleForm.brand,
      model: moduleForm.model,
      watts: Number(moduleForm.watts),
      active: true,
    });
    setMessage(error ? errorMessage(error) : 'Panel agregado al catálogo.');
    if (!error) await refresh();
  }

  async function addPrice(event) {
    event.preventDefault();
    const { error } = await getSupabaseClient().from('solar_price_options').insert({
      module_id: priceForm.moduleId,
      name: priceForm.name,
      price_per_panel_mxn: Number(priceForm.price),
      min_panels: Number(priceForm.min),
      price_includes_vat: true,
      active: true,
    });
    setMessage(error ? errorMessage(error) : 'Tarifa publicada.');
    if (!error) await refresh();
  }

  async function addInverter(event) {
    event.preventDefault();
    const { error } = await getSupabaseClient().from('solar_inverters').insert({
      sku: inverterForm.sku,
      brand: inverterForm.brand,
      model: inverterForm.model,
      inverter_type: 'string',
      ac_capacity_kw: Number(inverterForm.capacityKw),
      phases: Number(inverterForm.phases),
      warranty_years: Number(inverterForm.warrantyYears),
      active: true,
    });
    setMessage(error ? errorMessage(error) : 'Inversor agregado al catálogo.');
    if (!error) await refresh();
  }

  async function addPromotion(event) {
    event.preventDefault();
    const { error } = await getSupabaseClient().from('solar_promotions').insert({
      name: promotionForm.name,
      module_id: promotionForm.moduleId || null,
      discount_type: promotionForm.type,
      discount_value: Number(promotionForm.value),
      min_panels: Number(promotionForm.min),
      active: true,
    });
    setMessage(error ? errorMessage(error) : 'Promoción publicada.');
    if (!error) await refresh();
  }

  async function addPackage(event) {
    event.preventDefault();
    const { error } = await getSupabaseClient().from('solar_packages').insert({
      name: packageForm.name,
      description: packageForm.description || null,
      module_id: packageForm.moduleId,
      panel_count: Number(packageForm.panelCount),
      price_mxn: Number(packageForm.price),
      price_includes_vat: true,
      active: true,
    });
    setMessage(error ? errorMessage(error) : 'Paquete publicado.');
    if (!error) await refresh();
  }

  async function addFinancing(event) {
    event.preventDefault();
    const { error } = await getSupabaseClient().from('solar_financing_options').insert({
      name: financingForm.name,
      description: financingForm.description || null,
      min_panels: Number(financingForm.minPanels),
      price_per_panel_mxn: financingForm.pricePerPanel ? Number(financingForm.pricePerPanel) : null,
      down_payment_percent: Number(financingForm.downPayment),
      installments: Number(financingForm.installments),
      interest_rate: Number(financingForm.interestRate),
      active: true,
    });
    setMessage(error ? errorMessage(error) : 'Financiamiento publicado.');
    if (!error) await refresh();
  }

  async function toggleActive(table, id, active) {
    const { error } = await getSupabaseClient().from(table).update({ active }).eq('id', id);
    setMessage(error ? errorMessage(error) : active ? 'Elemento activado.' : 'Elemento desactivado.');
    if (!error) await refresh();
  }

  return (
    <section className="sp-view">
      <header className="sp-view-header"><div><p className="sp-section-number">ADMINISTRACIÓN / CATÁLOGO</p><h1>Qué puede vender el equipo.</h1></div></header>
      <div className="sp-tabs" role="tablist">
        <button className={tab === 'panels' ? 'is-active' : ''} onClick={() => setTab('panels')}>Paneles</button>
        <button className={tab === 'inverters' ? 'is-active' : ''} onClick={() => setTab('inverters')}>Inversores</button>
        <button className={tab === 'prices' ? 'is-active' : ''} onClick={() => setTab('prices')}>Precios por panel</button>
        <button className={tab === 'promotions' ? 'is-active' : ''} onClick={() => setTab('promotions')}>Promociones</button>
        <button className={tab === 'packages' ? 'is-active' : ''} onClick={() => setTab('packages')}>Paquetes</button>
        <button className={tab === 'financing' ? 'is-active' : ''} onClick={() => setTab('financing')}>Financiamiento</button>
      </div>
      {message && <p className="sp-inline-notice">{message}</p>}
      <div className="sp-admin-grid">
        <div className="sp-catalog-list">
          {tab === 'inverters' && data.inverters.map((item) => <div className="sp-catalog-row" key={item.id}><div><strong>{item.brand} {item.model}</strong><span>{item.sku} · {item.phases} fase · {item.active ? 'Activo' : 'Desactivado'}</span></div><b>{number.format(item.ac_capacity_kw)} kW AC</b><button type="button" className="sp-text-button" onClick={() => toggleActive('solar_inverters', item.id, !item.active)}>{item.active ? 'Desactivar' : 'Activar'}</button></div>)}
          {tab === 'inverters' && <form className="sp-admin-form" onSubmit={addInverter}><h2>Agregar inversor</h2><label className="sp-field"><span>SKU</span><input value={inverterForm.sku} onChange={(e) => setInverterForm({ ...inverterForm, sku: e.target.value })} required /></label><label className="sp-field"><span>Marca</span><input value={inverterForm.brand} onChange={(e) => setInverterForm({ ...inverterForm, brand: e.target.value })} required /></label><label className="sp-field"><span>Modelo</span><input value={inverterForm.model} onChange={(e) => setInverterForm({ ...inverterForm, model: e.target.value })} required /></label><label className="sp-field"><span>Capacidad nominal AC</span><input type="number" min="0.1" step="0.1" value={inverterForm.capacityKw} onChange={(e) => setInverterForm({ ...inverterForm, capacityKw: e.target.value })} required /></label><label className="sp-field"><span>Fases</span><select value={inverterForm.phases} onChange={(e) => setInverterForm({ ...inverterForm, phases: e.target.value })}><option value="1">1 fase</option><option value="2">2 fases</option><option value="3">3 fases</option></select></label><label className="sp-field"><span>Garantía</span><input type="number" min="0" step="0.5" value={inverterForm.warrantyYears} onChange={(e) => setInverterForm({ ...inverterForm, warrantyYears: e.target.value })} /></label><button className="sp-button sp-button--primary">Guardar inversor</button></form>}
          {tab === 'panels' && data.modules.map((module) => <div className="sp-catalog-row" key={module.id}><div><strong>{module.brand} {module.model}</strong><span>{module.sku} · {module.active ? 'Activo' : 'Desactivado'}</span></div><b>{module.watts} W</b><button type="button" className="sp-text-button" onClick={() => toggleActive('solar_modules', module.id, !module.active)}>{module.active ? 'Desactivar' : 'Activar'}</button></div>)}
          {tab === 'prices' && data.prices.map((price) => <div className="sp-catalog-row" key={price.id}><div><strong>{price.name}</strong><span>{data.moduleMap[price.module_id]?.brand} {data.moduleMap[price.module_id]?.model} · {price.active ? 'Activo' : 'Desactivado'}</span></div><b>{money.format(price.price_per_panel_mxn)}</b><button type="button" className="sp-text-button" onClick={() => toggleActive('solar_price_options', price.id, !price.active)}>{price.active ? 'Desactivar' : 'Activar'}</button></div>)}
          {tab === 'promotions' && data.promotions.map((promotion) => <div className="sp-catalog-row" key={promotion.id}><div><strong>{promotion.name}</strong><span>Desde {promotion.min_panels} paneles · {promotion.active ? 'Activo' : 'Desactivado'}</span></div><b>{promotion.discount_type === 'percentage' ? `${promotion.discount_value}%` : money.format(promotion.discount_value)}</b><button type="button" className="sp-text-button" onClick={() => toggleActive('solar_promotions', promotion.id, !promotion.active)}>{promotion.active ? 'Desactivar' : 'Activar'}</button></div>)}
          {tab === 'packages' && data.packages.map((item) => <div className="sp-catalog-row" key={item.id}><div><strong>{item.name}</strong><span>{item.panel_count} × {data.moduleMap[item.module_id]?.watts} W · {item.active ? 'Activo' : 'Desactivado'}</span></div><b>{money.format(item.price_mxn)}</b><button type="button" className="sp-text-button" onClick={() => toggleActive('solar_packages', item.id, !item.active)}>{item.active ? 'Desactivar' : 'Activar'}</button></div>)}
          {tab === 'financing' && data.financingOptions.map((item) => <div className="sp-catalog-row" key={item.id}><div><strong>{item.name}</strong><span>Desde {item.min_panels} paneles · enganche {item.down_payment_percent}% · {item.installments} meses</span></div><b>{item.interest_rate}%</b><button type="button" className="sp-text-button" onClick={() => toggleActive('solar_financing_options', item.id, !item.active)}>{item.active ? 'Desactivar' : 'Activar'}</button></div>)}
        </div>
        {tab === 'panels' && <form className="sp-admin-form" onSubmit={addModule}><h2>Agregar panel</h2><label className="sp-field"><span>SKU</span><input value={moduleForm.sku} onChange={(e) => setModuleForm({ ...moduleForm, sku: e.target.value })} required /></label><label className="sp-field"><span>Marca</span><input value={moduleForm.brand} onChange={(e) => setModuleForm({ ...moduleForm, brand: e.target.value })} required /></label><label className="sp-field"><span>Modelo</span><input value={moduleForm.model} onChange={(e) => setModuleForm({ ...moduleForm, model: e.target.value })} required /></label><label className="sp-field"><span>Potencia W</span><input type="number" value={moduleForm.watts} onChange={(e) => setModuleForm({ ...moduleForm, watts: e.target.value })} required /></label><button className="sp-button sp-button--primary">Guardar panel</button></form>}
        {tab === 'prices' && <form className="sp-admin-form" onSubmit={addPrice}><h2>Publicar tarifa</h2><label className="sp-field"><span>Panel</span><select value={priceForm.moduleId} onChange={(e) => setPriceForm({ ...priceForm, moduleId: e.target.value })}>{data.modules.map((module) => <option value={module.id} key={module.id}>{module.brand} {module.model} · {module.watts} W</option>)}</select></label><label className="sp-field"><span>Nombre</span><input value={priceForm.name} onChange={(e) => setPriceForm({ ...priceForm, name: e.target.value })} /></label><label className="sp-field"><span>Precio instalado por panel</span><input type="number" min="1" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })} required /></label><label className="sp-field"><span>Mínimo de paneles</span><input type="number" min="1" value={priceForm.min} onChange={(e) => setPriceForm({ ...priceForm, min: e.target.value })} /></label><button className="sp-button sp-button--primary">Publicar precio</button></form>}
        {tab === 'promotions' && <form className="sp-admin-form" onSubmit={addPromotion}><h2>Nueva promoción</h2><label className="sp-field"><span>Nombre</span><input value={promotionForm.name} onChange={(e) => setPromotionForm({ ...promotionForm, name: e.target.value })} required /></label><label className="sp-field"><span>Panel opcional</span><select value={promotionForm.moduleId} onChange={(e) => setPromotionForm({ ...promotionForm, moduleId: e.target.value })}><option value="">Todos</option>{data.modules.map((module) => <option value={module.id} key={module.id}>{module.brand} {module.model}</option>)}</select></label><label className="sp-field"><span>Tipo de descuento</span><select value={promotionForm.type} onChange={(e) => setPromotionForm({ ...promotionForm, type: e.target.value })}><option value="percentage">Porcentaje</option><option value="fixed">Importe fijo</option><option value="per_panel">Por panel</option></select></label><label className="sp-field"><span>Valor</span><input type="number" min="0.01" step="0.01" value={promotionForm.value} onChange={(e) => setPromotionForm({ ...promotionForm, value: e.target.value })} required /></label><label className="sp-field"><span>Mínimo de paneles</span><input type="number" min="1" value={promotionForm.min} onChange={(e) => setPromotionForm({ ...promotionForm, min: e.target.value })} /></label><button className="sp-button sp-button--primary">Publicar promoción</button></form>}
        {tab === 'packages' && <form className="sp-admin-form" onSubmit={addPackage}><h2>Nuevo paquete</h2><label className="sp-field"><span>Nombre</span><input value={packageForm.name} onChange={(e) => setPackageForm({ ...packageForm, name: e.target.value })} required /></label><label className="sp-field"><span>Descripción</span><input value={packageForm.description} onChange={(e) => setPackageForm({ ...packageForm, description: e.target.value })} /></label><label className="sp-field"><span>Panel</span><select value={packageForm.moduleId} onChange={(e) => setPackageForm({ ...packageForm, moduleId: e.target.value })}>{data.modules.map((module) => <option value={module.id} key={module.id}>{module.brand} {module.model} · {module.watts} W</option>)}</select></label><label className="sp-field"><span>Cantidad de paneles</span><input type="number" min="1" value={packageForm.panelCount} onChange={(e) => setPackageForm({ ...packageForm, panelCount: e.target.value })} required /></label><label className="sp-field"><span>Precio instalado</span><input type="number" min="1" value={packageForm.price} onChange={(e) => setPackageForm({ ...packageForm, price: e.target.value })} required /></label><button className="sp-button sp-button--primary">Publicar paquete</button></form>}
        {tab === 'financing' && <form className="sp-admin-form" onSubmit={addFinancing}><h2>Nuevo financiamiento</h2><label className="sp-field"><span>Nombre</span><input value={financingForm.name} onChange={(e) => setFinancingForm({ ...financingForm, name: e.target.value })} required /></label><label className="sp-field"><span>Descripción</span><input value={financingForm.description} onChange={(e) => setFinancingForm({ ...financingForm, description: e.target.value })} /></label><label className="sp-field"><span>Aplicar desde paneles</span><input type="number" min="1" value={financingForm.minPanels} onChange={(e) => setFinancingForm({ ...financingForm, minPanels: e.target.value })} required /></label><label className="sp-field"><span>Enganche</span><input type="number" min="0" max="100" step="0.1" value={financingForm.downPayment} onChange={(e) => setFinancingForm({ ...financingForm, downPayment: e.target.value })} required /></label><label className="sp-field"><span>Mensualidades</span><input type="number" min="1" value={financingForm.installments} onChange={(e) => setFinancingForm({ ...financingForm, installments: e.target.value })} required /></label><label className="sp-field"><span>Interés anual</span><input type="number" min="0" max="100" step="0.1" value={financingForm.interestRate} onChange={(e) => setFinancingForm({ ...financingForm, interestRate: e.target.value })} required /></label><button className="sp-button sp-button--primary">Publicar financiamiento</button></form>}
      </div>
    </section>
  );
}

function SellerTeamLegacy({ data, session, refresh }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', commissionRate: '5' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function createSeller(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const response = await fetch(`${getSupabaseFunctionsUrl()}/manage-solar-seller`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'create', ...form }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(body.message ?? 'No se pudo crear el vendedor.');
    setMessage('Vendedor creado. Comparte la contraseña temporal por un canal seguro.');
    setForm({ fullName: '', email: '', password: '', commissionRate: '5' });
    await refresh();
  }

  async function toggleSeller(seller) {
    const response = await fetch(`${getSupabaseFunctionsUrl()}/manage-solar-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'update', userId: seller.user_id, active: !seller.active }),
    });
    if (response.ok) await refresh();
  }

  return (
    <section className="sp-view">
      <header className="sp-view-header"><div><p className="sp-section-number">ADMINISTRACIÓN / EQUIPO</p><h1>Vendedores y comisiones.</h1></div></header>
      <div className="sp-admin-grid">
        <div className="sp-catalog-list">
          {data.profiles.filter((item) => item.role === 'seller').map((seller) => (
            <div className="sp-seller-row" key={seller.user_id}>
              <div><span className={`sp-presence ${seller.active ? 'is-active' : ''}`}></span><div><strong>{seller.full_name}</strong><small>{seller.active ? 'Acceso activo' : 'Acceso suspendido'}</small></div></div>
              <b>{number.format(seller.commission_rate)}%</b>
              <button onClick={() => toggleSeller(seller)}>{seller.active ? 'Suspender' : 'Activar'}</button>
            </div>
          ))}
          {!data.profiles.some((item) => item.role === 'seller') && <EmptyState title="Aún no hay vendedores" detail="Crea la primera cuenta y define su porcentaje de comisión." />}
        </div>
        <form className="sp-admin-form" onSubmit={createSeller}>
          <h2>Dar de alta vendedor</h2>
          <label className="sp-field"><span>Nombre completo</span><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
          <label className="sp-field"><span>Correo de acceso</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          <label className="sp-field"><span>Contraseña temporal</span><input type="password" minLength="10" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
          <label className="sp-field"><span>Comisión sobre base antes de IVA</span><div className="sp-input-suffix"><input type="number" min="5" max="10" step="0.1" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} /><span>%</span></div><small>Política normal CDSE: de 5% a 10% máximo.</small></label>
          {message && <p className={message.startsWith('Vendedor') ? 'sp-inline-notice' : 'sp-form-error'}>{message}</p>}
          <button className="sp-button sp-button--primary" disabled={busy}>{busy ? 'Creando acceso…' : 'Crear vendedor'}</button>
        </form>
      </div>
    </section>
  );
}

function Team({ data, session, refresh }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'seller', commissionRate: '5' });
  const assignable = data.profiles.filter((item) => item.role !== 'admin' && item.active);
  const [assignment, setAssignment] = useState({ userId: '', projectId: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function createStaff(event) {
    event.preventDefault();
    setBusy(true); setMessage('');
    const response = await fetch(`${getSupabaseFunctionsUrl()}/manage-solar-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'create', ...form }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(body.message ?? 'No se pudo crear el acceso.');
    setMessage('Acceso creado. Comparte la contraseña temporal por un canal seguro.');
    setForm({ fullName: '', email: '', password: '', role: 'seller', commissionRate: '5' });
    await refresh();
  }

  async function toggleStaff(member) {
    setBusy(true); setMessage('');
    const response = await fetch(`${getSupabaseFunctionsUrl()}/manage-solar-seller`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'update', userId: member.user_id, active: !member.active }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(body.message ?? 'No se pudo cambiar el acceso.');
    setMessage(member.active ? 'Acceso suspendido para nuevos ingresos.' : 'Acceso restaurado.');
    await refresh();
  }

  async function assignProject(event) {
    event.preventDefault();
    if (!assignment.userId || !assignment.projectId) return;
    setBusy(true); setMessage('');
    const { error } = await getSupabaseClient().rpc('assign_solar_project_member', {
      p_project_id: assignment.projectId,
      p_user_id: assignment.userId,
    });
    setBusy(false);
    if (error) return setMessage(errorMessage(error));
    setMessage('Proyecto asignado con la función del integrante y registrado en auditoría.');
    await refresh();
  }

  async function unassignProject(member) {
    if (!window.confirm('¿Retirar este acceso al proyecto? El evento quedará en auditoría.')) return;
    setBusy(true); setMessage('');
    const { error } = await getSupabaseClient().rpc('unassign_solar_project_member', {
      p_project_id: member.project_id,
      p_user_id: member.user_id,
    });
    setBusy(false);
    if (error) return setMessage(errorMessage(error));
    setMessage('Acceso retirado; el historial se conserva.');
    await refresh();
  }

  return <section className="sp-view">
    <header className="sp-view-header"><div><p className="sp-section-number">ADMINISTRACIÓN / CONTROL DE ACCESO</p><h1>Equipo, funciones y proyectos.</h1></div><p className="sp-header-note">Cada integrante recibe sólo los módulos de su función y únicamente los expedientes que le asignes.</p></header>
    {message && <p className="sp-inline-notice" role="status">{message}</p>}
    <div className="sp-access-summary" aria-label="Resumen de accesos">
      <div><span>Integrantes activos</span><strong>{data.profiles.filter((item) => item.active).length}</strong></div>
      <div><span>Asignaciones activas</span><strong>{data.memberships.filter((item) => item.active).length}</strong></div>
      <div><span>Eventos auditados</span><strong>{data.accessEvents.length}</strong></div>
    </div>
    <div className="sp-admin-grid">
      <div className="sp-catalog-list">
        {data.profiles.map((member) => <div className="sp-seller-row sp-staff-row" key={member.user_id}>
          <div><span className={`sp-presence ${member.active ? 'is-active' : ''}`}></span><div><strong>{member.full_name}</strong><small>{roleLabel(member.role)} · {member.active ? 'Acceso activo' : 'Acceso suspendido'}</small></div></div>
          {member.role === 'seller' && <b>{number.format(member.commission_rate)}%</b>}
          {member.role !== 'admin' && <button type="button" disabled={busy} onClick={() => toggleStaff(member)}>{member.active ? 'Suspender' : 'Activar'}</button>}
        </div>)}
      </div>
      <form className="sp-admin-form" onSubmit={createStaff}>
        <h2>Dar de alta integrante</h2>
        <label className="sp-field"><span>Nombre completo</span><input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
        <label className="sp-field"><span>Correo de acceso</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
        <label className="sp-field"><span>Contraseña temporal</span><input type="password" minLength="10" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
        <label className="sp-field"><span>Función</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(STAFF_ROLES).filter(([role]) => role !== 'admin').map(([role, detail]) => <option value={role} key={role}>{detail.label}</option>)}</select><small>{STAFF_ROLES[form.role]?.description}</small></label>
        {form.role === 'seller' && <label className="sp-field"><span>Comisión sobre base antes de IVA</span><div className="sp-input-suffix"><input type="number" min="5" max="10" step="0.1" value={form.commissionRate} onChange={(event) => setForm({ ...form, commissionRate: event.target.value })} /><span>%</span></div><small>Política CDSE: de 5% a 10% máximo.</small></label>}
        <button className="sp-button sp-button--primary" disabled={busy}>{busy ? 'Creando acceso…' : 'Crear acceso'}</button>
      </form>
    </div>
    <section className="sp-access-section">
      <div className="sp-section-heading"><div><p className="sp-section-number">ACCESO POR EXPEDIENTE</p><h2>Asignaciones activas</h2></div><p>La función global define qué puede hacer; la asignación define en cuáles proyectos.</p></div>
      <form className="sp-assignment-form" onSubmit={assignProject}>
        <label className="sp-field"><span>Integrante</span><select value={assignment.userId} onChange={(event) => setAssignment({ ...assignment, userId: event.target.value })} required><option value="">Selecciona…</option>{assignable.map((item) => <option value={item.user_id} key={item.user_id}>{item.full_name} · {roleLabel(item.role)}</option>)}</select></label>
        <label className="sp-field"><span>Proyecto</span><select value={assignment.projectId} onChange={(event) => setAssignment({ ...assignment, projectId: event.target.value })} required><option value="">Selecciona…</option>{data.projects.map((item) => <option value={item.id} key={item.id}>{item.folio} · {item.customer_name}</option>)}</select></label>
        <button className="sp-button sp-button--primary" disabled={busy || !assignable.length || !data.projects.length}>Asignar proyecto</button>
      </form>
      <div className="sp-assignment-list">
        {data.memberships.filter((item) => item.active).map((item) => {
          const member = data.profileMap[item.user_id];
          const project = data.projects.find((projectItem) => projectItem.id === item.project_id);
          return <article key={item.id}><div><strong>{project?.folio ?? 'Proyecto'}</strong><span>{project?.customer_name ?? 'Expediente restringido'}</span></div><div><strong>{member?.full_name ?? 'Integrante'}</strong><span>{roleLabel(member?.role ?? item.project_role)}</span></div><button type="button" disabled={busy} onClick={() => unassignProject(item)}>Retirar</button></article>;
        })}
        {!data.memberships.some((item) => item.active) && <EmptyState title="Sin asignaciones manuales" detail="Ventas conserva sus propios proyectos; el resto del equipo requiere una asignación explícita." />}
      </div>
    </section>
  </section>;
}

export default function SolarPortal() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [view, setView] = useState('overview');
  const [openQuoteId, setOpenQuoteId] = useState(null);
  const [openProjectId, setOpenProjectId] = useState(null);
  const [openCfeCaseId, setOpenCfeCaseId] = useState(null);
  const [openInventorySerialId, setOpenInventorySerialId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState({
    quotes: [], projects: [], tasks: [], commissions: [], workOrders: [], crews: [], fieldWorkers: [], cfeCases: [], leads: [], receipts: [], modules: [], inverters: [], prices: [], promotions: [], packages: [], financingOptions: [], inventoryLocations: [], inventoryItems: [], inventoryAllocations: [], inventoryMovements: [], inventorySerials: [], inventorySerialEvents: [],
    zones: [], profiles: [], memberships: [], accessEvents: [], profileMap: {}, moduleMap: {}, receiptByLead: {},
  });

  async function load(currentSession = session) {
    if (!currentSession) return;
    const client = getSupabaseClient();
    setLoadError('');
    const { data: profileData, error: profileError } = await client
      .from('solar_profiles')
      .select('*')
      .eq('user_id', currentSession.user.id)
      .maybeSingle();
    if (profileError) {
      setLoadError(errorMessage(profileError));
      setChecking(false);
      return;
    }
    if (!profileData) {
      setNeedsBootstrap(true);
      setChecking(false);
      return;
    }
    setProfile(profileData);
    setNeedsBootstrap(false);

    const [quotes, projects, tasks, commissions, workOrders, crews, fieldWorkers, cfeCases, leads, receipts, modules, inverters, prices, promotions, packages, financingOptions, zones, profiles, memberships, accessEvents, inventoryLocations, inventoryItems, inventoryAllocations, inventoryMovements, inventorySerials, inventorySerialEvents] =
      await Promise.all([
        client.from('solar_quotes').select('*, solar_leads(name,phone_e164,municipality,email,postal_code), solar_modules(brand,model,watts), solar_inverters(brand,model,ac_capacity_kw,phases,warranty_years), solar_receipts(id,tariff_code,service_number,service_number_last4,solar_consumption_periods(sequence,period_start,period_end,covered_months,kwh,amount_mxn))').order('created_at', { ascending: false }),
        client.from('solar_projects').select('*, solar_quotes(folio,panel_count,total_mxn), solar_project_documents(*, solar_document_requirements(stage,requirement_scope,regulatory_reference), solar_project_document_files(*)), solar_project_checklist_items(*), solar_project_tasks(*), solar_payment_schedules(*), solar_payments(*), solar_payment_refunds(*), solar_project_cost_entries(*), solar_commissions(*, solar_commission_milestones(*), solar_commission_events(*)), solar_site_surveys(*), solar_engineering_revisions(*), solar_assets(*), solar_warranties(*), solar_service_cases(*, solar_service_case_events(*)), solar_generation_readings(*), solar_customer_feedback(*)').order('updated_at', { ascending: false }),
        client.from('solar_project_tasks').select('*, solar_projects(folio,customer_name,status,seller_user_id)').order('due_at', { ascending: true, nullsFirst: false }),
        client.from('solar_commissions').select('*').order('updated_at', { ascending: false }),
        client.from('solar_work_orders').select('*, solar_projects(folio,customer_name,status,seller_user_id), solar_crews(name,daily_capacity_panels), solar_work_order_checklist_items(*), solar_work_order_incidents(*)').order('scheduled_start', { ascending: true }),
        client.from('solar_crews').select('*, solar_crew_members(*, solar_field_workers(*))').order('name'),
        client.from('solar_field_workers').select('*').order('full_name'),
        client.from('solar_cfe_cases').select('*, solar_projects(folio,customer_name,status,seller_user_id), solar_cfe_observations(*)').order('submitted_at', { ascending: false, nullsFirst: false }),
        client.from('solar_leads').select('*').order('created_at', { ascending: false }),
        client.from('solar_receipts').select('id,lead_id,created_at,customer_name,tariff_code,service_number,seller_user_id').order('created_at', { ascending: false }),
        client.from('solar_modules').select('*').order('watts'),
        client.from('solar_inverters').select('*').order('ac_capacity_kw'),
        client.from('solar_price_options').select('*').order('created_at', { ascending: false }),
        client.from('solar_promotions').select('*').order('created_at', { ascending: false }),
        client.from('solar_packages').select('*').order('created_at', { ascending: false }),
        client.from('solar_financing_options').select('*').order('min_panels'),
        client.from('solar_zones').select('*').order('name'),
        client.from('solar_profiles').select('*').order('full_name'),
        client.from('solar_project_members').select('*').order('assigned_at', { ascending: false }),
        client.from('solar_access_events').select('*').order('created_at', { ascending: false }).limit(500),
        client.from('solar_inventory_locations').select('*').order('name'),
        client.from('solar_inventory_items').select('*, solar_inventory_balances(*)').order('name'),
        client.from('solar_inventory_allocations').select('*, solar_inventory_items(sku,name,category,unit), solar_inventory_locations(name), solar_projects(folio,customer_name,status,seller_user_id), solar_work_orders(folio,status)').order('created_at'),
        client.from('solar_inventory_movements').select('*, solar_inventory_items(sku,name,category,unit), solar_inventory_locations(name), solar_projects(folio,customer_name), solar_work_orders(folio)').order('created_at', { ascending: false }).limit(500),
        client.from('solar_inventory_serials').select('*, solar_inventory_items(sku,name,category), solar_inventory_locations(name), solar_projects(folio,customer_name), solar_work_orders(folio), solar_assets(asset_type,manufacturer,model)').order('updated_at', { ascending: false }),
        client.from('solar_inventory_serial_events').select('*').order('created_at', { ascending: false }).limit(1000),
      ]);
    const firstError = [quotes, projects, tasks, commissions, workOrders, crews, fieldWorkers, cfeCases, leads, receipts, modules, inverters, prices, promotions, packages, financingOptions, zones, profiles, memberships, accessEvents, inventoryLocations, inventoryItems, inventoryAllocations, inventoryMovements, inventorySerials, inventorySerialEvents]
      .find((result) => result.error)?.error;
    if (firstError) setLoadError(errorMessage(firstError));
    const profileRows = profiles.data ?? [profileData];
    const moduleRows = modules.data ?? [];
    setData({
      quotes: quotes.data ?? [],
      projects: projects.data ?? [],
      tasks: tasks.data ?? [],
      commissions: commissions.data ?? [],
      workOrders: workOrders.data ?? [],
      crews: crews.data ?? [],
      fieldWorkers: fieldWorkers.data ?? [],
      cfeCases: cfeCases.data ?? [],
      leads: leads.data ?? [],
      receipts: receipts.data ?? [],
      modules: moduleRows,
      inverters: inverters.data ?? [],
      prices: prices.data ?? [],
      promotions: promotions.data ?? [],
      packages: packages.data ?? [],
      financingOptions: financingOptions.data ?? [],
      inventoryLocations: inventoryLocations.data ?? [],
      inventoryItems: inventoryItems.data ?? [],
      inventoryAllocations: inventoryAllocations.data ?? [],
      inventoryMovements: inventoryMovements.data ?? [],
      inventorySerials: inventorySerials.data ?? [],
      inventorySerialEvents: inventorySerialEvents.data ?? [],
      zones: zones.data ?? [],
      profiles: profileRows,
      memberships: memberships.data ?? [],
      accessEvents: accessEvents.data ?? [],
      profileMap: Object.fromEntries(profileRows.map((item) => [item.user_id, item])),
      moduleMap: Object.fromEntries(moduleRows.map((item) => [item.id, item])),
      receiptByLead: Object.fromEntries((receipts.data ?? []).map((item) => [item.lead_id, item])),
    });
    setChecking(false);
  }

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setChecking(false);
      return;
    }
    const client = getSupabaseClient();
    client.auth.getSession().then(({ data: authData }) => {
      setSession(authData.session);
      if (authData.session) load(authData.session);
      else setChecking(false);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setChecking(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function logout() {
    await getSupabaseClient().auth.signOut();
    setSession(null);
    setProfile(null);
  }

  if (!hasSupabaseConfig()) return <SetupRequired />;
  if (checking) return <div className="sp-loading">Preparando mesa solar…</div>;
  if (!session) return <Login onSession={(next) => { setSession(next); setChecking(true); load(next); }} />;
  if (needsBootstrap) return <Bootstrap session={session} onReady={() => { setChecking(true); load(session); }} />;

  const isAdmin = profile?.role === 'admin';
  const role = profile?.role ?? 'viewer';
  const openQuote = (id) => {
    setOpenQuoteId(id);
    setView('quotes');
    window.setTimeout(() => document.getElementById('quote-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const openProject = (id) => {
    setOpenProjectId(id);
    setView('projects');
    window.setTimeout(() => document.getElementById('project-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const navigation = navigationForRole(role, [
    ['overview', 'Resumen'],
    ['new', 'Nueva cotización'],
    ['quotes', 'Oportunidades'],
    ['projects', 'Proyectos'],
    ['agenda', 'Agenda'],
    ['installations', 'Instalaciones'],
    ['inventory', 'Inventario'],
    ['cfe', 'Seguimiento CFE'],
    ['post-sales', 'Postventa'],
    ['finance', 'Finanzas'],
    ['leads', 'Leads y recibos'],
    ['catalog', 'Catálogo y precios'],
    ['team', 'Equipo y accesos'],
  ]);
  const activeView = canOpenModule(role, view) ? view : 'overview';
  const navigateFromSearch = (result) => {
    if (result.type === 'quote') return openQuote(result.id);
    if (result.type === 'project') return openProject(result.projectId ?? result.id);
    if (result.type === 'asset') {
      setOpenProjectId(result.projectId);
      setView('post-sales');
      return;
    }
    if (result.type === 'cfe') {
      setOpenCfeCaseId(result.id);
      setView('cfe');
      return;
    }
    if (result.type === 'serial') {
      setOpenInventorySerialId(result.id);
      setView('inventory');
      return;
    }
    setView(result.view);
  };

  return (
    <div className="sp-app">
      <aside className="sp-sidebar">
        <a className="sp-brand" href="/solar"><img src="/logo.jpg" alt="CDSE" /><span>Solar</span></a>
        <button type="button" className="sp-search-trigger" onClick={() => setSearchOpen(true)}><span>⌕</span><strong>Buscar</strong><kbd>Ctrl K</kbd></button>
        <nav className="sp-desktop-nav" aria-label="Portal solar">
          {navigation.map(([id, label], index) => (
            <button className={activeView === id ? 'is-active' : ''} onClick={() => setView(id)} key={id}>
              <span>{String(index + 1).padStart(2, '0')}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sp-user">
          <span>{profile.full_name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span>
          <div><strong>{profile.full_name}</strong><small>{roleLabel(role)}{role === 'seller' ? ` · ${number.format(profile.commission_rate)}%` : ''}</small></div>
          <button onClick={logout} aria-label="Cerrar sesión">↗</button>
        </div>
      </aside>
      <main className="sp-main">
        {loadError && <div className="sp-global-error" role="alert">{loadError}</div>}
        {activeView === 'overview' && <Overview data={data} profile={profile} setView={setView} onOpenQuote={openQuote} />}
        {activeView === 'new' && <QuoteForm data={data} session={session} onCreated={() => load(session)} onOpenQuote={openQuote} />}
        {activeView === 'quotes' && <Quotes data={data} refresh={() => load(session)} isAdmin={isAdmin} openQuoteId={openQuoteId} onOpenQuote={openQuote} />}
        {activeView === 'projects' && <Projects data={data} refresh={() => load(session)} isAdmin={isAdmin} profile={profile} openProjectId={openProjectId} />}
        {activeView === 'agenda' && <Agenda data={data} refresh={() => load(session)} isAdmin={isAdmin} profile={profile} onOpenProject={openProject} />}
        {activeView === 'installations' && <Installations data={data} refresh={() => load(session)} isAdmin={isAdmin} profile={profile} onOpenProject={openProject} />}
        {activeView === 'inventory' && <Suspense fallback={<div className="sp-loading sp-loading--module">Conciliando existencias y apartados…</div>}><Inventory data={data} refresh={() => load(session)} isAdmin={isAdmin} onOpenProject={openProject} openSerialId={openInventorySerialId} /></Suspense>}
        {activeView === 'cfe' && <CfeTracking data={data} refresh={() => load(session)} isAdmin={isAdmin} onOpenProject={openProject} openCaseId={openCfeCaseId} />}
        {activeView === 'post-sales' && <Suspense fallback={<div className="sp-loading sp-loading--module">Preparando continuidad del proyecto…</div>}><PostSales data={data} refresh={() => load(session)} isAdmin={isAdmin} onOpenProject={openProject} openProjectId={openProjectId} /></Suspense>}
        {activeView === 'finance' && <Finance data={data} refresh={() => load(session)} isAdmin={isAdmin} profile={profile} onOpenProject={openProject} />}
        {activeView === 'leads' && isAdmin && <Leads data={data} refresh={() => load(session)} />}
        {activeView === 'catalog' && isAdmin && <Catalog data={data} refresh={() => load(session)} />}
        {activeView === 'team' && isAdmin && <Team data={data} session={session} refresh={() => load(session)} />}
      </main>
      <PortalSearch data={data} navigation={navigation} open={searchOpen} setOpen={setSearchOpen} onNavigate={navigateFromSearch} />
      <MobilePortalNavigation navigation={navigation} activeView={activeView} onNavigate={setView} onSearch={() => setSearchOpen(true)} onLogout={logout} />
    </div>
  );
}

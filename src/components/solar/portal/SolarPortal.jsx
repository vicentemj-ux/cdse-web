import { useEffect, useMemo, useState } from 'react';

import { calculatePanelRecommendation } from '../../../lib/solar/calculator.mjs';
import { parseCfeReceiptText } from '../../../lib/solar/cfe-receipt-parser.mjs';
import { extractReceiptText } from '../../../lib/solar/pdf-text.js';
import { expectedPeriodCount, isCompletePeriod, validatePeriodHistory } from '../../../lib/solar/periods.mjs';
import { downloadSolarQuotePdf } from '../../../lib/solar/quote-pdf.js';
import { calculateInverterSizing, selectSuggestedInverter } from '../../../lib/solar/inverter-sizing.mjs';
import {
  getSupabaseClient,
  getSupabaseFunctionsUrl,
  hasSupabaseConfig,
} from '../../../lib/supabase/client.js';

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

function errorMessage(error) {
  return error?.message?.replace(/^.*?:\s*/, '') || 'Ocurrió un error inesperado.';
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
          <button className="sp-button sp-button--primary" disabled={busy || !periodHistory.ok} title={!periodHistory.ok ? 'Completa la captura manual asistida del historial para continuar.' : undefined}>
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

function Projects({ data, refresh }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(data.projects[0]?.id ?? null);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
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
    const { error } = await getSupabaseClient()
      .from('solar_project_tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', task.id);
    setBusyId('');
    if (error) return setMessage(errorMessage(error));
    setMessage('Tarea completada y registrada en el proyecto.');
    await refresh();
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
            <div className="sp-project-score"><strong>{integrity}%</strong><span>expediente requerido completo</span></div>
          </header>

          {message && <p className="sp-inline-notice">{message}</p>}
          {selected.blocked_reason && <p className="sp-inline-notice sp-inline-notice--warning"><strong>Bloqueo:</strong> {selected.blocked_reason}</p>}

          <div className="sp-project-facts">
            <div><span>Inversión acordada</span><strong>{money.format(Number(selected.agreed_total_mxn))}</strong></div>
            <div><span>Base antes de IVA</span><strong>{money.format(Number(selected.amount_before_vat_mxn))}</strong></div>
            <div><span>Comisión</span><strong>{commission ? `${number.format(Number(commission.rate_percent))}% · ${money.format(Number(commission.payable_amount_mxn))}` : 'Sin vendedor'}</strong><small>{commission?.requires_review ? 'Requiere revisión administrativa' : commission?.status}</small></div>
            <div><span>Folio CFE</span><strong>{selected.cfe_tracking_folio ?? 'Pendiente'}</strong></div>
          </div>

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
                    {stageDocuments.map((document) => <div className="sp-document-row" key={document.id}>
                      <span className={`sp-document-state sp-document-state--${document.status}`} aria-hidden="true" />
                      <div><strong>{document.title}</strong><small>{document.solar_document_requirements?.requirement_scope === 'conditional' ? 'Condicional' : document.solar_document_requirements?.requirement_scope === 'regulatory' ? 'Regulatorio' : 'Control CDSE'}</small></div>
                      <b>{document.status === 'approved' ? 'Aprobado' : document.status === 'uploaded' ? 'Por revisar' : document.status === 'not_applicable' ? 'No aplica' : 'Pendiente'}</b>
                    </div>)}
                  </div>;
                })}
              </div>
            </section>

            <aside className="sp-project-agenda">
              <p className="sp-section-number">PRÓXIMAS ACCIONES</p>
              <h2>Agenda del proyecto</h2>
              {pendingTasks.length ? pendingTasks.map((task) => <div className="sp-task" key={task.id}>
                <div><strong>{task.title}</strong><small>{task.due_at ? new Date(task.due_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin vencimiento'} · {data.profileMap[task.assigned_to]?.full_name ?? 'Sin asignar'}</small></div>
                <button type="button" disabled={busyId === task.id} onClick={() => completeTask(task)}>{busyId === task.id ? '…' : 'Completar'}</button>
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

function Team({ data, session, refresh }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', commissionRate: '0' });
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
    setForm({ fullName: '', email: '', password: '', commissionRate: '0' });
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
          <label className="sp-field"><span>Comisión sobre venta</span><div className="sp-input-suffix"><input type="number" min="0" max="100" step="0.1" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} /><span>%</span></div></label>
          {message && <p className={message.startsWith('Vendedor') ? 'sp-inline-notice' : 'sp-form-error'}>{message}</p>}
          <button className="sp-button sp-button--primary" disabled={busy}>{busy ? 'Creando acceso…' : 'Crear vendedor'}</button>
        </form>
      </div>
    </section>
  );
}

export default function SolarPortal() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [view, setView] = useState('overview');
  const [openQuoteId, setOpenQuoteId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState({
    quotes: [], projects: [], commissions: [], leads: [], receipts: [], modules: [], inverters: [], prices: [], promotions: [], packages: [], financingOptions: [],
    zones: [], profiles: [], profileMap: {}, moduleMap: {}, receiptByLead: {},
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

    const [quotes, projects, commissions, leads, receipts, modules, inverters, prices, promotions, packages, financingOptions, zones, profiles] =
      await Promise.all([
        client.from('solar_quotes').select('*, solar_leads(name,phone_e164,municipality,email,postal_code), solar_modules(brand,model,watts), solar_inverters(brand,model,ac_capacity_kw,phases,warranty_years), solar_receipts(id,tariff_code,service_number,service_number_last4,solar_consumption_periods(sequence,period_start,period_end,covered_months,kwh,amount_mxn))').order('created_at', { ascending: false }),
        client.from('solar_projects').select('*, solar_quotes(folio,panel_count,total_mxn), solar_project_documents(*, solar_document_requirements(stage,requirement_scope,regulatory_reference)), solar_project_checklist_items(*), solar_project_tasks(*), solar_commissions(*)').order('updated_at', { ascending: false }),
        client.from('solar_commissions').select('*').order('updated_at', { ascending: false }),
        client.from('solar_leads').select('*').order('created_at', { ascending: false }),
        client.from('solar_receipts').select('id,lead_id,created_at,customer_name,tariff_code,seller_user_id').order('created_at', { ascending: false }),
        client.from('solar_modules').select('*').order('watts'),
        client.from('solar_inverters').select('*').order('ac_capacity_kw'),
        client.from('solar_price_options').select('*').order('created_at', { ascending: false }),
        client.from('solar_promotions').select('*').order('created_at', { ascending: false }),
        client.from('solar_packages').select('*').order('created_at', { ascending: false }),
        client.from('solar_financing_options').select('*').order('min_panels'),
        client.from('solar_zones').select('*').order('name'),
        client.from('solar_profiles').select('*').order('full_name'),
      ]);
    const firstError = [quotes, projects, commissions, leads, receipts, modules, inverters, prices, promotions, packages, financingOptions, zones, profiles]
      .find((result) => result.error)?.error;
    if (firstError) setLoadError(errorMessage(firstError));
    const profileRows = profiles.data ?? [profileData];
    const moduleRows = modules.data ?? [];
    setData({
      quotes: quotes.data ?? [],
      projects: projects.data ?? [],
      commissions: commissions.data ?? [],
      leads: leads.data ?? [],
      receipts: receipts.data ?? [],
      modules: moduleRows,
      inverters: inverters.data ?? [],
      prices: prices.data ?? [],
      promotions: promotions.data ?? [],
      packages: packages.data ?? [],
      financingOptions: financingOptions.data ?? [],
      zones: zones.data ?? [],
      profiles: profileRows,
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
  const openQuote = (id) => {
    setOpenQuoteId(id);
    setView('quotes');
    window.setTimeout(() => document.getElementById('quote-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const navigation = [
    ['overview', 'Resumen'],
    ['new', 'Nueva cotización'],
    ['quotes', 'Oportunidades'],
    ['projects', 'Proyectos'],
    ...(isAdmin ? [['leads', 'Leads y recibos'], ['catalog', 'Catálogo y precios'], ['team', 'Vendedores']] : []),
  ];

  return (
    <div className="sp-app">
      <aside className="sp-sidebar">
        <a className="sp-brand" href="/solar"><img src="/logo.jpg" alt="CDSE" /><span>Solar</span></a>
        <nav aria-label="Portal solar">
          {navigation.map(([id, label], index) => (
            <button className={view === id ? 'is-active' : ''} onClick={() => setView(id)} key={id}>
              <span>{String(index + 1).padStart(2, '0')}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sp-user">
          <span>{profile.full_name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span>
          <div><strong>{profile.full_name}</strong><small>{isAdmin ? 'Administrador' : `Vendedor · ${number.format(profile.commission_rate)}%`}</small></div>
          <button onClick={logout} aria-label="Cerrar sesión">↗</button>
        </div>
      </aside>
      <main className="sp-main">
        {loadError && <div className="sp-global-error" role="alert">{loadError}</div>}
        {view === 'overview' && <Overview data={data} profile={profile} setView={setView} onOpenQuote={openQuote} />}
        {view === 'new' && <QuoteForm data={data} session={session} onCreated={() => load(session)} onOpenQuote={openQuote} />}
        {view === 'quotes' && <Quotes data={data} refresh={() => load(session)} isAdmin={isAdmin} openQuoteId={openQuoteId} onOpenQuote={openQuote} />}
        {view === 'projects' && <Projects data={data} refresh={() => load(session)} />}
        {view === 'leads' && isAdmin && <Leads data={data} refresh={() => load(session)} />}
        {view === 'catalog' && isAdmin && <Catalog data={data} refresh={() => load(session)} />}
        {view === 'team' && isAdmin && <Team data={data} session={session} refresh={() => load(session)} />}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';

import { calculatePanelRecommendation } from '../../../lib/solar/calculator.mjs';
import { parseCfeReceiptText } from '../../../lib/solar/cfe-receipt-parser.mjs';
import { extractPdfText } from '../../../lib/solar/pdf-text.js';
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
  // Abrimos la ventana desde el gesto del usuario; agregar noopener aquí puede
  // hacer que algunos navegadores la consideren un popup bloqueado.
  const printable = window.open('', '_blank');
  if (!printable) return;
  printable.opener = null;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  printable.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(quote.folio)} · CDSE Solar</title><style>
    :root{color-scheme:light;font-family:Arial,sans-serif;color:#10243e}body{margin:0;background:#f7f3ec}main{max-width:760px;margin:40px auto;background:#fff;padding:48px;box-shadow:0 12px 40px #10243e18}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #e6a21a;padding-bottom:24px}h1{font-size:34px;margin:8px 0}h2{font-size:18px;letter-spacing:.08em;text-transform:uppercase;margin:34px 0 14px}p{line-height:1.55;color:#4c5d70}.folio{font-size:14px;font-weight:700;color:#1767a5;letter-spacing:.1em}.hero{background:#10243e;color:#fff;padding:24px;margin-top:28px}.hero strong{font-size:46px;display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#dce4ec}.grid div{background:#fff;padding:18px}.label{display:block;color:#718092;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}.value{font-weight:700;font-size:20px}.note{border-left:4px solid #e6a21a;padding-left:14px}@media print{body{background:#fff}main{box-shadow:none;margin:0;max-width:none;padding:0}}
  </style></head><body><main><header><div><div class="folio">CDSE SOLAR · COTIZACIÓN</div><h1>${esc(quote.folio)}</h1><p>${esc(lead)}</p></div><div><div class="label">Fecha</div><div class="value">${esc(new Date(quote.created_at).toLocaleDateString('es-MX'))}</div></div></header>
  <section class="hero"><span class="label" style="color:#d7e2ed">Inversión estimada</span><strong>${esc(money.format(Number(quote.total_mxn ?? 0)))}</strong><p style="color:#d7e2ed;margin:8px 0 0">Propuesta preliminar sujeta a validación técnica en sitio.</p></section>
  <h2>Sistema recomendado</h2><div class="grid"><div><span class="label">Paneles</span><span class="value">${esc(quote.panel_count ?? result.panelCount ?? '—')}</span></div><div><span class="label">Potencia por panel</span><span class="value">${esc(module.watts ?? '—')} W</span></div><div><span class="label">Potencia total</span><span class="value">${esc(result.systemDcKw ?? '—')} kW</span></div><div><span class="label">Generación anual</span><span class="value">${esc(result.annualGenerationKwh ?? '—')} kWh</span></div></div>
  ${packageOffer ? `<h2>Paquete sugerido</h2><p class="note"><strong>${esc(packageOffer.name)}</strong><br>${esc(packageOffer.panelCount)} paneles por ${esc(money.format(Number(packageOffer.priceMxn ?? 0)))}.</p>` : ''}
  ${financing ? `<h2>Financiamiento disponible</h2><p class="note"><strong>${esc(financing.name)}</strong><br>Enganche: ${esc(money.format(Number(financing.downPaymentMxn ?? 0)))} · ${esc(financing.installments)} mensualidades sin intereses.</p>` : ''}
  <h2>Siguiente paso</h2><p>Un asesor CDSE validará el recibo, las condiciones del inmueble y la propuesta final antes de programar la instalación.</p><p style="margin-top:42px;font-size:12px;color:#718092">Documento generado desde el portal comercial CDSE Solar.</p></main><script>window.onload=()=>window.print()</script></body></html>`);
  printable.document.close();
}

function QuoteActions({ quote }) {
  const whatsappNumber = String(quote.solar_leads?.phone_e164 ?? '').replace(/\D/g, '');
  const shareText = quoteShareText(quote);
  const email = quote.solar_leads?.email ?? '';
  return <div className="sp-inline-actions">
    <button type="button" className="sp-button sp-button--secondary" onClick={() => printQuote(quote)}>Descargar / imprimir PDF</button>
    {whatsappNumber && <a className="sp-button sp-button--secondary" href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}
    <a className="sp-button sp-button--secondary" href={`mailto:${email}?subject=${encodeURIComponent(`Propuesta solar ${quote.folio}`)}&body=${encodeURIComponent(shareText)}`}>Enviar por correo</a>
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
  const commission = won.reduce((sum, quote) => sum + Number(quote.commission_amount_mxn ?? 0), 0);
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
        <div><span>Comisión registrada</span><strong>{money.format(commission)}</strong><small>sobre ventas cerradas</small></div>
        <div><span>Recibos captados</span><strong>{data.receipts.length}</strong><small>con trazabilidad</small></div>
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
  const selectedZone = data.zones.find((zone) => zone.id === form.zoneId);
  const selectedPrice = data.prices.find((price) => price.id === form.priceOptionId);
  const selectedPackage = availablePackages.find((item) => item.id === form.packageId);
  const selectedFinancing = data.financingOptions.find((item) => item.id === form.financingOptionId);

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
        subtotal: sizing.panelCount * Number(selectedPrice.price_per_panel_mxn),
      };
    } catch {
      return null;
    }
  }, [periods, selectedModule, selectedZone, selectedPrice, form.coverageTarget]);

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
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updatePeriod(index, field, value) {
    setPeriods((current) => current.map((period, itemIndex) =>
      itemIndex === index ? { ...period, [field]: value } : period,
    ));
  }

  async function readReceipt(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError('');
    if (selected.type !== 'application/pdf') {
      setNotice('Imagen adjunta. Confirma manualmente nombre, tarifa e historial de consumo.');
      return;
    }
    setExtracting(true);
    setNotice('Leyendo el recibo CFE…');
    try {
      const text = await extractPdfText(selected);
      const receipt = parseCfeReceiptText(text);
      setForm((current) => ({
        ...current,
        name: receipt.customerName ?? current.name,
        tariffCode: TARIFFS.includes(receipt.tariffCode) ? receipt.tariffCode : current.tariffCode,
        billingFrequency: receipt.periodicity === 'monthly' ? 'monthly' : 'bimonthly',
        serviceNumber: receipt.serviceNumber ?? '',
      }));
      if (receipt.periods.length) {
        setPeriods(receipt.periods.map((period) => ({
          kwh: String(period.kwh),
          amountMxn: String(period.amountMxn ?? 0),
          coveredMonths: period.coveredMonths ?? (receipt.periodicity === 'monthly' ? 1 : 2),
          periodStart: period.periodStart ?? '',
          periodEnd: period.periodEnd ?? '',
        })));
      }
      setNotice(
        `Lectura lista: ${receipt.customerName ?? 'titular por confirmar'}, ` +
        `${receipt.periods.length} periodos y ${number.format(receipt.annualConsumptionKwh)} kWh.`,
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
    const validPeriods = periods.filter((period) => Number(period.kwh) > 0);
    if (!form.name.trim() || !phoneE164 || !validPeriods.length) {
      return setError('Confirma nombre, teléfono y al menos un periodo de consumo.');
    }
    if (!form.zoneId || !form.moduleId || !form.priceOptionId) {
      return setError('Selecciona zona, panel y tarifa instalada.');
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
        solar_leads: { name: form.name, phone_e164: phoneE164, email: form.email },
        solar_modules: selectedModule,
        result_snapshot: {
          ...(preview ?? {}),
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

  if (!data.modules.length || !data.prices.length || !data.zones.length) {
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
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={readReceipt} />
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
            <div className="sp-period-list">
              {periods.map((period, index) => (
                <div className="sp-period-row" key={index}>
                  <strong>{String(index + 1).padStart(2, '0')}</strong>
                  <label><span>kWh</span><input type="number" min="1" value={period.kwh} onChange={(event) => updatePeriod(index, 'kwh', event.target.value)} /></label>
                  <label><span>Monto</span><input type="number" min="0" value={period.amountMxn} onChange={(event) => updatePeriod(index, 'amountMxn', event.target.value)} /></label>
                  <button type="button" onClick={() => setPeriods((current) => current.filter((_, item) => item !== index))} aria-label={`Eliminar periodo ${index + 1}`}>×</button>
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
                <div><dt>Precio por panel</dt><dd>{money.format(selectedPrice.price_per_panel_mxn)}</dd></div>
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
  const selectedQuote = data.quotes.find((quote) => quote.id === openQuoteId) ?? null;

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
      {selectedQuote && <article id="quote-detail" className="sp-quote-detail">
        <div><p className="sp-section-number">COTIZACIÓN SELECCIONADA</p><h2>{selectedQuote.folio}</h2><p>{selectedQuote.solar_leads?.name} · {selectedQuote.panel_count} paneles de {selectedQuote.solar_modules?.watts} W · {money.format(Number(selectedQuote.total_mxn ?? 0))}</p></div>
        <QuoteActions quote={selectedQuote} />
      </article>}
      {data.quotes.length ? (
        <div className="sp-table-wrap sp-table-wrap--full">
          <table>
            <thead><tr><th>Folio</th><th>Cliente</th><th>Vendedor</th><th>Sistema</th><th>Total</th><th>Comisión</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {data.quotes.map((quote) => (
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
                  <td><button type="button" className="sp-text-button" onClick={() => onOpenQuote(quote.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No hay cotizaciones todavía" detail="Los folios creados por vendedores aparecerán aquí con su comisión y estado." />}
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
  const [priceForm, setPriceForm] = useState({ moduleId: data.modules[0]?.id ?? '', name: 'Precio instalado', price: '', min: '1' });
  const [promotionForm, setPromotionForm] = useState({ name: '', moduleId: '', type: 'percentage', value: '', min: '1' });
  const [packageForm, setPackageForm] = useState({ name: '', description: '', moduleId: data.modules[0]?.id ?? '', panelCount: '4', price: '' });
  const [financingForm, setFinancingForm] = useState({ name: '', description: '', minPanels: '8', downPayment: '50', installments: '12', interestRate: '0' });

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
        <button className={tab === 'prices' ? 'is-active' : ''} onClick={() => setTab('prices')}>Precios por panel</button>
        <button className={tab === 'promotions' ? 'is-active' : ''} onClick={() => setTab('promotions')}>Promociones</button>
        <button className={tab === 'packages' ? 'is-active' : ''} onClick={() => setTab('packages')}>Paquetes</button>
        <button className={tab === 'financing' ? 'is-active' : ''} onClick={() => setTab('financing')}>Financiamiento</button>
      </div>
      {message && <p className="sp-inline-notice">{message}</p>}
      <div className="sp-admin-grid">
        <div className="sp-catalog-list">
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
    quotes: [], leads: [], receipts: [], modules: [], prices: [], promotions: [], packages: [], financingOptions: [],
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

    const [quotes, leads, receipts, modules, prices, promotions, packages, financingOptions, zones, profiles] =
      await Promise.all([
        client.from('solar_quotes').select('*, solar_leads(name,phone_e164,municipality,email,postal_code), solar_modules(brand,model,watts)').order('created_at', { ascending: false }),
        client.from('solar_leads').select('*').order('created_at', { ascending: false }),
        client.from('solar_receipts').select('id,lead_id,created_at,customer_name,tariff_code,seller_user_id').order('created_at', { ascending: false }),
        client.from('solar_modules').select('*').order('watts'),
        client.from('solar_price_options').select('*').order('created_at', { ascending: false }),
        client.from('solar_promotions').select('*').order('created_at', { ascending: false }),
        client.from('solar_packages').select('*').order('created_at', { ascending: false }),
        client.from('solar_financing_options').select('*').order('min_panels'),
        client.from('solar_zones').select('*').order('name'),
        client.from('solar_profiles').select('*').order('full_name'),
      ]);
    const firstError = [quotes, leads, receipts, modules, prices, promotions, packages, financingOptions, zones, profiles]
      .find((result) => result.error)?.error;
    if (firstError) setLoadError(errorMessage(firstError));
    const profileRows = profiles.data ?? [profileData];
    const moduleRows = modules.data ?? [];
    setData({
      quotes: quotes.data ?? [],
      leads: leads.data ?? [],
      receipts: receipts.data ?? [],
      modules: moduleRows,
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
        {view === 'leads' && isAdmin && <Leads data={data} refresh={() => load(session)} />}
        {view === 'catalog' && isAdmin && <Catalog data={data} refresh={() => load(session)} />}
        {view === 'team' && isAdmin && <Team data={data} session={session} refresh={() => load(session)} />}
      </main>
    </div>
  );
}

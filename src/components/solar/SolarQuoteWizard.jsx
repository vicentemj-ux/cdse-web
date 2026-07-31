import { useMemo, useRef, useState } from 'react';

import { calculatePanelRecommendation } from '../../lib/solar/calculator.mjs';
import { parseCfeReceiptText } from '../../lib/solar/cfe-receipt-parser.mjs';
import { extractPdfText } from '../../lib/solar/pdf-text.js';

const QUOTE_ENDPOINT = import.meta.env.PUBLIC_SOLAR_QUOTE_ENDPOINT;
const CDSE_WHATSAPP = '526681774845';
const PRIVACY_NOTICE_VERSION = '2026-07-30';
const PANEL_OPTIONS = [550, 590, 630];
const ZONES = [
  { value: 'los-mochis', label: 'Los Mochis', peakSunHours: 5.5 },
  { value: 'topolobampo', label: 'Topolobampo', peakSunHours: 5.5 },
  { value: 'juan-jose-rios', label: 'Juan José Ríos', peakSunHours: 5.45 },
  { value: 'el-carrizo', label: 'El Carrizo', peakSunHours: 5.55 },
  { value: 'otra-comunidad', label: 'Otra comunidad cercana', peakSunHours: 5.4 },
];
const TARIFFS = [
  { value: 'DOMESTIC', label: 'Doméstica (1, 1A–1F)' },
  { value: 'DAC', label: 'DAC — alto consumo' },
  { value: 'PDBT', label: 'PDBT — pequeño negocio' },
  { value: 'GDBT', label: 'GDBT — negocio en baja tensión' },
  { value: 'GDMTO', label: 'GDMTO — media tensión' },
  { value: 'GDMTH', label: 'GDMTH — media tensión horaria' },
  { value: 'OTHER', label: 'No la encuentro / no la sé' },
];

const createPeriod = () => ({ kwh: '', amountMxn: '' });

function normalizedTariff(tariffCode) {
  if (!tariffCode) return null;
  if (/^1[A-F]?$/.test(tariffCode)) return 'DOMESTIC';
  return TARIFFS.some((tariff) => tariff.value === tariffCode) ? tariffCode : 'OTHER';
}

function track(eventName, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: eventName, ...detail });
}

function digits(value) {
  return value.replace(/\D/g, '');
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits }).format(value);
}

function fieldError(errors, name) {
  return errors[name] ? (
    <p className="solar-field-error" id={`${name}-error`} role="alert">
      {errors[name]}
    </p>
  ) : null;
}

export default function SolarQuoteWizard() {
  const headingRef = useRef(null);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle');
  const [serverError, setServerError] = useState('');
  const [result, setResult] = useState(null);
  const [receiptMode, setReceiptMode] = useState('upload');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptExtraction, setReceiptExtraction] = useState({
    status: 'idle',
    message: '',
  });
  const [receiptMetadata, setReceiptMetadata] = useState({
    serviceNumberLast4: null,
    latestBillDate: null,
  });
  const [form, setForm] = useState({
    propertyType: 'home',
    zoneSlug: 'los-mochis',
    tariffCode: 'OTHER',
    preferredPanelWatts: 590,
    billingFrequency: 'bimonthly',
    roofType: 'unknown',
    name: '',
    phone: '',
    email: '',
    municipality: 'Los Mochis',
    postalCode: '',
    privacyConsent: false,
    website: '',
  });
  const [periods, setPeriods] = useState([createPeriod(), createPeriod()]);

  const currentZone = useMemo(
    () => ZONES.find((zone) => zone.value === form.zoneSlug) ?? ZONES[0],
    [form.zoneSlug],
  );
  const coveredMonths = form.billingFrequency === 'monthly' ? 1 : 2;

  function updateForm(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]:
        type === 'checkbox'
          ? checked
          : name === 'preferredPanelWatts'
            ? Number(value)
            : value,
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  }

  function updatePeriod(index, field, value) {
    setPeriods((current) =>
      current.map((period, periodIndex) =>
        periodIndex === index ? { ...period, [field]: value } : period,
      ),
    );
    setErrors((current) => ({ ...current, periods: undefined }));
  }

  function validateStep(targetStep) {
    const nextErrors = {};
    if (targetStep === 1) {
      if (!form.propertyType) nextErrors.propertyType = 'Selecciona el tipo de inmueble.';
      if (!form.zoneSlug) nextErrors.zoneSlug = 'Selecciona la ubicación.';
      if (!form.tariffCode) nextErrors.tariffCode = 'Selecciona la tarifa del recibo.';
      if (!PANEL_OPTIONS.includes(form.preferredPanelWatts)) {
        nextErrors.preferredPanelWatts = 'Selecciona una potencia disponible.';
      }
    }
    if (targetStep === 2) {
      if (receiptMode === 'upload' && !receiptFile) {
        nextErrors.receiptFile = 'Adjunta una foto o PDF de tu recibo CFE.';
      }
      if (
        periods.some(
          (period) =>
            !Number.isFinite(Number(period.kwh)) ||
            Number(period.kwh) <= 0 ||
            !Number.isFinite(Number(period.amountMxn)) ||
            Number(period.amountMxn) < 0,
        )
      ) {
        nextErrors.periods = 'Completa consumo y monto de cada periodo.';
      }
    }
    if (targetStep === 3) {
      if (form.name.trim().length < 2) nextErrors.name = 'Escribe tu nombre.';
      if (digits(form.phone).length !== 10) {
        nextErrors.phone = 'Escribe un WhatsApp de 10 dígitos.';
      }
      if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) {
        nextErrors.email = 'Escribe un correo válido, por ejemplo nombre@correo.com.';
      }
      if (!form.privacyConsent) {
        nextErrors.privacyConsent = 'Acepta el aviso de privacidad para continuar.';
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function goToStep(nextStep) {
    if (nextStep > step && !validateStep(step)) return;
    setStep(nextStep);
    setServerError('');
    requestAnimationFrame(() => headingRef.current?.focus());
    track('solar_quote_step_view', { step: nextStep });
  }

  async function handleReceiptFile(event) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setReceiptFile(null);
      setReceiptExtraction({ status: 'idle', message: '' });
      return;
    }
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setErrors((current) => ({
        ...current,
        receiptFile: 'Usa un archivo PDF, JPG, PNG o WebP.',
      }));
      event.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors((current) => ({
        ...current,
        receiptFile: 'El archivo debe pesar menos de 10 MB.',
      }));
      event.target.value = '';
      return;
    }
    setReceiptFile(file);
    setErrors((current) => ({ ...current, receiptFile: undefined }));
    track('solar_receipt_selected', { file_type: file.type });

    if (file.type !== 'application/pdf') {
      setReceiptExtraction({
        status: 'confirmation',
        message:
          'La foto quedó adjunta. Confirma manualmente el historial mientras se completa la lectura OCR.',
      });
      return;
    }

    setReceiptExtraction({
      status: 'processing',
      message: 'Leyendo tarifa, consumo e historial del recibo…',
    });

    try {
      const rawText = await extractPdfText(file);
      const extracted = parseCfeReceiptText(rawText);
      if (extracted.periods.length < 2) {
        throw new Error('No encontramos suficientes periodos en el archivo.');
      }

      setPeriods(
        extracted.periods.map((period) => ({
          kwh: String(period.kwh),
          amountMxn: String(period.amountMxn),
        })),
      );
      setForm((current) => ({
        ...current,
        name: current.name || extracted.customerName || '',
        tariffCode: normalizedTariff(extracted.tariffCode) ?? current.tariffCode,
        billingFrequency:
          extracted.periodicity === 'monthly' ? 'monthly' : 'bimonthly',
      }));
      setReceiptMetadata({
        serviceNumberLast4: extracted.serviceNumber?.slice(-4) ?? null,
        latestBillDate: extracted.periods[0]?.periodEnd ?? null,
      });
      setReceiptExtraction({
        status: extracted.confidence === 'high' ? 'success' : 'confirmation',
        message:
          extracted.confidence === 'high'
            ? `Encontramos ${extracted.periods.length} periodos y ${formatNumber(extracted.annualConsumptionKwh)} kWh en doce meses. Revisa y confirma los datos.`
            : `Encontramos ${extracted.periods.length} periodos, pero necesitamos que confirmes el historial.`,
      });
      setErrors((current) => ({ ...current, periods: undefined }));
      track('solar_receipt_extracted', {
        confidence: extracted.confidence,
        period_count: extracted.periods.length,
        tariff: extracted.tariffCode,
      });
    } catch {
      setReceiptExtraction({
        status: 'confirmation',
        message:
          'No pudimos leer este PDF automáticamente. El archivo sigue adjunto; captura o confirma los periodos.',
      });
    }
  }

  function addPeriod() {
    const maximumPeriods = form.billingFrequency === 'monthly' ? 12 : 6;
    if (periods.length >= maximumPeriods) return;
    setPeriods((current) => [...current, createPeriod()]);
  }

  function removePeriod(index) {
    if (periods.length <= 2) return;
    setPeriods((current) => current.filter((_, periodIndex) => periodIndex !== index));
  }

  function buildPayload() {
    const query = new URLSearchParams(window.location.search);
    return {
      zoneSlug: form.zoneSlug,
      preferredPanelWatts: form.preferredPanelWatts,
      website: form.website,
      contact: {
        name: form.name,
        phone: form.phone,
        email: form.email || null,
        municipality: currentZone.label,
        postalCode: form.postalCode || null,
        privacyConsent: form.privacyConsent,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      },
      receipt: {
        captureMethod: receiptMode === 'upload' ? 'receipt_upload' : 'manual_receipt',
        serviceNumberLast4: receiptMetadata.serviceNumberLast4,
        latestBillDate: receiptMetadata.latestBillDate,
        billingFrequency: form.billingFrequency,
        tariffCode: form.tariffCode,
        propertyType: form.propertyType,
        roofType: form.roofType,
        periods: periods.map((period) => ({
          kwh: Number(period.kwh),
          amountMxn: Number(period.amountMxn),
          coveredMonths,
        })),
      },
      attribution: {
        source: query.get('utm_source') || 'website',
        utmSource: query.get('utm_source'),
        utmMedium: query.get('utm_medium'),
        utmCampaign: query.get('utm_campaign'),
        utmContent: query.get('utm_content'),
        utmTerm: query.get('utm_term'),
        landingPath: window.location.pathname,
        referrer: document.referrer || null,
      },
    };
  }

  async function submitQuote(event) {
    event.preventDefault();
    if (!validateStep(3) || status === 'submitting') return;
    setStatus('submitting');
    setServerError('');
    track('solar_contact_submitted', {
      zone: form.zoneSlug,
      panel_watts: form.preferredPanelWatts,
    });

    try {
      const payload = buildPayload();
      if (QUOTE_ENDPOINT) {
        const body = new FormData();
        body.set('payload', JSON.stringify(payload));
        if (receiptFile) body.set('receipt', receiptFile);
        const response = await fetch(QUOTE_ENDPOINT, { method: 'POST', body });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || 'No pudimos guardar la estimación.');
        }
        setResult({ ...data.quote, localPreview: false });
      } else {
        const sizing = calculatePanelRecommendation({
          periods: payload.receipt.periods,
          panelWatts: form.preferredPanelWatts,
          peakSunHoursPerDay: currentZone.peakSunHours,
          performanceRatio: 0.8,
          coverageTarget: 1,
        });
        setResult({
          folio: 'VISTA-PREVIA',
          panelCount: sizing.panelCount,
          systemDcKw: sizing.systemDcKw,
          annualGenerationKwh: sizing.annualGenerationKwh,
          estimatedCoverage: sizing.estimatedCoverage,
          confidence: sizing.history.coverageFraction >= 0.95 ? 'alta' : 'media',
          requiresEngineeringReview: ['GDMTO', 'GDMTH'].includes(form.tariffCode),
          localPreview: true,
        });
      }
      setStatus('success');
      setStep(4);
      track('solar_quote_calculated', {
        zone: form.zoneSlug,
        panel_watts: form.preferredPanelWatts,
      });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      setStatus('error');
      setServerError(
        error instanceof Error
          ? error.message
          : 'No pudimos calcular la recomendación. Intenta nuevamente.',
      );
    }
  }

  const whatsappHref = result
    ? `https://wa.me/${CDSE_WHATSAPP}?text=${encodeURIComponent(
        `Hola, soy ${form.name}. Quiero validar mi estimación solar ${result.folio}. ` +
          `Estoy en ${currentZone.label}; el cálculo preliminar sugiere ${result.panelCount} ` +
          `paneles de ${form.preferredPanelWatts} W (${result.systemDcKw.toFixed(2)} kW).`,
      )}`
    : '#';

  return (
    <div className="solar-wizard">
      <div className="solar-wizard__topline">
        <p className="solar-eyebrow">Diagnóstico solar CDSE</p>
        <p className="solar-progress-label" aria-live="polite">
          {step < 4 ? `Paso ${step} de 3` : 'Estimación lista'}
        </p>
      </div>
      <div
        className="solar-progress"
        role="progressbar"
        aria-valuemin="1"
        aria-valuemax="3"
        aria-valuenow={Math.min(step, 3)}
        aria-label="Progreso del cotizador"
      >
        <span style={{ '--solar-progress': `${Math.min(step, 3) * 33.333}%` }} />
      </div>

      {step === 1 && (
        <section className="solar-step" aria-labelledby="solar-step-title">
          <div className="solar-step__intro">
            <p className="solar-step__number">01</p>
            <div>
              <h2 id="solar-step-title" tabIndex="-1" ref={headingRef}>
                Cuéntanos dónde consume energía
              </h2>
              <p>Esto define la zona solar y el tipo de revisión que necesita el proyecto.</p>
            </div>
          </div>

          <fieldset className="solar-fieldset">
            <legend>¿Dónde instalarías los paneles?</legend>
            <div className="solar-choice-grid solar-choice-grid--two">
              {[
                ['home', 'Casa', 'Consumo doméstico o tarifa DAC'],
                ['business', 'Negocio', 'Comercio, oficina, taller o industria'],
              ].map(([value, label, description]) => (
                <label className="solar-choice" key={value}>
                  <input
                    type="radio"
                    name="propertyType"
                    value={value}
                    checked={form.propertyType === value}
                    onChange={updateForm}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
            {fieldError(errors, 'propertyType')}
          </fieldset>

          <div className="solar-form-grid">
            <label className="solar-field">
              <span>Ubicación del proyecto</span>
              <select
                name="zoneSlug"
                value={form.zoneSlug}
                onChange={updateForm}
                aria-describedby={errors.zoneSlug ? 'zoneSlug-error' : undefined}
              >
                {ZONES.map((zone) => (
                  <option value={zone.value} key={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </select>
              {fieldError(errors, 'zoneSlug')}
            </label>
            <label className="solar-field">
              <span>Tarifa que aparece en tu recibo</span>
              <select
                name="tariffCode"
                value={form.tariffCode}
                onChange={updateForm}
                aria-describedby={errors.tariffCode ? 'tariffCode-error' : undefined}
              >
                {TARIFFS.map((tariff) => (
                  <option value={tariff.value} key={tariff.value}>
                    {tariff.label}
                  </option>
                ))}
              </select>
              {fieldError(errors, 'tariffCode')}
            </label>
          </div>

          <fieldset className="solar-fieldset">
            <legend>Potencia del panel a evaluar</legend>
            <p className="solar-field-hint">
              Si no tienes preferencia, 590 W es un buen punto de partida.
            </p>
            <div className="solar-panel-options">
              {PANEL_OPTIONS.map((watts) => (
                <label className="solar-panel-option" key={watts}>
                  <input
                    type="radio"
                    name="preferredPanelWatts"
                    value={watts}
                    checked={form.preferredPanelWatts === watts}
                    onChange={updateForm}
                  />
                  <span>
                    <strong>{watts} W</strong>
                    {watts === 590 && <small>Recomendado</small>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="solar-actions solar-actions--end">
            <button className="solar-button solar-button--primary" onClick={() => goToStep(2)}>
              Continuar con mi recibo
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="solar-step" aria-labelledby="solar-step-title">
          <div className="solar-step__intro">
            <p className="solar-step__number">02</p>
            <div>
              <h2 id="solar-step-title" tabIndex="-1" ref={headingRef}>
                Comparte tu consumo
              </h2>
              <p>Tu recibo permite recomendar paneles con menos suposiciones.</p>
            </div>
          </div>

          <div className="solar-mode-switch" role="group" aria-label="Forma de captura">
            <button
              type="button"
              className={receiptMode === 'upload' ? 'is-active' : ''}
              aria-pressed={receiptMode === 'upload'}
              onClick={() => setReceiptMode('upload')}
            >
              Subir mi recibo
            </button>
            <button
              type="button"
              className={receiptMode === 'manual' ? 'is-active' : ''}
              aria-pressed={receiptMode === 'manual'}
              onClick={() => setReceiptMode('manual')}
            >
              Capturar manualmente
            </button>
          </div>

          {receiptMode === 'upload' && (
            <div className="solar-upload">
              <input
                id="solar-receipt"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                onChange={handleReceiptFile}
                aria-describedby={`receipt-help${errors.receiptFile ? ' receiptFile-error' : ''}`}
              />
              <label htmlFor="solar-receipt">
                <span className="solar-upload__icon" aria-hidden="true">↑</span>
                <strong>{receiptFile ? receiptFile.name : 'Seleccionar foto o PDF'}</strong>
                <small id="receipt-help">
                  PDF, JPG, PNG o WebP · máximo 10 MB · archivo privado
                </small>
              </label>
              {fieldError(errors, 'receiptFile')}
              {receiptExtraction.message && (
                <p
                  className={`solar-extraction-status solar-extraction-status--${receiptExtraction.status}`}
                  role="status"
                  aria-live="polite"
                >
                  <span aria-hidden="true">
                    {receiptExtraction.status === 'processing' ? '↻' : '✓'}
                  </span>
                  <span>{receiptExtraction.message}</span>
                </p>
              )}
            </div>
          )}

          <div className="solar-consumption-heading">
            <div>
              <h3>Confirma los datos del historial</h3>
              <p>
                Captura al menos dos renglones del historial de consumo de tu recibo.
              </p>
            </div>
            <label className="solar-field solar-field--compact">
              <span>Cada periodo es</span>
              <select name="billingFrequency" value={form.billingFrequency} onChange={updateForm}>
                <option value="bimonthly">Bimestral</option>
                <option value="monthly">Mensual</option>
              </select>
            </label>
          </div>

          <div className="solar-periods">
            {periods.map((period, index) => (
              <div className="solar-period" key={index}>
                <p>Periodo {index + 1}</p>
                <label className="solar-field">
                  <span>Consumo</span>
                  <div className="solar-input-unit">
                    <input
                      type="number"
                      min="1"
                      inputMode="decimal"
                      value={period.kwh}
                      onChange={(event) => updatePeriod(index, 'kwh', event.target.value)}
                      aria-label={`Consumo en kWh del periodo ${index + 1}`}
                    />
                    <span>kWh</span>
                  </div>
                </label>
                <label className="solar-field">
                  <span>Monto pagado</span>
                  <div className="solar-input-unit solar-input-unit--money">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={period.amountMxn}
                      onChange={(event) => updatePeriod(index, 'amountMxn', event.target.value)}
                      aria-label={`Monto en pesos del periodo ${index + 1}`}
                    />
                  </div>
                </label>
                {periods.length > 2 && (
                  <button
                    type="button"
                    className="solar-remove-period"
                    onClick={() => removePeriod(index)}
                    aria-label={`Eliminar periodo ${index + 1}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {fieldError(errors, 'periods')}
          {periods.length < (form.billingFrequency === 'monthly' ? 12 : 6) && (
            <button className="solar-text-button" type="button" onClick={addPeriod}>
              + Agregar otro periodo
            </button>
          )}

          <div className="solar-actions">
            <button className="solar-button solar-button--ghost" onClick={() => goToStep(1)}>
              ← Regresar
            </button>
            <button className="solar-button solar-button--primary" onClick={() => goToStep(3)}>
              Continuar con mis datos
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <form className="solar-step" onSubmit={submitQuote} noValidate aria-labelledby="solar-step-title">
          <div className="solar-step__intro">
            <p className="solar-step__number">03</p>
            <div>
              <h2 id="solar-step-title" tabIndex="-1" ref={headingRef}>
                ¿A quién entregamos la recomendación?
              </h2>
              <p>Un asesor de CDSE podrá revisar el resultado contigo por WhatsApp.</p>
            </div>
          </div>

          <div className="solar-form-grid">
            <label className="solar-field solar-field--wide">
              <span>Nombre</span>
              <input
                name="name"
                autoComplete="name"
                value={form.name}
                onChange={updateForm}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {fieldError(errors, 'name')}
            </label>
            <label className="solar-field">
              <span>WhatsApp</span>
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="668 000 0000"
                value={form.phone}
                onChange={updateForm}
                aria-describedby={`phone-help${errors.phone ? ' phone-error' : ''}`}
              />
              <small id="phone-help">Aquí daremos seguimiento a tu solicitud.</small>
              {fieldError(errors, 'phone')}
            </label>
            <label className="solar-field">
              <span>Correo <small>opcional</small></span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={updateForm}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {fieldError(errors, 'email')}
            </label>
            <label className="solar-field">
              <span>Código postal <small>opcional</small></span>
              <input
                name="postalCode"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength="5"
                value={form.postalCode}
                onChange={updateForm}
              />
            </label>
            <label className="solar-field">
              <span>Tipo de techo</span>
              <select name="roofType" value={form.roofType} onChange={updateForm}>
                <option value="unknown">No estoy seguro</option>
                <option value="concrete">Losa de concreto</option>
                <option value="metal">Lámina</option>
                <option value="tile">Teja</option>
                <option value="ground">Instalación en suelo</option>
                <option value="other">Otro</option>
              </select>
            </label>
          </div>

          <div className="solar-honeypot" aria-hidden="true">
            <label>
              Sitio web
              <input name="website" tabIndex="-1" autoComplete="off" value={form.website} onChange={updateForm} />
            </label>
          </div>

          <label className="solar-consent">
            <input
              type="checkbox"
              name="privacyConsent"
              checked={form.privacyConsent}
              onChange={updateForm}
              aria-describedby={errors.privacyConsent ? 'privacyConsent-error' : undefined}
            />
            <span>
              Acepto que CDSE use estos datos para preparar y dar seguimiento a mi
              estimación solar. Leí el <a href="/privacidad" target="_blank">aviso de privacidad</a>.
            </span>
          </label>
          {fieldError(errors, 'privacyConsent')}

          {serverError && (
            <div className="solar-server-error" role="alert">
              <strong>No pudimos terminar la solicitud.</strong>
              <p>{serverError}</p>
            </div>
          )}

          <div className="solar-actions">
            <button type="button" className="solar-button solar-button--ghost" onClick={() => goToStep(2)}>
              ← Regresar
            </button>
            <button
              type="submit"
              className="solar-button solar-button--primary"
              disabled={status === 'submitting'}
            >
              {status === 'submitting' ? 'Calculando recomendación…' : 'Calcular paneles sugeridos'}
            </button>
          </div>
        </form>
      )}

      {step === 4 && result && (
        <section className="solar-result" aria-labelledby="solar-step-title">
          <div className="solar-result__mark" aria-hidden="true">✓</div>
          <p className="solar-eyebrow">Estimación preliminar · {result.folio}</p>
          <h2 id="solar-step-title" tabIndex="-1" ref={headingRef}>
            Tu proyecto podría comenzar con{' '}
            <strong>{result.panelCount} paneles</strong>
          </h2>
          <p className="solar-result__lead">
            Evaluamos paneles monofaciales de {form.preferredPanelWatts} W para un
            inmueble en {currentZone.label}.
          </p>

          <dl className="solar-result__metrics">
            <div>
              <dt>Potencia propuesta</dt>
              <dd>{formatNumber(result.systemDcKw, 2)} kW</dd>
            </div>
            <div>
              <dt>Generación anual estimada</dt>
              <dd>{formatNumber(result.annualGenerationKwh)} kWh</dd>
            </div>
            <div>
              <dt>Cobertura estimada</dt>
              <dd>{formatNumber(Math.min(result.estimatedCoverage * 100, 100))}%</dd>
            </div>
          </dl>

          {result.requiresEngineeringReview && (
            <div className="solar-result__notice">
              <strong>Tu tarifa necesita revisión especializada.</strong>
              <p>
                La demanda y los horarios de consumo influyen en el ahorro. Un asesor
                revisará esos datos antes de ofrecer una propuesta.
              </p>
            </div>
          )}
          {result.localPreview && (
            <div className="solar-result__notice solar-result__notice--development">
              <strong>Vista previa local.</strong>
              <p>Este resultado todavía no se guardó porque Supabase no está conectado.</p>
            </div>
          )}

          <p className="solar-result__disclaimer">
            La cantidad final depende de espacio útil, sombras, orientación, estructura
            y condiciones eléctricas. CDSE validará estos puntos antes de cotizar.
          </p>

          <div className="solar-result__actions">
            <a
              className="solar-button solar-button--whatsapp"
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track('solar_whatsapp_clicked', { folio: result.folio })}
            >
              Validar por WhatsApp
              <span aria-hidden="true">↗</span>
            </a>
            <button
              type="button"
              className="solar-text-button"
              onClick={() => {
                setResult(null);
                setStatus('idle');
                setStep(1);
              }}
            >
              Calcular otro proyecto
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

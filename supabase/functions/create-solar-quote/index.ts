import { createClient } from '@supabase/supabase-js';

import { calculatePreliminaryQuote } from '../_shared/calculator.mjs';

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_BUCKET = 'solar-receipts';
const ALLOWED_RECEIPT_TYPES = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const ALLOWED_TARIFFS = new Set([
  'DOMESTIC',
  'DAC',
  'PDBT',
  'GDBT',
  'GDMTO',
  'GDMTH',
  'OTHER',
]);
const ALLOWED_BILLING_FREQUENCIES = new Set(['monthly', 'bimonthly', 'other']);
const ALLOWED_CAPTURE_METHODS = new Set([
  'receipt_upload',
  'manual_receipt',
  'payment_estimate',
]);
const ALLOWED_PROPERTY_TYPES = new Set(['home', 'business', 'industrial', 'other']);
const ALLOWED_ROOF_TYPES = new Set([
  'concrete',
  'metal',
  'tile',
  'ground',
  'unknown',
  'other',
]);
const CALCULATION_VERSION = 'cdse-solar-1.0.0';

type JsonRecord = Record<string, unknown>;
type TariffCode =
  | 'DOMESTIC'
  | 'DAC'
  | 'PDBT'
  | 'GDBT'
  | 'GDMTO'
  | 'GDMTH'
  | 'OTHER';

class RequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function asObject(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'INVALID_FIELD', `${field} no es válido.`);
  }
  return value as JsonRecord;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
  minLength = 1,
): string {
  if (typeof value !== 'string') {
    throw new RequestError(400, 'INVALID_FIELD', `${field} es obligatorio.`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new RequestError(400, 'INVALID_FIELD', `${field} no es válido.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, maxLength);
}

function requiredNumber(
  value: unknown,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RequestError(400, 'INVALID_FIELD', `${field} no es válido.`);
  }
  return number;
}

function optionalNumber(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredNumber(value, field, options);
}

function normalizePhone(value: unknown): string {
  const raw = requiredText(value, 'WhatsApp', 30, 10);
  const digits = raw.replace(/\D/g, '');
  const normalized =
    digits.length === 10
      ? `+52${digits}`
      : digits.length === 12 && digits.startsWith('52')
        ? `+${digits}`
        : raw.startsWith('+')
          ? `+${digits}`
          : '';

  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new RequestError(400, 'INVALID_PHONE', 'El número de WhatsApp no es válido.');
  }
  return normalized;
}

function normalizeEmail(value: unknown): string | null {
  const email = optionalText(value, 'Correo', 254);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new RequestError(400, 'INVALID_EMAIL', 'El correo no es válido.');
  }
  return email?.toLowerCase() ?? null;
}

function isoDateOrNull(value: unknown, field: string): string | null {
  const text = optionalText(value, field, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new RequestError(400, 'INVALID_DATE', `${field} no es válida.`);
  }
  return text;
}

function enumValue(
  value: unknown,
  field: string,
  allowed: Set<string>,
): string {
  const normalized = requiredText(value, field, 30).toUpperCase();
  if (!allowed.has(normalized) && !allowed.has(normalized.toLowerCase())) {
    throw new RequestError(400, 'INVALID_FIELD', `${field} no es válido.`);
  }
  return allowed.has(normalized) ? normalized : normalized.toLowerCase();
}

function optionalEnumValue(
  value: unknown,
  field: string,
  allowed: Set<string>,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  return enumValue(value, field, allowed);
}

function parsePeriods(value: unknown, captureMethod: string) {
  if (!Array.isArray(value)) {
    throw new RequestError(400, 'INVALID_PERIODS', 'Agrega los periodos de consumo.');
  }
  const minimum = captureMethod === 'payment_estimate' ? 1 : 2;
  if (value.length < minimum || value.length > 12) {
    throw new RequestError(
      400,
      'INVALID_PERIODS',
      `Captura entre ${minimum} y 12 periodos.`,
    );
  }

  return value.map((rawPeriod, index) => {
    const period = asObject(rawPeriod, `Periodo ${index + 1}`);
    const coveredDays = optionalNumber(
      period.coveredDays,
      `Días del periodo ${index + 1}`,
      { min: 1, max: 370 },
    );
    const coveredMonths = optionalNumber(
      period.coveredMonths,
      `Meses del periodo ${index + 1}`,
      { min: 0.25, max: 12 },
    );
    if ((coveredDays === null) === (coveredMonths === null)) {
      throw new RequestError(
        400,
        'INVALID_PERIOD_DURATION',
        `Indica días o meses, pero no ambos, para el periodo ${index + 1}.`,
      );
    }

    return {
      sequence: index + 1,
      period_start: isoDateOrNull(period.periodStart, 'Fecha inicial'),
      period_end: isoDateOrNull(period.periodEnd, 'Fecha final'),
      covered_days: coveredDays,
      covered_months: coveredMonths,
      kwh: requiredNumber(period.kwh, `kWh del periodo ${index + 1}`, {
        min: 0.001,
        max: 10_000_000,
      }),
      amount_mxn: requiredNumber(period.amountMxn, `Monto del periodo ${index + 1}`, {
        min: 0,
        max: 100_000_000,
      }),
      demand_kw: optionalNumber(period.demandKw, 'Demanda', {
        min: 0,
        max: 1_000_000,
      }),
      base_kwh: optionalNumber(period.baseKwh, 'Energía base', { min: 0 }),
      intermediate_kwh: optionalNumber(period.intermediateKwh, 'Energía intermedia', {
        min: 0,
      }),
      peak_kwh: optionalNumber(period.peakKwh, 'Energía punta', { min: 0 }),
    };
  });
}

function getAllowedOrigin(request: Request): string {
  const configuredOrigin = requiredEnv('PUBLIC_SITE_ORIGIN').replace(/\/$/, '');
  const origin = request.headers.get('origin')?.replace(/\/$/, '');
  if (origin && origin !== configuredOrigin) {
    throw new RequestError(403, 'ORIGIN_NOT_ALLOWED', 'Origen no permitido.');
  }
  return configuredOrigin;
}

function responseHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
}

async function parseRequest(request: Request): Promise<{
  payload: JsonRecord;
  receiptFile: File | null;
}> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const payloadRaw = form.get('payload');
    if (typeof payloadRaw !== 'string' || payloadRaw.length > 100_000) {
      throw new RequestError(400, 'INVALID_PAYLOAD', 'La solicitud no es válida.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadRaw);
    } catch {
      throw new RequestError(400, 'INVALID_JSON', 'La solicitud no es válida.');
    }
    const fileValue = form.get('receipt');
    return {
      payload: asObject(parsed, 'Solicitud'),
      receiptFile: fileValue instanceof File && fileValue.size > 0 ? fileValue : null,
    };
  }

  if (!contentType.includes('application/json')) {
    throw new RequestError(415, 'UNSUPPORTED_CONTENT_TYPE', 'Formato no compatible.');
  }
  return { payload: asObject(await request.json(), 'Solicitud'), receiptFile: null };
}

async function verifyTurnstile(token: unknown, request: Request): Promise<void> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return;
  const normalizedToken = requiredText(token, 'Verificación anti-spam', 2048);
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', normalizedToken);
  const remoteIp =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (remoteIp) form.set('remoteip', remoteIp);

  const verification = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form },
  );
  const result = await verification.json();
  if (!verification.ok || result.success !== true) {
    throw new RequestError(400, 'BOT_VERIFICATION_FAILED', 'No pudimos verificar la solicitud.');
  }
}

function validateReceiptFile(file: File | null, captureMethod: string) {
  if (!file) {
    if (captureMethod === 'receipt_upload') {
      throw new RequestError(400, 'RECEIPT_REQUIRED', 'Adjunta tu recibo CFE.');
    }
    return null;
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new RequestError(413, 'RECEIPT_TOO_LARGE', 'El recibo no debe superar 10 MB.');
  }
  const extension = ALLOWED_RECEIPT_TYPES.get(file.type);
  if (!extension) {
    throw new RequestError(
      415,
      'INVALID_RECEIPT_TYPE',
      'El recibo debe ser PDF, JPG, PNG o WebP.',
    );
  }
  return extension;
}

Deno.serve(async (request: Request) => {
  let origin = Deno.env.get('PUBLIC_SITE_ORIGIN')?.replace(/\/$/, '') ?? '';
  try {
    origin = getAllowedOrigin(request);
    const headers = responseHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' } }),
        { status: 405, headers },
      );
    }

    const { payload, receiptFile } = await parseRequest(request);
    if (payload.website) {
      // Honeypot: respond as accepted without creating data.
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers });
    }
    await verifyTurnstile(payload.turnstileToken, request);

    const contact = asObject(payload.contact, 'Contacto');
    const receipt = asObject(payload.receipt, 'Recibo');
    const attribution =
      payload.attribution === undefined
        ? {}
        : asObject(payload.attribution, 'Atribución');

    if (contact.privacyConsent !== true) {
      throw new RequestError(
        400,
        'PRIVACY_CONSENT_REQUIRED',
        'Acepta el aviso de privacidad para continuar.',
      );
    }

    const now = new Date();
    const leadPayload = {
      name: requiredText(contact.name, 'Nombre', 120, 2),
      phone_e164: normalizePhone(contact.phone),
      email: normalizeEmail(contact.email),
      municipality: requiredText(contact.municipality, 'Municipio', 100, 2),
      postal_code: optionalText(contact.postalCode, 'Código postal', 10),
      contact_preference: 'whatsapp',
      privacy_consent_at: now.toISOString(),
      privacy_notice_version: requiredText(
        contact.privacyNoticeVersion,
        'Versión del aviso de privacidad',
        40,
      ),
      source: optionalText(attribution.source, 'Fuente', 100) ?? 'website',
      utm_source: optionalText(attribution.utmSource, 'UTM source', 200),
      utm_medium: optionalText(attribution.utmMedium, 'UTM medium', 200),
      utm_campaign: optionalText(attribution.utmCampaign, 'UTM campaign', 200),
      utm_content: optionalText(attribution.utmContent, 'UTM content', 200),
      utm_term: optionalText(attribution.utmTerm, 'UTM term', 200),
      landing_path: optionalText(attribution.landingPath, 'Landing', 500),
      referrer: optionalText(attribution.referrer, 'Referente', 1000),
      metadata: {},
    };

    const captureMethod = enumValue(
      receipt.captureMethod,
      'Método de captura',
      ALLOWED_CAPTURE_METHODS,
    );
    const billingFrequency = enumValue(
      receipt.billingFrequency,
      'Periodicidad',
      ALLOWED_BILLING_FREQUENCIES,
    );
    const tariffCode = enumValue(
      receipt.tariffCode,
      'Tarifa',
      ALLOWED_TARIFFS,
    ) as TariffCode;
    const periods = parsePeriods(receipt.periods, captureMethod);
    const extension = validateReceiptFile(receiptFile, captureMethod);
    const zoneSlug = requiredText(payload.zoneSlug, 'Zona', 80).toLowerCase();
    const preferredPanelWatts = optionalNumber(
      payload.preferredPanelWatts,
      'Potencia del panel',
      { min: 300, max: 800 },
    );
    const receiptPayloadBase = {
      service_number_last4: optionalText(
        receipt.serviceNumberLast4,
        'Últimos cuatro dígitos',
        4,
      ),
      tariff_code: tariffCode,
      billing_frequency: billingFrequency,
      latest_bill_date: isoDateOrNull(receipt.latestBillDate, 'Fecha del recibo'),
      capture_method: captureMethod,
      property_type: optionalEnumValue(
        receipt.propertyType,
        'Tipo de inmueble',
        ALLOWED_PROPERTY_TYPES,
      ),
      roof_type: optionalEnumValue(receipt.roofType, 'Tipo de techo', ALLOWED_ROOF_TYPES),
      metadata: {},
    };
    if (
      receiptPayloadBase.service_number_last4 &&
      !/^[0-9]{4}$/.test(receiptPayloadBase.service_number_last4)
    ) {
      throw new RequestError(
        400,
        'INVALID_SERVICE_NUMBER',
        'Los últimos dígitos del número de servicio no son válidos.',
      );
    }

    const supabase = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const [{ data: zone, error: zoneError }, { data: config, error: configError }] =
      await Promise.all([
        supabase
          .from('solar_zones')
          .select('id,slug,name,municipality,state,latitude,longitude,peak_sun_hours_per_day,performance_ratio')
          .eq('slug', zoneSlug)
          .eq('active', true)
          .single(),
        supabase
          .from('solar_calculation_configs')
          .select(`
            id,
            version,
            name,
            coverage_target,
            price_mode,
            price_per_watt_mxn,
            price_includes_vat,
            vat_rate,
            savings_realization_factor,
            non_offsettable_annual_charges_mxn,
            tariff_escalation_rate,
            annual_panel_degradation_rate,
            projection_years,
            module_id,
            default_inverter_id,
            cost_template,
            environmental_factors,
            solar_modules!inner(id,sku,brand,model,watts,installed_price_mxn,product_warranty_years,performance_warranty_years),
            solar_inverters(id,sku,brand,model,inverter_type,ac_capacity_kw,phases,warranty_years)
          `)
          .eq('status', 'published')
          .single(),
      ]);

    if (zoneError || !zone) {
      throw new RequestError(422, 'ZONE_NOT_AVAILABLE', 'La zona todavía no está disponible.');
    }
    if (configError || !config) {
      throw new RequestError(
        503,
        'QUOTE_CONFIG_UNAVAILABLE',
        'El cotizador está temporalmente en configuración.',
      );
    }
    if (
      !['per_watt', 'per_panel'].includes(config.price_mode) ||
      (config.price_mode === 'per_watt' && !config.price_per_watt_mxn)
    ) {
      throw new RequestError(
        503,
        'UNSUPPORTED_PRICE_MODE',
        'La configuración publicada requiere revisión.',
      );
    }

    let moduleData = Array.isArray(config.solar_modules)
      ? config.solar_modules[0]
      : config.solar_modules;
    if (preferredPanelWatts && Number(moduleData?.watts) !== preferredPanelWatts) {
      const { data: selectedModule, error: selectedModuleError } = await supabase
        .from('solar_modules')
        .select(
          'id,sku,brand,model,watts,installed_price_mxn,product_warranty_years,performance_warranty_years',
        )
        .eq('watts', preferredPanelWatts)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (selectedModuleError || !selectedModule) {
        throw new RequestError(
          422,
          'PANEL_NOT_AVAILABLE',
          'La potencia seleccionada todavía no está disponible.',
        );
      }
      moduleData = selectedModule;
    }
    if (!moduleData?.watts) {
      throw new RequestError(503, 'MODULE_UNAVAILABLE', 'No hay un panel configurado.');
    }
    if (config.price_mode === 'per_panel' && !moduleData.installed_price_mxn) {
      throw new RequestError(
        503,
        'PANEL_PRICE_UNAVAILABLE',
        'El panel seleccionado aún no tiene precio interno.',
      );
    }

    const calculationPeriods = periods.map((period) => ({
      kwh: period.kwh,
      amountMxn: period.amount_mxn,
      ...(period.covered_days !== null
        ? { coveredDays: period.covered_days }
        : { coveredMonths: period.covered_months! }),
    }));

    const result = calculatePreliminaryQuote({
      periods: calculationPeriods,
      tariffCode,
      panelWatts: Number(moduleData.watts),
      peakSunHoursPerDay: Number(zone.peak_sun_hours_per_day),
      performanceRatio: Number(zone.performance_ratio),
      coverageTarget: Number(config.coverage_target),
      pricingMode: config.price_mode,
      ...(config.price_mode === 'per_panel'
        ? { pricePerPanelMxn: Number(moduleData.installed_price_mxn) }
        : { pricePerWattMxn: Number(config.price_per_watt_mxn) }),
      priceIncludesVat: config.price_includes_vat,
      vatRate: Number(config.vat_rate),
      nonOffsettableAnnualChargesMxn: Number(
        config.non_offsettable_annual_charges_mxn,
      ),
      savingsRealizationFactor: Number(config.savings_realization_factor),
      tariffEscalationRate: Number(config.tariff_escalation_rate),
      annualPanelDegradationRate: Number(config.annual_panel_degradation_rate),
      projectionYears: Number(config.projection_years),
    });

    let storagePath: string | null = null;
    if (receiptFile && extension) {
      storagePath = `${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(storagePath, receiptFile, {
          contentType: receiptFile.type,
          upsert: false,
          cacheControl: '3600',
        });
      if (uploadError) {
        throw new RequestError(
          503,
          'RECEIPT_UPLOAD_FAILED',
          'No pudimos guardar el recibo. Intenta nuevamente.',
        );
      }
    }

    const expiresAt = new Date(now);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 15);
    const confidenceMap = { low: 'baja', medium: 'media', high: 'alta' };

    const receiptPayload = {
      ...receiptPayloadBase,
      storage_path: storagePath,
      mime_type: receiptFile?.type ?? null,
    };

    const configurationSnapshot = {
      calculationVersion: CALCULATION_VERSION,
      zone,
      config: {
        ...config,
        solar_modules: moduleData,
      },
    };
    const inputSnapshot = {
      tariffCode,
      billingFrequency,
      captureMethod,
      periods,
      propertyType: receiptPayload.property_type,
      roofType: receiptPayload.roof_type,
      preferredPanelWatts,
    };
    const quotePayload = {
      zone_id: zone.id,
      config_id: config.id,
      expires_at: expiresAt.toISOString(),
      status: 'preliminar',
      confidence:
        confidenceMap[result.confidence as keyof typeof confidenceMap] ?? 'baja',
      calculation_version: CALCULATION_VERSION,
      configuration_snapshot: configurationSnapshot,
      input_snapshot: inputSnapshot,
      result_snapshot: result,
      total_mxn: result.totalMxn,
      pdf_storage_path: null,
      requires_engineering_review: result.requiresEngineeringReview,
    };

    const { data: persisted, error: persistError } = await supabase.rpc(
      'create_solar_quote_record',
      {
        p_lead: leadPayload,
        p_receipt: receiptPayload,
        p_periods: periods,
        p_quote: quotePayload,
      },
    );

    if (persistError || !persisted?.[0]) {
      if (storagePath) {
        await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath]);
      }
      console.error('solar_quote_persist_failed', persistError?.code ?? 'unknown');
      throw new RequestError(
        503,
        'QUOTE_SAVE_FAILED',
        'No pudimos guardar la estimación. Intenta nuevamente.',
      );
    }

    const record = persisted[0];
    const publicResult = {
      folio: record.folio,
      quoteId: record.quote_id,
      panelCount: result.panelCount,
      systemDcKw: result.systemDcKw,
      annualGenerationKwh: result.annualGenerationKwh,
      estimatedCoverage: result.estimatedCoverage,
      totalMxn: result.totalMxn,
      yearOneSavingsMxn: result.yearOneSavingsMxn,
      simplePaybackYears: result.simplePaybackYears,
      confidence: quotePayload.confidence,
      requiresEngineeringReview: result.requiresEngineeringReview,
      warnings: result.warnings,
      expiresAt: expiresAt.toISOString(),
    };

    return new Response(JSON.stringify({ quote: publicResult }), {
      status: 201,
      headers,
    });
  } catch (error) {
    const requestError =
      error instanceof RequestError
        ? error
        : new RequestError(
            500,
            'INTERNAL_ERROR',
            'Ocurrió un error. Intenta nuevamente.',
          );
    if (!(error instanceof RequestError)) {
      console.error('solar_quote_unhandled_error', error instanceof Error ? error.name : 'unknown');
    }
    const headers = origin ? responseHeaders(origin) : { 'Content-Type': 'application/json' };
    return new Response(
      JSON.stringify({
        error: { code: requestError.code, message: requestError.message },
      }),
      { status: requestError.status, headers },
    );
  }
});

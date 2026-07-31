/**
 * Deterministic parser for text extracted from a standard CFE receipt.
 *
 * This module does not perform OCR. It receives the text layer from a PDF or
 * the output of an OCR provider, then normalizes the fields used by the solar
 * quote engine. Every extracted value must still be confirmed before issuing
 * a commercial proposal.
 */

const SPANISH_MONTHS = new Map([
  ['ENE', 0],
  ['FEB', 1],
  ['MAR', 2],
  ['ABR', 3],
  ['MAY', 4],
  ['JUN', 5],
  ['JUL', 6],
  ['AGO', 7],
  ['SEP', 8],
  ['OCT', 9],
  ['NOV', 10],
  ['DIC', 11],
]);

function normalizeText(rawText) {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new TypeError('rawText must contain extracted CFE receipt text');
  }

  return rawText
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n?/g, '\n');
}
function parseLocalizedNumber(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function toIsoDate(day, month, shortYear) {
  const monthIndex = SPANISH_MONTHS.get(String(month).toUpperCase());
  if (monthIndex === undefined) return null;

  const numericYear = Number(shortYear);
  const year = numericYear < 100 ? 2000 + numericYear : numericYear;
  const date = new Date(Date.UTC(year, monthIndex, Number(day)));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseDateLabel(label) {
  const match = String(label)
    .trim()
    .match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚ]{3})\s+(\d{2,4})$/i);
  return match ? toIsoDate(match[1], match[2], match[3]) : null;
}

function coveredDays(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return null;
  const start = Date.parse(`${periodStart}T00:00:00Z`);
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86_400_000);
}

function inferPeriodicity(periods) {
  const durations = periods
    .map((period) => coveredDays(period.periodStart, period.periodEnd))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (durations.length === 0) return 'unknown';

  const median = durations[Math.floor(durations.length / 2)];
  if (median >= 20 && median <= 40) return 'monthly';
  if (median >= 45 && median <= 75) return 'bimonthly';
  return 'unknown';
}

function parseCustomerName(text) {
  const headerMatch =
    text.match(/Ciudad\s+de\s+M[eé]xico\.?\s*\n\s*([^\n]{3,120})/i) ??
    text.match(
      /Ciudad\s+de\s+M[eé]xico\.?\s+([A-ZÁÉÍÓÚÑ'’-]{2,}(?:\s+[A-ZÁÉÍÓÚÑ'’-]{2,}){1,5})(?=\s+\d{1,5}\s)/,
    );
  const fallbackMatch =
    text.match(
      /(?:^|\n)\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'’-]{2,}(?:\s+[A-ZÁÉÍÓÚÑ](?:[A-ZÁÉÍÓÚÑ'’-]{1,})?){1,5})\s*\n\s*(?:AND|AV\.?|CALLE|EJ\.?|INF\.?|BLVD\.?|COL\.?)/i,
    );
  if (!headerMatch && !fallbackMatch) return null;

  const candidate = (headerMatch?.[1] ?? fallbackMatch?.[1])
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !candidate ||
    /\b(CFE|COMISI[ÓO]N|CALLE|AV\.?|COL\.?|C\.?P\.?|RFC)\b/i.test(candidate) ||
    /\d{3,}/.test(candidate)
  ) {
    return null;
  }

  return candidate
    .toLocaleLowerCase('es-MX')
    .replace(/(^|[\s'-])([\p{L}])/gu, (_, separator, letter) =>
      `${separator}${letter.toLocaleUpperCase('es-MX')}`,
    );
}

function parseCurrentPeriod(text) {
  const periodMatch = text.match(
    /PERIODO\s+FACTURADO:\s*(\d{1,2}\s+[A-ZÁÉÍÓÚ]{3}\s+\d{2,4})\s*-\s*(\d{1,2}\s+[A-ZÁÉÍÓÚ]{3}\s+\d{2,4})/i,
  );
  const energyMatch =
    text.match(/Energ[ií]a\s*\(kWh\)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/i) ??
    text.match(
      /Energ[ií]a\s*\(kWh\)[\s\S]{0,700}?-1-\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+Suministro/i,
    );
  const invoiceMatch = text.match(/Fac\.\s*del\s*Periodo\s+\$?\s*([\d,.]+)/i);

  if (!periodMatch || !energyMatch) return null;

  return {
    periodStart: parseDateLabel(periodMatch[1]),
    periodEnd: parseDateLabel(periodMatch[2]),
    kwh: parseLocalizedNumber(energyMatch[3]),
    amountMxn: parseLocalizedNumber(invoiceMatch?.[1]),
    source: 'cfe_current_period',
  };
}

function parseHistory(text) {
  const history = [];
  const rowPattern =
    /del\s+(\d{1,2}\s+[A-ZÁÉÍÓÚ]{3}\s+\d{2,4})\s+al\s+(\d{1,2}\s+[A-ZÁÉÍÓÚ]{3}\s+\d{2,4})\s+([\d,.]+)\s+\$?\s*([\d,.]+)(?:\s+\$?\s*[\d,.]+)?/gi;

  for (const match of text.matchAll(rowPattern)) {
    history.push({
      periodStart: parseDateLabel(match[1]),
      periodEnd: parseDateLabel(match[2]),
      kwh: parseLocalizedNumber(match[3]),
      amountMxn: parseLocalizedNumber(match[4]),
      source: 'cfe_consumption_history',
    });
  }

  return history;
}

function asCalculationPeriod(period, periodicity) {
  const duration =
    periodicity === 'monthly'
      ? { coveredMonths: 1 }
      : periodicity === 'bimonthly'
        ? { coveredMonths: 2 }
        : { coveredDays: coveredDays(period.periodStart, period.periodEnd) };

  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    kwh: period.kwh,
    amountMxn: period.amountMxn ?? 0,
    ...duration,
    source: period.source,
  };
}

/**
 * @param {string} rawText Text layer or OCR result from a CFE receipt.
 */
export function parseCfeReceiptText(rawText) {
  const text = normalizeText(rawText);
  const warnings = [];

  const customerName = parseCustomerName(text);
  const serviceNumber =
    text.match(/NO\.\s*DE\s*SERVICIO:\s*(\d{10,})/i)?.[1] ?? null;
  const rmu = text.match(/RMU:\s*([A-Z0-9 -]{10,}?)(?=\s*CUENTA:|\n)/i)?.[1]?.trim() ?? null;
  const meterNumber =
    text.match(/NO\.\s*MEDIDOR:\s*([A-Z0-9-]+)/i)?.[1] ?? null;
  const tariffCode =
    text.match(/TARIFA:\s*([A-Z0-9]+?)(?=\s*NO\.\s*MEDIDOR:|\s|\n)/i)?.[1]?.toUpperCase() ??
    null;
  const totalDueMxn = parseLocalizedNumber(
    text.match(/TOTAL\s+A\s+PAGAR:\s*\$?\s*([\d,.]+)/i)?.[1],
  );

  const currentPeriod = parseCurrentPeriod(text);
  const history = parseHistory(text);
  const allDetectedPeriods = [...(currentPeriod ? [currentPeriod] : []), ...history];
  const periodicity = inferPeriodicity(allDetectedPeriods);
  const expectedPeriodCount = periodicity === 'monthly' ? 12 : periodicity === 'bimonthly' ? 6 : null;
  const selectedPeriods = expectedPeriodCount
    ? allDetectedPeriods.slice(0, expectedPeriodCount)
    : allDetectedPeriods;
  const periods = selectedPeriods.map((period) =>
    asCalculationPeriod(period, periodicity),
  );

  if (!currentPeriod) warnings.push('CURRENT_PERIOD_NOT_FOUND');
  if (history.length === 0) warnings.push('CONSUMPTION_HISTORY_NOT_FOUND');
  if (!tariffCode) warnings.push('TARIFF_NOT_FOUND');
  if (!serviceNumber) warnings.push('SERVICE_NUMBER_NOT_FOUND');
  if (periodicity === 'unknown') warnings.push('PERIODICITY_NOT_CONFIRMED');
  if (expectedPeriodCount && periods.length < expectedPeriodCount) {
    warnings.push('INCOMPLETE_TWELVE_MONTH_HISTORY');
  }
  if (periods.some((period) => !Number.isFinite(period.kwh) || period.kwh <= 0)) {
    warnings.push('INVALID_CONSUMPTION_VALUE');
  }

  const annualConsumptionKwh = periods.reduce((sum, period) => sum + period.kwh, 0);
  const annualObservedBillMxn = periods.reduce(
    (sum, period) => sum + period.amountMxn,
    0,
  );
  const highConfidence =
    warnings.length === 0 &&
    expectedPeriodCount !== null &&
    periods.length === expectedPeriodCount;

  return {
    documentType: 'cfe_receipt',
    customerName,
    serviceNumber,
    rmu,
    meterNumber,
    tariffCode,
    totalDueMxn,
    periodicity,
    periods,
    historyDetected: history,
    annualConsumptionKwh,
    annualObservedBillMxn,
    confidence: highConfidence ? 'high' : periods.length >= 2 ? 'medium' : 'low',
    requiresConfirmation: true,
    warnings,
  };
}

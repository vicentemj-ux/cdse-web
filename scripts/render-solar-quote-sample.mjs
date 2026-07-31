import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createSolarQuotePdf } from '../src/lib/solar/quote-pdf.js';

const root = resolve(import.meta.dirname, '..');
const dataUrl = async (path) => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;

const quote = {
  id: 'sample-quote',
  folio: 'CDSE-S-000002',
  created_at: '2026-07-31T12:00:00.000Z',
  panel_count: 8,
  total_mxn: 72000,
  solar_leads: {
    name: 'Ruiz Rojas Raul Ivan',
    phone_e164: '+526681234567',
    email: 'cliente@ejemplo.com',
    municipality: 'Los Mochis',
  },
  solar_modules: { brand: 'Panel solar', model: 'Monofacial', watts: 550 },
  input_snapshot: { annualConsumptionKwh: 6840, tariffCode: '1F' },
  result_snapshot: {
    panelCount: 8,
    systemDcKw: 4.4,
    annualGenerationKwh: 7066.4,
    estimatedCoverage: 1.033,
    package: { name: 'Paquete base 8 paneles - 550 W', panelCount: 8, priceMxn: 72000 },
    financing: { name: 'Credito 12 meses sin intereses', downPaymentMxn: 36000, installments: 12 },
  },
  solar_receipts: {
    tariff_code: '1F',
    service_number: '538190702201',
    solar_consumption_periods: [
      { sequence: 1, period_start: '2025-07-01', period_end: '2025-08-31', covered_months: 2, kwh: 1260, amount_mxn: 3420 },
      { sequence: 2, period_start: '2025-09-01', period_end: '2025-10-31', covered_months: 2, kwh: 1080, amount_mxn: 2860 },
      { sequence: 3, period_start: '2025-11-01', period_end: '2025-12-31', covered_months: 2, kwh: 820, amount_mxn: 2150 },
      { sequence: 4, period_start: '2026-01-01', period_end: '2026-02-28', covered_months: 2, kwh: 760, amount_mxn: 1970 },
      { sequence: 5, period_start: '2026-03-01', period_end: '2026-04-30', covered_months: 2, kwh: 1160, amount_mxn: 3180 },
      { sequence: 6, period_start: '2026-05-01', period_end: '2026-06-30', covered_months: 2, kwh: 1760, amount_mxn: 4820 },
    ],
  },
};

const doc = await createSolarQuotePdf(quote, {
  logoData: await dataUrl(resolve(root, 'public/cdse-solar-logo-cropped.png')),
  ciaeData: await dataUrl(resolve(root, 'public/ciae-certificado.png')),
});

const outputDir = resolve(root, 'output/pdf');
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, 'cdse-solar-propuesta-muestra.pdf');
await writeFile(outputPath, Buffer.from(doc.output('arraybuffer')));
process.stdout.write(`${outputPath}\n`);

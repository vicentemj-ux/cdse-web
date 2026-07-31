import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCfeReceiptText } from '../src/lib/solar/cfe-receipt-parser.mjs';

const RECEIPT_TEXT = `
TOTAL A PAGAR:
$3,174
Comisión Federal de Electricidad
Av. Paseo de la Reforma 164, Col. Juárez,
Ciudad de México.
PERSONA CLIENTE DE PRUEBA
CALLE DE PRUEBA 100
NO. DE SERVICIO:123456789012
RMU:81304 00-00-00 XAXX-010101 000 CFE
CUENTA:00AA00A000000000
TARIFA:PDBTNO. MEDIDOR:TEST00
PERIODO FACTURADO:07 MAY 26-09 JUL 26
Concepto Lectura actual Lectura anterior Total Precio Subtotal
Energía (kWh) 13,799 12,982 817
Fac. del Periodo 3,174.22
Adeudo Anterior 1,401.07
Total 3,174.29
CONSUMO HISTÓRICO
del 06 MAR 26 al 07 MAY 26 349 $1,401.00 $1,401.00
del 08 ENE 26 al 06 MAR 26 84 $372.00 $372.00
del 07 NOV 25 al 08 ENE 26 116 $643.00 $643.00
del 08 SEP 25 al 07 NOV 25 577 $2,617.00 $2,617.00
del 08 JUL 25 al 08 SEP 25 876 $3,902.00 $3,902.00
del 08 MAY 25 al 08 JUL 25 648 $2,900.00 $2,900.00
del 07 MAR 25 al 08 MAY 25 107 $622.00 $622.00
`;

test('extracts the rolling twelve-month basis from a bimonthly CFE receipt', () => {
  const result = parseCfeReceiptText(RECEIPT_TEXT);

  assert.equal(result.customerName, 'Persona Cliente De Prueba');
  assert.equal(result.tariffCode, 'PDBT');
  assert.equal(result.serviceNumber, '123456789012');
  assert.equal(result.meterNumber, 'TEST00');
  assert.equal(result.periodicity, 'bimonthly');
  assert.equal(result.periods.length, 6);
  assert.deepEqual(
    result.periods.map((period) => period.kwh),
    [817, 349, 84, 116, 577, 876],
  );
  assert.equal(result.annualConsumptionKwh, 2819);
  assert.equal(result.annualObservedBillMxn, 12109.22);
  assert.equal(result.confidence, 'high');
  assert.equal(result.requiresConfirmation, true);
});

test('uses the current invoice amount instead of debt or the payment balance', () => {
  const result = parseCfeReceiptText(RECEIPT_TEXT);

  assert.equal(result.periods[0].amountMxn, 3174.22);
  assert.equal(result.totalDueMxn, 3174);
});

test('warns when only a partial history is available', () => {
  const partialText = RECEIPT_TEXT.split('del 08 ENE 26')[0];
  const result = parseCfeReceiptText(partialText);

  assert.equal(result.confidence, 'medium');
  assert.ok(result.warnings.includes('INCOMPLETE_TWELVE_MONTH_HISTORY'));
});

test('reads an inline customer name and a noisy PDF text layer', () => {
  const noisyText = RECEIPT_TEXT
    .replace(
      'Ciudad de México.\nPERSONA CLIENTE DE PRUEBA\nCALLE DE PRUEBA 100',
      'Ciudad de México. PERSONA CLIENTE DE PRUEBA 100 DE MAYO',
    )
    .replace(
      'Energía (kWh) 13,799 12,982 817',
      'Energía (kWh) texto de impresión 000003174 -1- 13,799 12,982 817 Suministro',
    );
  const result = parseCfeReceiptText(noisyText);

  assert.equal(result.customerName, 'Persona Cliente De Prueba');
  assert.equal(result.periods[0].kwh, 817);
  assert.equal(result.annualConsumptionKwh, 2819);
});

test('reads the CFE header name when OCR places it above the address', () => {
  const result = parseCfeReceiptText(`
CONTRERAS G L JAVIER
EJ MATACAHUIY EL AGUILA AZTECA
NO. DE SERVICIO:538910105151
`);

  assert.equal(result.customerName, 'Contreras G L Javier');
  assert.equal(result.serviceNumber, '538910105151');
});

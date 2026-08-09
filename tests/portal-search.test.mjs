import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPortalSearchIndex, normalizePortalSearch, searchPortalIndex } from '../src/lib/solar/portal-search.mjs';

const data = {
  projects: [{ id: 'p1', folio: 'CDSE-P-000021', customer_name: 'José Núñez', service_number: '538910105451', solar_quotes: { folio: 'CDSE-S-000033' }, solar_assets: [{ id: 'a1', serial_number: 'GRW-9X77', manufacturer: 'Growatt', model: 'MIN 6000' }] }],
  quotes: [{ id: 'q1', folio: 'CDSE-S-000033', solar_leads: { name: 'José Núñez', phone_e164: '+526681234567' } }],
  cfeCases: [{ id: 'c1', project_id: 'p1', tracking_folio: 'CFE-AHO-8891', solar_projects: { folio: 'CDSE-P-000021', customer_name: 'José Núñez' }, bidirectional_meter_serial: 'BD-7744' }],
  leads: [{ id: 'l1', name: 'María López', phone_e164: '+526689998877', municipality: 'Ahome' }],
  inventorySerials: [{ id: 's1', serial_number: 'MOD-CDSE-001', status: 'reserved', project_id: 'p1', solar_inventory_items: { sku: 'CS-550', name: 'Canadian Solar 550 W' }, solar_projects: { folio: 'CDSE-P-000021', customer_name: 'José Núñez' } }],
};

test('normaliza acentos, símbolos y mayúsculas para búsqueda tolerante', () => {
  assert.equal(normalizePortalSearch(' José  Núñez / CFE '), 'jose nunez cfe');
});

test('encuentra proyecto por servicio y cotización por teléfono', () => {
  const index = buildPortalSearchIndex(data);
  assert.equal(searchPortalIndex(index, '538910105451')[0].type, 'project');
  assert.equal(searchPortalIndex(index, '6681234567')[0].type, 'quote');
});

test('encuentra CFE y activos por folio o serie y conserva el proyecto destino', () => {
  const index = buildPortalSearchIndex(data);
  assert.equal(searchPortalIndex(index, 'AHO 8891')[0].type, 'cfe');
  const asset = searchPortalIndex(index, 'grw 9x77')[0];
  assert.equal(asset.type, 'asset');
  assert.equal(asset.projectId, 'p1');
});

test('no muestra resultados con consultas accidentales de un carácter', () => {
  assert.deepEqual(searchPortalIndex(buildPortalSearchIndex(data), 'c'), []);
});

test('encuentra una serie todavía administrada por almacén', () => {
  const result = searchPortalIndex(buildPortalSearchIndex(data), 'MOD-CDSE-001')[0];
  assert.equal(result.type, 'serial');
  assert.equal(result.view, 'inventory');
  assert.equal(result.projectId, 'p1');
});

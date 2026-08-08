import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectManifest } from '../src/lib/solar/project-documents.js';

function project(overrides = {}) {
  return {
    id: 'project-1',
    folio: 'CDSE-P-000001',
    customer_name: 'Cliente de prueba',
    service_number: '123456789012',
    status: 'engineering',
    solar_quotes: { folio: 'CDSE-S-000001' },
    solar_site_surveys: [{ version: 1, status: 'approved' }],
    solar_engineering_revisions: [{ version: 1, status: 'approved' }],
    solar_project_checklist_items: [
      { item_code: 'accepted_quote', title: 'Cotización', stage: 'commercial', required: true, status: 'complete' },
      { item_code: 'single_line_diagram', title: 'Diagrama unifilar', stage: 'engineering', required: true, status: 'complete' },
      { item_code: 'cfe_acknowledgement', title: 'Acuse CFE', stage: 'cfe', required: true, status: 'pending' },
    ],
    solar_project_documents: [{
      id: 'document-1',
      document_code: 'single_line_diagram',
      title: 'Diagrama unifilar',
      status: 'approved',
      version: 2,
      reviewed_at: '2026-08-08T12:00:00Z',
      solar_document_requirements: { stage: 'engineering', requirement_scope: 'regulatory' },
      solar_project_document_files: [{
        id: 'file-1',
        original_name: 'unifilar.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1234,
        storage_path: 'project-1/unifilar.pdf',
        created_at: '2026-08-08T11:00:00Z',
      }],
    }],
    ...overrides,
  };
}

test('dossier readiness ignores the future CFE acknowledgement', () => {
  const manifest = buildProjectManifest(project());
  assert.equal(manifest.readiness.siteSurveyApproved, true);
  assert.equal(manifest.readiness.engineeringApproved, true);
  assert.equal(manifest.readiness.missingBaseDocumentCount, 0);
  assert.equal(manifest.readiness.readyForCfe, true);
});

test('dossier manifest preserves document versions and private storage references', () => {
  const manifest = buildProjectManifest(project());
  assert.equal(manifest.documents[0].version, 2);
  assert.equal(manifest.documents[0].scope, 'regulatory');
  assert.deepEqual(manifest.documents[0].files[0], {
    id: 'file-1',
    originalName: 'unifilar.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1234,
    storagePath: 'project-1/unifilar.pdf',
    createdAt: '2026-08-08T11:00:00Z',
  });
});

test('dossier remains blocked when a required base document is incomplete', () => {
  const base = project();
  base.solar_project_checklist_items.push({
    item_code: 'inverter_certificate',
    title: 'Certificado del inversor',
    stage: 'engineering',
    required: true,
    status: 'pending',
  });
  const manifest = buildProjectManifest(base);
  assert.equal(manifest.readiness.missingBaseDocumentCount, 1);
  assert.equal(manifest.readiness.readyForCfe, false);
});

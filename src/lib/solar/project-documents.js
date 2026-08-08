const COLORS = {
  navy: '#071f38',
  blue: '#1266a0',
  amber: '#e9a91b',
  teal: '#078f88',
  green: '#24845d',
  ink: '#10263e',
  slate: '#62758a',
  line: '#d8e2ea',
  mist: '#f2f6f8',
  paper: '#fbfcfa',
  white: '#ffffff',
  danger: '#a43d2f',
};

const STAGE_LABELS = {
  commercial: '01_Comercial',
  site_survey: '02_Levantamiento',
  engineering: '03_Ingenieria',
  cfe: '04_CFE',
  installation: '05_Instalacion',
  handover: '06_Entrega',
};

const STAGE_TITLES = {
  commercial: 'Comercial y cliente',
  site_survey: 'Levantamiento técnico',
  engineering: 'Ingeniería',
  cfe: 'Interconexión CFE',
  installation: 'Instalación',
  handover: 'Entrega y puesta en marcha',
};

const STATUS_LABELS = {
  missing: 'Pendiente',
  requested: 'Solicitado',
  uploaded: 'Por revisar',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  not_applicable: 'No aplica',
  expired: 'Vencido',
  draft: 'Borrador',
  submitted: 'En revisión',
};

const ROOF_LABELS = {
  concrete_slab: 'Losa de concreto',
  metal_sheet: 'Lámina metálica',
  tile: 'Teja',
  ground: 'Montaje en suelo',
  other: 'Otro',
};

const CONDITION_LABELS = {
  good: 'Bueno / apto',
  fair: 'Requiere atención',
  poor: 'No apto sin corrección',
  requires_adjustment: 'Requiere adecuación',
  requires_replacement: 'Requiere reemplazo',
};

const SERVICE_LABELS = {
  single_phase: 'Monofásico',
  two_phase: 'Bifásico',
  three_phase: 'Trifásico',
};

const SHADING_LABELS = {
  none: 'Sin sombras',
  low: 'Bajas',
  moderate: 'Moderadas',
  high: 'Altas',
};

function clean(value, fallback = 'Por confirmar') {
  const text = String(value ?? '').trim();
  return (text || fallback).replace(/[·–—‑]/g, '-');
}

function safeFilename(value, fallback = 'archivo') {
  return clean(value, fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140) || fallback;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function setColor(doc, hex, stroke = false) {
  const rgb = hexToRgb(hex);
  if (stroke) doc.setDrawColor(...rgb);
  else doc.setTextColor(...rgb);
}

function fill(doc, hex) {
  doc.setFillColor(...hexToRgb(hex));
}

function drawText(doc, value, x, y, options = {}) {
  const {
    size = 9,
    weight = 'normal',
    tone = COLORS.ink,
    maxWidth,
    align = 'left',
    lineHeight = 1.25,
  } = options;
  doc.setFont('helvetica', weight);
  doc.setFontSize(size);
  doc.setLineHeightFactor(lineHeight);
  setColor(doc, tone);
  const content = maxWidth ? doc.splitTextToSize(clean(value, ''), maxWidth) : clean(value, '');
  doc.text(content, x, y, { align });
  return Array.isArray(content) ? content.length : 1;
}

function drawLine(doc, x1, y1, x2, y2, hex = COLORS.line, width = 0.25) {
  setColor(doc, hex, true);
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
}

function drawBox(doc, x, y, width, height, background, radius = 2, border = null) {
  fill(doc, background);
  setColor(doc, border ?? background, true);
  doc.roundedRect(x, y, width, height, radius, radius, border ? 'FD' : 'F');
}

async function urlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function loadAssets(provided = {}) {
  const logoData = provided.logoData !== undefined
    ? provided.logoData
    : await urlToDataUrl('/cdse-solar-logo-cropped.png').catch(() => null);
  return { logoData };
}

function projectFolio(project) {
  return clean(project?.folio, 'CDSE-PROYECTO');
}

function projectAddress(project) {
  const address = project?.site_address ?? {};
  return clean([
    address.street ?? address.address,
    address.colony,
    address.city ?? address.municipality,
    address.state,
    address.postalCode ?? address.postal_code,
  ].filter(Boolean).join(', '), 'Domicilio del servicio por confirmar');
}

function dateTime(value, fallback = 'Por confirmar') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return fallback;
  return date.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });
}

function boolLabel(value) {
  if (value == null) return 'Por confirmar';
  return value ? 'Sí' : 'No';
}

function latest(items = []) {
  return [...items].sort((a, b) => Number(b.version) - Number(a.version))[0];
}

function approved(items = []) {
  return [...items]
    .filter((item) => item.status === 'approved')
    .sort((a, b) => Number(b.version) - Number(a.version))[0];
}

function addDocumentChrome(doc, assets, project, page, total, section) {
  fill(doc, COLORS.navy);
  doc.rect(0, 0, 210, 29, 'F');
  fill(doc, COLORS.amber);
  doc.rect(0, 29, 210, 1.2, 'F');
  if (assets.logoData) {
    doc.addImage(assets.logoData, 'PNG', 14, 7, 49, 14, `project-logo-${page}`, 'FAST');
  } else {
    drawText(doc, 'CDSE SOLAR', 14, 17, { size: 15, weight: 'bold', tone: COLORS.white });
  }
  drawText(doc, section.toUpperCase(), 196, 12, { size: 6.5, weight: 'bold', tone: '#bfd0dd', align: 'right' });
  drawText(doc, projectFolio(project), 196, 20, { size: 10.5, weight: 'bold', tone: COLORS.white, align: 'right' });

  fill(doc, COLORS.navy);
  doc.rect(0, 280, 210, 17, 'F');
  fill(doc, COLORS.amber);
  doc.rect(0, 280, 210, 1.1, 'F');
  drawText(doc, 'Calle Morelos #209 Ote. | Col. Centro | Los Mochis, Sinaloa.', 14, 288, { size: 6.1, tone: COLORS.white });
  drawText(doc, 'Tel: 668.1774845 | cdse.com.mx/solar', 14, 293, { size: 5.8, tone: '#bfd0dd' });
  drawText(doc, `${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, 196, 292, { size: 6.5, weight: 'bold', tone: COLORS.white, align: 'right' });
}

function drawTitle(doc, eyebrow, title, detail) {
  drawText(doc, eyebrow, 14, 43, { size: 7, weight: 'bold', tone: COLORS.amber });
  drawText(doc, title, 14, 56, { size: 23, weight: 'bold', tone: COLORS.navy });
  drawText(doc, detail, 14, 66, { size: 8, tone: COLORS.slate, maxWidth: 174 });
}

function drawMetaStrip(doc, project, y = 76) {
  drawBox(doc, 14, y, 182, 25, COLORS.mist, 2, COLORS.line);
  const cells = [
    ['CLIENTE', project.customer_name],
    ['SERVICIO CFE', project.service_number],
    ['FECHA DE EMISIÓN', new Date().toLocaleDateString('es-MX')],
  ];
  cells.forEach(([label, value], index) => {
    const x = 20 + index * 59;
    drawText(doc, label, x, y + 8, { size: 5.7, weight: 'bold', tone: COLORS.slate });
    drawText(doc, value, x, y + 17, { size: 8.5, weight: 'bold', tone: COLORS.navy, maxWidth: 51 });
  });
}

function drawFieldRow(doc, y, leftLabel, leftValue, rightLabel, rightValue) {
  if (Math.round(y) % 2 === 0) {
    fill(doc, COLORS.mist);
    doc.rect(14, y, 182, 10, 'F');
  }
  drawText(doc, leftLabel, 18, y + 4.2, { size: 5.7, weight: 'bold', tone: COLORS.slate });
  drawText(doc, leftValue, 18, y + 8.2, { size: 7.2, weight: 'bold', tone: COLORS.ink, maxWidth: 78 });
  drawText(doc, rightLabel, 108, y + 4.2, { size: 5.7, weight: 'bold', tone: COLORS.slate });
  drawText(doc, rightValue, 108, y + 8.2, { size: 7.2, weight: 'bold', tone: COLORS.ink, maxWidth: 78 });
}

function drawNoteBlock(doc, y, title, value, height = 35) {
  drawText(doc, title.toUpperCase(), 14, y, { size: 7, weight: 'bold', tone: COLORS.navy });
  drawBox(doc, 14, y + 4, 182, height, COLORS.mist, 2, COLORS.line);
  drawText(doc, value, 20, y + 13, { size: 7.2, tone: COLORS.ink, maxWidth: 170, lineHeight: 1.35 });
}

function newPdf(jsPDF, title, subject) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title, subject, author: 'CDSE Solar', creator: 'Portal operativo CDSE Solar' });
  return doc;
}

export function buildProjectManifest(project) {
  const surveys = project.solar_site_surveys ?? [];
  const engineering = project.solar_engineering_revisions ?? [];
  const documents = project.solar_project_documents ?? [];
  const required = (project.solar_project_checklist_items ?? []).filter((item) => item.required);
  const missingBase = required.filter((item) => (
    ['commercial', 'site_survey', 'engineering', 'cfe'].includes(item.stage)
    && item.item_code !== 'cfe_acknowledgement'
    && item.status !== 'complete'
  ));
  const surveyApproved = surveys.some((item) => item.status === 'approved');
  const engineeringApproved = engineering.some((item) => item.status === 'approved');
  return {
    format: 'CDSE-SOLAR-DOSSIER-1',
    generatedAt: new Date().toISOString(),
    confidentiality: 'Expediente privado. Contiene datos personales y técnicos; compartir sólo con personal autorizado y la autoridad competente.',
    project: {
      id: project.id,
      folio: project.folio,
      quoteFolio: project.solar_quotes?.folio ?? null,
      customerName: project.customer_name,
      serviceNumber: project.service_number ?? null,
      status: project.status,
      cfeTrackingFolio: project.cfe_tracking_folio ?? null,
    },
    readiness: {
      siteSurveyApproved: surveyApproved,
      engineeringApproved,
      missingBaseDocumentCount: missingBase.length,
      readyForCfe: surveyApproved && engineeringApproved && missingBase.length === 0,
    },
    documents: documents.map((document) => ({
      id: document.id,
      code: document.document_code,
      title: document.title,
      stage: document.solar_document_requirements?.stage ?? 'commercial',
      scope: document.solar_document_requirements?.requirement_scope ?? 'internal',
      status: document.status,
      version: document.version,
      reviewedAt: document.reviewed_at ?? null,
      rejectionReason: document.rejection_reason ?? null,
      files: (document.solar_project_document_files ?? []).map((file) => ({
        id: file.id,
        originalName: file.original_name,
        mimeType: file.mime_type,
        sizeBytes: file.file_size_bytes,
        storagePath: file.storage_path,
        createdAt: file.created_at,
      })),
    })),
  };
}

export async function createSiteSurveyReportPdf(project, providedAssets = {}) {
  const [{ jsPDF }, assets] = await Promise.all([import('jspdf'), loadAssets(providedAssets)]);
  const survey = approved(project.solar_site_surveys) ?? latest(project.solar_site_surveys);
  if (!survey) throw new Error('SITE_SURVEY_REQUIRED');
  const doc = newPdf(jsPDF, `${projectFolio(project)} - Levantamiento técnico`, 'Reporte de visita y condiciones del sitio');

  addDocumentChrome(doc, assets, project, 1, 2, 'Levantamiento técnico');
  drawTitle(doc, 'REPORTE DE CAMPO', 'Condiciones verificadas del sitio.', 'Registro técnico para diseño, instalación y control del expediente solar.');
  drawMetaStrip(doc, project, 75);
  drawBox(doc, 14, 106, 182, 17, survey.status === 'approved' ? COLORS.green : COLORS.amber, 2);
  drawText(doc, survey.status === 'approved' ? 'LEVANTAMIENTO APROBADO' : 'LEVANTAMIENTO PENDIENTE DE APROBACIÓN', 20, 116.5, { size: 9, weight: 'bold', tone: COLORS.white });
  drawText(doc, `VERSIÓN ${survey.version}`, 190, 116.5, { size: 7, weight: 'bold', tone: COLORS.white, align: 'right' });

  drawText(doc, 'DATOS DE LA VISITA Y CUBIERTA', 14, 135, { size: 8, weight: 'bold', tone: COLORS.navy });
  drawLine(doc, 14, 139, 196, 139, COLORS.amber, .6);
  const roofRows = [
    ['FECHA DE VISITA', dateTime(survey.visited_at), 'TÉCNICO', project._profileMap?.[survey.technician_user_id]?.full_name ?? 'Personal CDSE'],
    ['TIPO DE TECHO', ROOF_LABELS[survey.roof_type], 'CONDICIÓN', CONDITION_LABELS[survey.roof_condition] ?? survey.roof_condition],
    ['ÁREA ÚTIL', survey.usable_area_m2 ? `${survey.usable_area_m2} m²` : null, 'SOMBRAS', SHADING_LABELS[survey.shading_level]],
    ['ORIENTACIÓN', survey.orientation_degrees != null ? `${survey.orientation_degrees}°` : null, 'INCLINACIÓN', survey.tilt_degrees != null ? `${survey.tilt_degrees}°` : null],
    ['COORDENADAS', survey.latitude != null && survey.longitude != null ? `${survey.latitude}, ${survey.longitude}` : null, 'DOMICILIO', projectAddress(project)],
  ];
  roofRows.forEach((row, index) => drawFieldRow(doc, 143 + index * 10, ...row));

  drawText(doc, 'SISTEMA ELÉCTRICO Y RUTA', 14, 202, { size: 8, weight: 'bold', tone: COLORS.navy });
  drawLine(doc, 14, 206, 196, 206, COLORS.amber, .6);
  const electricalRows = [
    ['SERVICIO', SERVICE_LABELS[survey.electrical_service], 'VOLTAJE', survey.service_voltage ? `${survey.service_voltage} V` : null],
    ['INTERRUPTOR PRINCIPAL', survey.main_breaker_amps ? `${survey.main_breaker_amps} A` : null, 'TABLERO', CONDITION_LABELS[survey.panelboard_condition] ?? survey.panelboard_condition],
    ['TIERRA FÍSICA', boolLabel(survey.grounding_available), 'MEDIDOR ACCESIBLE', boolLabel(survey.meter_accessible)],
    ['LONGITUD DE RUTA', survey.route_length_m != null ? `${survey.route_length_m} m` : null, 'ESTADO', STATUS_LABELS[survey.status]],
  ];
  electricalRows.forEach((row, index) => drawFieldRow(doc, 210 + index * 10, ...row));
  drawBox(doc, 14, 254, 182, 17, COLORS.navy, 2);
  drawText(doc, survey.status === 'approved' ? 'RESULTADO: APTO PARA CONTINUAR A INGENIERÍA' : 'RESULTADO: REQUIERE REVISIÓN ANTES DE INGENIERÍA', 20, 264.5, { size: 8.5, weight: 'bold', tone: survey.status === 'approved' ? '#bce57e' : COLORS.amber });

  doc.addPage();
  addDocumentChrome(doc, assets, project, 2, 2, 'Observaciones y firmas');
  drawTitle(doc, 'BITÁCORA TÉCNICA', 'Hallazgos que condicionan el diseño.', 'Las notas deben leerse junto con fotografías y evidencias cargadas al expediente.');
  drawNoteBlock(doc, 79, 'Estructura y cubierta', survey.structure_notes, 34);
  drawNoteBlock(doc, 124, 'Instalación eléctrica', survey.electrical_notes, 34);
  drawNoteBlock(doc, 169, 'Riesgos y seguridad', survey.safety_notes, 34);
  drawNoteBlock(doc, 214, 'Observaciones generales', survey.general_notes, 25);
  drawText(doc, 'VALIDACIÓN', 14, 253, { size: 7, weight: 'bold', tone: COLORS.navy });
  drawLine(doc, 14, 269, 87, 269, COLORS.slate, .3);
  drawLine(doc, 109, 269, 182, 269, COLORS.slate, .3);
  drawText(doc, 'Técnico responsable', 14, 274, { size: 6.2, tone: COLORS.slate });
  drawText(doc, survey.status === 'approved' ? `Aprobado ${dateTime(survey.reviewed_at)}` : 'Revisión pendiente', 109, 274, { size: 6.2, tone: COLORS.slate });
  return doc;
}

export async function createAuthorizationLetterPdf(project, providedAssets = {}) {
  const [{ jsPDF }, assets] = await Promise.all([import('jspdf'), loadAssets(providedAssets)]);
  const doc = newPdf(jsPDF, `${projectFolio(project)} - Autorización de representación`, 'Formato condicional para gestión documental ante CFE');
  addDocumentChrome(doc, assets, project, 1, 1, 'Formato condicional');
  drawTitle(doc, 'INTERCONEXIÓN / REPRESENTACIÓN', 'Carta de autorización para gestión.', 'Formato editable de apoyo. Debe validarse contra el procedimiento y oficina CFE que recibirá la solicitud.');
  drawMetaStrip(doc, project, 78);
  drawText(doc, 'Los Mochis, Sinaloa, a ____ de __________________ de ______.', 196, 117, { size: 8, tone: COLORS.ink, align: 'right' });
  drawText(doc, 'A QUIEN CORRESPONDA', 14, 133, { size: 9, weight: 'bold', tone: COLORS.navy });
  drawText(doc, 'COMISIÓN FEDERAL DE ELECTRICIDAD', 14, 140, { size: 8, weight: 'bold', tone: COLORS.navy });
  drawText(doc, `Yo, ${clean(project.customer_name, '________________________________________')}, titular o persona legalmente facultada respecto del servicio eléctrico número ${clean(project.service_number, '____________________')}, ubicado en ${projectAddress(project)}, autorizo a CDSE Solar y al Ing. Vicente Munguía Jaime para presentar, entregar y dar seguimiento a la documentación técnica y administrativa relacionada con la solicitud de interconexión de una central de generación distribuida asociada a dicho centro de carga.`, 14, 157, { size: 9, tone: COLORS.ink, maxWidth: 182, lineHeight: 1.5 });
  drawText(doc, 'La presente autorización comprende la consulta del estado del trámite, recepción de observaciones y entrega de correcciones. No faculta para celebrar contratos, modificar la titularidad del servicio, disponer del inmueble ni asumir obligaciones económicas en nombre del autorizante, salvo autorización expresa y separada.', 14, 195, { size: 9, tone: COLORS.ink, maxWidth: 182, lineHeight: 1.5 });
  drawBox(doc, 14, 222, 182, 22, COLORS.mist, 2, COLORS.line);
  drawText(doc, 'USO CONDICIONAL', 20, 231, { size: 7, weight: 'bold', tone: COLORS.danger });
  drawText(doc, 'La carta poder o autorización no es un requisito universal del expediente. Se utiliza cuando CDSE actúa por el solicitante y debe ajustarse a lo que solicite la oficina receptora.', 20, 238, { size: 6.5, tone: COLORS.slate, maxWidth: 165 });
  drawLine(doc, 18, 263, 89, 263, COLORS.slate, .35);
  drawLine(doc, 121, 263, 192, 263, COLORS.slate, .35);
  drawText(doc, clean(project.customer_name, 'Nombre y firma del autorizante'), 53.5, 269, { size: 6.5, tone: COLORS.slate, align: 'center', maxWidth: 68 });
  drawText(doc, 'Ing. Vicente Munguía Jaime / CDSE Solar', 156.5, 269, { size: 6.5, tone: COLORS.slate, align: 'center', maxWidth: 68 });
  return doc;
}

function statusTone(status) {
  if (status === 'approved') return COLORS.green;
  if (status === 'uploaded' || status === 'submitted') return COLORS.blue;
  if (status === 'rejected' || status === 'expired') return COLORS.danger;
  return COLORS.slate;
}

export async function createDossierIndexPdf(project, providedAssets = {}) {
  const [{ jsPDF }, assets] = await Promise.all([import('jspdf'), loadAssets(providedAssets)]);
  const manifest = buildProjectManifest(project);
  const documents = manifest.documents;
  const totalPages = documents.length <= 11
    ? 1
    : 1 + Math.ceil((documents.length - 11) / 16);
  const doc = newPdf(jsPDF, `${projectFolio(project)} - Índice de expediente`, 'Índice de control documental y preparación para CFE');
  let page = 1;
  let y = 0;

  const startPage = () => {
    addDocumentChrome(doc, assets, project, page, totalPages, 'Índice de expediente');
    drawTitle(doc, 'CONTROL DOCUMENTAL', page === 1 ? 'Expediente solar verificable.' : 'Continuación del expediente.', 'Índice de versiones, estado de revisión y archivos anexos.');
    y = 77;
    if (page === 1) {
      drawMetaStrip(doc, project, y);
      y = 109;
      const gates = [
        ['VISITA', manifest.readiness.siteSurveyApproved],
        ['INGENIERÍA', manifest.readiness.engineeringApproved],
        ['DOCUMENTOS BASE', manifest.readiness.missingBaseDocumentCount === 0],
      ];
      gates.forEach(([label, complete], index) => {
        const x = 14 + index * 61;
        drawBox(doc, x, y, 57, 17, complete ? COLORS.green : COLORS.mist, 2, complete ? null : COLORS.line);
        drawText(doc, `${complete ? 'OK' : 'FALTA'} / ${label}`, x + 5, y + 10.5, { size: 6.8, weight: 'bold', tone: complete ? COLORS.white : COLORS.slate });
      });
      y += 25;
    }
    drawBox(doc, 14, y, 182, 10, COLORS.navy, 2);
    drawText(doc, 'DOCUMENTO / VERSIÓN', 18, y + 6.5, { size: 6.5, weight: 'bold', tone: COLORS.white });
    drawText(doc, 'ORIGEN', 130, y + 6.5, { size: 6.5, weight: 'bold', tone: COLORS.white });
    drawText(doc, 'ESTADO', 190, y + 6.5, { size: 6.5, weight: 'bold', tone: COLORS.white, align: 'right' });
    y += 12;
  };

  startPage();
  documents.forEach((document, index) => {
    if (y > 261) {
      doc.addPage();
      page += 1;
      startPage();
    }
    if (index % 2 === 0) {
      fill(doc, COLORS.mist);
      doc.rect(14, y - 1, 182, 11, 'F');
    }
    drawText(doc, `${document.title} · v${document.version}`, 18, y + 4, { size: 7, weight: 'bold', tone: COLORS.ink, maxWidth: 104 });
    drawText(doc, `${document.files.length} archivo${document.files.length === 1 ? '' : 's'}`, 18, y + 8.2, { size: 5.7, tone: COLORS.slate });
    drawText(doc, document.scope === 'regulatory' ? 'Regulatorio' : document.scope === 'conditional' ? 'Condicional' : 'Control CDSE', 130, y + 5.5, { size: 6.2, tone: COLORS.slate });
    drawText(doc, STATUS_LABELS[document.status] ?? document.status, 190, y + 5.5, { size: 6.4, weight: 'bold', tone: statusTone(document.status), align: 'right' });
    y += 11;
  });
  if (y < 230) {
    const missing = manifest.documents.filter((document) => (
      !['approved', 'not_applicable'].includes(document.status)
      && document.code !== 'cfe_acknowledgement'
    ));
    const blockY = Math.max(y + 12, 157);
    drawText(doc, 'LECTURA OPERATIVA', 14, blockY, { size: 8, weight: 'bold', tone: COLORS.navy });
    drawLine(doc, 14, blockY + 4, 196, blockY + 4, COLORS.amber, .6);
    drawBox(doc, 14, blockY + 10, 112, 48, COLORS.mist, 2, COLORS.line);
    drawText(doc, 'PENDIENTES ANTES DEL SIGUIENTE HITO', 20, blockY + 19, { size: 6.5, weight: 'bold', tone: COLORS.navy });
    drawText(doc, missing.length
      ? missing.slice(0, 5).map((document, index) => `${index + 1}. ${document.title}`).join('\n')
      : 'No existen documentos base pendientes en este índice.', 20, blockY + 28, { size: 7, tone: COLORS.ink, maxWidth: 98, lineHeight: 1.35 });
    drawBox(doc, 132, blockY + 10, 64, 48, manifest.readiness.readyForCfe ? COLORS.green : COLORS.navy, 2);
    drawText(doc, 'ESTADO DE ENTREGA', 138, blockY + 19, { size: 6.2, weight: 'bold', tone: manifest.readiness.readyForCfe ? COLORS.white : COLORS.amber });
    drawText(doc, manifest.readiness.readyForCfe ? 'LISTO PARA PRESENTAR' : 'EXPEDIENTE EN PREPARACIÓN', 138, blockY + 31, { size: 10, weight: 'bold', tone: COLORS.white, maxWidth: 51 });
    drawText(doc, project.cfe_tracking_folio ? `Folio CFE: ${project.cfe_tracking_folio}` : 'Folio CFE pendiente', 138, blockY + 48, { size: 6.2, tone: '#bfd0dd', maxWidth: 51 });
    drawText(doc, 'El receptor debe confirmar formatos vigentes y entregar acuse con fecha y folio.', 14, blockY + 69, { size: 6.5, tone: COLORS.slate, maxWidth: 182 });
  }
  drawText(doc, 'Este índice no sustituye la revisión de formatos vigentes ni el acuse de la oficina receptora.', 14, 274, { size: 6, tone: COLORS.slate });
  return doc;
}

function saveDoc(doc, filename) {
  doc.save(filename);
}

export async function downloadSiteSurveyReport(project) {
  const doc = await createSiteSurveyReportPdf(project);
  saveDoc(doc, `${safeFilename(projectFolio(project))}-levantamiento-tecnico.pdf`);
}

export async function downloadAuthorizationLetter(project) {
  const doc = await createAuthorizationLetterPdf(project);
  saveDoc(doc, `${safeFilename(projectFolio(project))}-carta-autorizacion.pdf`);
}

export async function downloadDossierIndex(project) {
  const doc = await createDossierIndexPdf(project);
  saveDoc(doc, `${safeFilename(projectFolio(project))}-indice-expediente.pdf`);
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportProjectDossierZip(project, supabase, onProgress = () => {}) {
  const manifest = buildProjectManifest(project);
  const sourceFiles = manifest.documents.flatMap((document) => document.files.map((file) => ({ document, file })));
  const totalBytes = sourceFiles.reduce((sum, item) => sum + Number(item.file.sizeBytes ?? 0), 0);
  if (totalBytes > 125 * 1024 * 1024) throw new Error('DOSSIER_TOO_LARGE_FOR_MOBILE');

  onProgress({ current: 0, total: sourceFiles.length + 3, label: 'Preparando documentos de control' });
  const [{ zipSync, strToU8 }, indexDoc, surveyDoc, authorizationDoc] = await Promise.all([
    import('fflate'),
    createDossierIndexPdf(project),
    (project.solar_site_surveys ?? []).length ? createSiteSurveyReportPdf(project) : Promise.resolve(null),
    createAuthorizationLetterPdf(project),
  ]);
  const files = {
    '00_Control/indice-expediente.pdf': new Uint8Array(indexDoc.output('arraybuffer')),
    '00_Control/carta-autorizacion-condicional.pdf': new Uint8Array(authorizationDoc.output('arraybuffer')),
  };
  if (surveyDoc) files['02_Levantamiento/reporte-levantamiento.pdf'] = new Uint8Array(surveyDoc.output('arraybuffer'));

  const exportedFiles = [];
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const { document: documentRecord, file } = sourceFiles[index];
    onProgress({ current: index + 1, total: sourceFiles.length + 3, label: `Integrando ${file.originalName}` });
    const { data: signed, error } = await supabase.storage.from('solar-projects').createSignedUrl(file.storagePath, 120);
    if (error) throw error;
    const response = await fetch(signed.signedUrl);
    if (!response.ok) throw new Error(`No se pudo descargar ${file.originalName}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const folder = STAGE_LABELS[documentRecord.stage] ?? '99_Otros';
    const filename = `${safeFilename(documentRecord.code)}-v${documentRecord.version}-${safeFilename(file.originalName)}`;
    files[`${folder}/${filename}`] = bytes;
    exportedFiles.push({
      documentCode: documentRecord.code,
      documentVersion: documentRecord.version,
      originalName: file.originalName,
      exportedPath: `${folder}/${filename}`,
      sizeBytes: bytes.byteLength,
      sha256: await sha256(bytes),
    });
  }

  manifest.exportedFiles = exportedFiles;
  files['00_Control/manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['LEEME.txt'] = strToU8([
    `EXPEDIENTE PRIVADO ${projectFolio(project)}`,
    '',
    'Este archivo contiene datos personales, técnicos y posiblemente patrimoniales.',
    'Úsalo únicamente para la operación autorizada del proyecto y la gestión ante CFE.',
    'No lo publiques ni lo compartas mediante enlaces abiertos.',
    '',
    'El archivo manifest.json registra versiones, estados y huellas SHA-256 de los anexos.',
    `Generado: ${new Date().toLocaleString('es-MX')}`,
  ].join('\n'));
  onProgress({ current: sourceFiles.length + 2, total: sourceFiles.length + 3, label: 'Comprimiendo expediente privado' });
  const zipped = zipSync(files, { level: 6 });
  triggerBlobDownload(new Blob([zipped], { type: 'application/zip' }), `${safeFilename(projectFolio(project))}-expediente.zip`);
  onProgress({ current: sourceFiles.length + 3, total: sourceFiles.length + 3, label: 'Expediente listo' });
  return { fileCount: sourceFiles.length, totalBytes, manifest };
}

export { STAGE_TITLES };

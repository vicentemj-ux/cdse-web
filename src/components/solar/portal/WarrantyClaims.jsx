import { useEffect, useMemo, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import {
  WARRANTY_CLAIM_TRANSITIONS, warrantyClaimPortfolioMetrics, warrantyClaimReadiness,
} from '../../../lib/solar/after-sales.mjs';

const date = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const CLAIM_TYPE = {
  manufacturer_warranty: 'Garantía de fabricante', supplier_return: 'Devolución a proveedor',
  installation_warranty: 'Garantía de instalación', shipping_damage: 'Daño de transporte', other: 'Otra causa',
};
const REQUEST = { diagnosis: 'Diagnóstico', repair: 'Reparación', replacement: 'Reemplazo', credit: 'Nota de crédito', refund: 'Reembolso' };
const STATUS = {
  diagnosing: 'En diagnóstico', awaiting_evidence: 'Falta evidencia', submitted: 'Enviada al proveedor',
  approved: 'Aprobada', rejected: 'Rechazada', replacement_in_transit: 'Reemplazo en tránsito',
  replacement_received: 'Reemplazo recibido', resolved: 'Resuelta', closed: 'Cerrada', cancelled: 'Cancelada',
};
const ACTION_LABEL = {
  diagnosing: 'Regresar a diagnóstico', awaiting_evidence: 'Solicitar evidencia', submitted: 'Enviar reclamación',
  approved: 'Registrar aprobación', rejected: 'Registrar rechazo', replacement_in_transit: 'Esperar reemplazo',
  closed: 'Cerrar expediente', cancelled: 'Cancelar reclamación',
};
const CATEGORY = { module: 'Panel', inverter: 'Inversor', monitoring: 'Monitoreo', protection: 'Protección', other: 'Equipo' };
const EMPTY_EVIDENCE = {
  purchaseDocumentReference: '', serialEvidenceReference: '', diagnosticEvidenceReference: '',
  faultEvidenceReference: '', systemConfiguration: '',
};
const ERROR = {
  WARRANTY_CLAIM_ACCESS_DENIED: 'No tienes autorización para abrir esta reclamación.',
  WARRANTY_OPERATION_DENIED: 'Sólo administración u operaciones puede mover este expediente.',
  INSTALLED_SERIAL_REQUIRED: 'Selecciona una serie instalada y conciliada.',
  WARRANTY_PROVIDER_REQUIRED: 'Indica quién atenderá la garantía.',
  WARRANTY_EVIDENCE_INCOMPLETE: 'Completa el expediente técnico antes de enviarlo.',
  SUPPLIER_REFERENCE_REQUIRED: 'Captura el folio emitido por proveedor o fabricante.',
  WARRANTY_DECISION_NOTE_REQUIRED: 'Documenta el motivo de esta decisión.',
  REPLACEMENT_TRACKING_REQUIRED: 'Captura la guía o referencia del reemplazo.',
  REPLACEMENT_SERIAL_NOT_AVAILABLE: 'La serie de reemplazo ya no está disponible.',
  REPLACEMENT_SERIAL_INCOMPATIBLE: 'El reemplazo debe corresponder a la misma categoría de equipo.',
  REPLACEMENT_MUST_BE_INSTALLED: 'Entrega e instala la serie de reemplazo antes de resolver.',
  REPAIR_DATES_REQUIRED: 'Captura fechas válidas de inicio y término de la reparación.',
  REPLACEMENT_DATES_REQUIRED: 'Captura fechas válidas de inicio y término de la sustitución.',
  ADMIN_REQUIRED: 'La recepción y resolución final requieren administración.',
};

function isoDate() { return new Date().toISOString().slice(0, 10); }
function rawError(error) { return error?.message?.replace(/^.*?:\s*/, '') || ''; }
function friendlyError(error) { const raw = rawError(error); return ERROR[raw] ?? (raw || 'No se pudo completar la acción.'); }
function displayDate(value, includeTime = false) {
  if (!value) return 'Por definir';
  const parsed = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return includeTime ? dateTime.format(parsed) : date.format(parsed);
}

export default function WarrantyClaims({ project, data, isAdmin, canOperate, refresh }) {
  const claims = useMemo(() => [...(project.solar_warranty_claims ?? [])]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [project.solar_warranty_claims]);
  const projectSerials = (data.inventorySerials ?? []).filter((item) => item.project_id === project.id);
  const claimableSerials = projectSerials.filter((item) => item.status === 'installed');
  const inventorySerials = (data.inventorySerials ?? []).filter((item) => item.status === 'in_stock');
  const metrics = warrantyClaimPortfolioMetrics(data.projects.flatMap((item) => item.solar_warranty_claims ?? []));
  const [selectedId, setSelectedId] = useState(claims.find((item) => !['closed', 'cancelled'].includes(item.status))?.id ?? claims[0]?.id ?? '');
  const claim = claims.find((item) => item.id === selectedId) ?? claims[0] ?? null;
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    serialId: '', warrantyId: '', claimType: 'manufacturer_warranty', requestedResolution: 'replacement',
    provider: 'Growatt', priority: 'high', failureSummary: '', nextFollowUpAt: '',
  });
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const [action, setAction] = useState({ nextStatus: '', note: '', diagnosis: '', externalReference: '', returnReference: '', replacementReference: '', nextFollowUpAt: '' });
  const [replacement, setReplacement] = useState({ serialId: '', reference: '', workOrderId: '' });
  const [resolution, setResolution] = useState({ type: 'repair', detail: '', startedAt: isoDate(), completedAt: isoDate() });

  useEffect(() => {
    const selected = claims.find((item) => item.id === selectedId) ?? claims[0];
    if (!selected) return;
    setEvidence({ ...EMPTY_EVIDENCE, ...(selected.evidence ?? {}) });
    setAction({ nextStatus: '', note: '', diagnosis: selected.diagnosis ?? '', externalReference: selected.external_reference ?? '', returnReference: selected.return_reference ?? '', replacementReference: selected.replacement_reference ?? '', nextFollowUpAt: '' });
    setResolution((current) => ({ ...current, type: selected.status === 'replacement_received' ? 'replacement' : current.type === 'replacement' ? 'repair' : current.type }));
  }, [claims, selectedId]);

  const oldSerial = claim ? projectSerials.find((item) => item.id === claim.serial_id) : null;
  const replacementCandidates = inventorySerials.filter((item) => item.solar_inventory_items?.category === oldSerial?.solar_inventory_items?.category);
  const readiness = warrantyClaimReadiness(claim);
  const transitions = claim ? (WARRANTY_CLAIM_TRANSITIONS[claim.status] ?? []).filter((status) => !['replacement_received', 'resolved'].includes(status)) : [];

  async function run(key, operation, success, after) {
    if (busy) return;
    setBusy(key); setError(''); setMessage('');
    const result = await operation();
    setBusy('');
    if (result.error) return setError(friendlyError(result.error));
    setMessage(success); after?.(result.data); await refresh();
  }

  async function createClaim(event) {
    event.preventDefault();
    await run('create', () => getSupabaseClient().rpc('create_solar_warranty_claim', {
      p_project_id: project.id,
      p_data: { ...form, warrantyId: form.warrantyId || null, nextFollowUpAt: form.nextFollowUpAt ? new Date(form.nextFollowUpAt).toISOString() : null },
    }), 'Reclamación abierta; la serie quedó aislada hasta concluir el diagnóstico.', (result) => {
      const created = Array.isArray(result) ? result[0] : result;
      if (created?.id) setSelectedId(created.id);
      setForm({ serialId: '', warrantyId: '', claimType: 'manufacturer_warranty', requestedResolution: 'replacement', provider: 'Growatt', priority: 'high', failureSummary: '', nextFollowUpAt: '' });
    });
  }

  function selectClaim(nextClaim) {
    setSelectedId(nextClaim.id);
    setEvidence({ ...EMPTY_EVIDENCE, ...(nextClaim.evidence ?? {}) });
    setAction({ nextStatus: '', note: '', diagnosis: nextClaim.diagnosis ?? '', externalReference: nextClaim.external_reference ?? '', returnReference: nextClaim.return_reference ?? '', replacementReference: nextClaim.replacement_reference ?? '', nextFollowUpAt: '' });
    setReplacement({ serialId: '', reference: nextClaim.replacement_reference ?? '', workOrderId: '' });
  }

  async function saveEvidence(event) {
    event.preventDefault();
    await run('evidence', () => getSupabaseClient().rpc('advance_solar_warranty_claim', {
      p_claim_id: claim.id, p_next_status: claim.status, p_data: { evidence, diagnosis: action.diagnosis, nextFollowUpAt: action.nextFollowUpAt ? new Date(action.nextFollowUpAt).toISOString() : null },
    }), 'Evidencia y diagnóstico guardados en la bitácora.', () => {});
  }

  async function advance(event) {
    event.preventDefault();
    await run('advance', () => getSupabaseClient().rpc('advance_solar_warranty_claim', {
      p_claim_id: claim.id, p_next_status: action.nextStatus,
      p_data: { ...action, evidence, nextFollowUpAt: action.nextFollowUpAt ? new Date(action.nextFollowUpAt).toISOString() : null },
    }), `Reclamación actualizada: ${STATUS[action.nextStatus]}.`, () => setAction((current) => ({ ...current, nextStatus: '', note: '' })));
  }

  async function receiveReplacement(event) {
    event.preventDefault();
    await run('replacement', () => getSupabaseClient().rpc('register_solar_warranty_replacement', {
      p_claim_id: claim.id, p_replacement_serial_id: replacement.serialId, p_reference: replacement.reference,
      p_work_order_id: replacement.workOrderId || null,
    }), 'Reemplazo recibido, identificado y apartado al proyecto.', () => setReplacement({ serialId: '', reference: '', workOrderId: '' }));
  }

  async function resolveClaim(event) {
    event.preventDefault();
    await run('resolve', () => getSupabaseClient().rpc('resolve_solar_warranty_claim', {
      p_claim_id: claim.id, p_resolution_type: resolution.type, p_resolution: resolution.detail,
      p_service_started_at: ['repair', 'replacement'].includes(resolution.type) ? resolution.startedAt : null,
      p_service_completed_at: ['repair', 'replacement'].includes(resolution.type) ? resolution.completedAt : null,
    }), 'Resolución aplicada al equipo, la garantía y el caso de servicio.', () => setResolution({ type: 'repair', detail: '', startedAt: isoDate(), completedAt: isoDate() }));
  }

  return <section className="sp-after-section sp-claims">
    <div className="sp-subhead"><div><p className="sp-section-number">GARANTÍAS / RMA</p><h3>Del diagnóstico a la solución.</h3></div><span>{claims.filter((item) => !['closed','cancelled'].includes(item.status)).length} expedientes activos</span></div>
    <div className="sp-claim-ledger"><div><span>Abiertas</span><strong>{metrics.open}</strong></div><div><span>Falta evidencia</span><strong>{metrics.awaitingEvidence}</strong></div><div><span>Con proveedor</span><strong>{metrics.withSupplier}</strong></div><div><span>Seguimiento vencido</span><strong>{metrics.overdueFollowUp}</strong></div></div>
    {message && <p className="sp-inline-notice" role="status">{message}</p>}{error && <p className="sp-form-error" role="alert">{error}</p>}

    <form className="sp-claim-create" onSubmit={createClaim}>
      <div className="sp-claim-intro"><p className="sp-section-number">NUEVO REPORTE</p><h4>Aislar primero, decidir con evidencia.</h4><p>Al abrirlo, el equipo deja de figurar como instalado disponible y queda en cuarentena.</p></div>
      <label className="sp-field"><span>Serie instalada</span><select required value={form.serialId} onChange={(event) => { const serialId = event.target.value; const serial = claimableSerials.find((item) => item.id === serialId); const warranty = (project.solar_warranties ?? []).find((item) => !item.asset_id || item.asset_id === serial?.asset_id); setForm({ ...form, serialId, warrantyId: warranty?.id ?? '', provider: warranty?.provider ?? form.provider }); }}><option value="">Selecciona equipo</option>{claimableSerials.map((item) => <option value={item.id} key={item.id}>{CATEGORY[item.solar_inventory_items?.category] ?? 'Equipo'} · {item.serial_number} · {item.solar_inventory_items?.sku}</option>)}</select></label>
      <label className="sp-field"><span>Tipo de reclamación</span><select value={form.claimType} onChange={(event) => setForm({ ...form, claimType: event.target.value })}>{Object.entries(CLAIM_TYPE).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="sp-field"><span>Solución solicitada</span><select value={form.requestedResolution} onChange={(event) => setForm({ ...form, requestedResolution: event.target.value })}>{Object.entries(REQUEST).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="sp-field"><span>Proveedor / fabricante</span><input required minLength="2" maxLength="160" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} /></label>
      <label className="sp-field"><span>Prioridad</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="critical">Crítica</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baja</option></select></label>
      <label className="sp-field"><span>Próximo seguimiento</span><input type="datetime-local" value={form.nextFollowUpAt} onChange={(event) => setForm({ ...form, nextFollowUpAt: event.target.value })} /></label>
      <label className="sp-field sp-field--wide"><span>Falla observada</span><textarea required minLength="10" maxLength="3000" value={form.failureSummary} onChange={(event) => setForm({ ...form, failureSummary: event.target.value })} /></label>
      <button className="sp-button sp-button--primary" disabled={busy === 'create' || !claimableSerials.length}>{busy === 'create' ? 'Aislando equipo…' : 'Abrir reclamación'}</button>
      {!claimableSerials.length && <p className="sp-compliance-note">Primero concilia e instala la serie desde Inventario. Una garantía sin identidad verificable no puede abrirse.</p>}
    </form>

    <div className="sp-claim-workspace">
      <aside className="sp-claim-index">{claims.map((item) => <button type="button" className={item.id === claim?.id ? 'is-active' : ''} onClick={() => selectClaim(item)} key={item.id}><span>{item.folio}</span><strong>{STATUS[item.status]}</strong><small>{item.provider} · serie {(projectSerials.find((serial) => serial.id === item.serial_id)?.serial_number ?? 'por localizar')}</small></button>)}{!claims.length && <div className="sp-after-empty"><strong>Sin reclamaciones.</strong><p>Los reportes de garantía aparecerán aquí con su cadena de evidencia.</p></div>}</aside>
      {claim && <div className="sp-claim-detail">
        <header><div><span>{CLAIM_TYPE[claim.claim_type]}</span><h4>{claim.folio}</h4><p>{claim.failure_summary}</p></div><b className={`is-${claim.status}`}>{STATUS[claim.status]}</b></header>
        <div className="sp-claim-facts"><div><span>Equipo aislado</span><strong>{oldSerial?.serial_number ?? 'No localizado'}</strong><small>{oldSerial?.solar_inventory_items?.sku}</small></div><div><span>Solución solicitada</span><strong>{REQUEST[claim.requested_resolution]}</strong><small>{claim.provider}</small></div><div><span>Próximo seguimiento</span><strong>{displayDate(claim.next_follow_up_at, true)}</strong><small>{claim.external_reference || 'Folio externo pendiente'}</small></div></div>
        <div className={`sp-evidence-gate ${readiness.ready ? 'is-ready' : ''}`}><div><span>{readiness.ready ? 'EXPEDIENTE COMPLETO' : 'EXPEDIENTE BLOQUEADO'}</span><strong>{readiness.ready ? 'Listo para presentar.' : `${readiness.missing.length} evidencias pendientes.`}</strong></div>{!readiness.ready && <ul>{readiness.missing.map((item) => <li key={item}>{item}</li>)}</ul>}</div>

        {canOperate && !['closed','cancelled','resolved'].includes(claim.status) && <form className="sp-evidence-form" onSubmit={saveEvidence}><p className="sp-section-number">EVIDENCIA DEL EXPEDIENTE</p><label className="sp-field"><span>Comprobante de compra / instalación</span><input required value={evidence.purchaseDocumentReference} onChange={(event) => setEvidence({ ...evidence, purchaseDocumentReference: event.target.value })} placeholder="Documento y ubicación en expediente" /></label><label className="sp-field"><span>Foto de placa y serie</span><input required value={evidence.serialEvidenceReference} onChange={(event) => setEvidence({ ...evidence, serialEvidenceReference: event.target.value })} /></label><label className="sp-field"><span>Diagnóstico / mediciones</span><input required value={evidence.diagnosticEvidenceReference} onChange={(event) => setEvidence({ ...evidence, diagnosticEvidenceReference: event.target.value })} /></label><label className="sp-field"><span>Foto, video o código de falla</span><input required value={evidence.faultEvidenceReference} onChange={(event) => setEvidence({ ...evidence, faultEvidenceReference: event.target.value })} /></label>{claim.claim_type === 'manufacturer_warranty' && <label className="sp-field sp-field--wide"><span>Configuración del sistema y strings</span><input required value={evidence.systemConfiguration} onChange={(event) => setEvidence({ ...evidence, systemConfiguration: event.target.value })} placeholder="Paneles, strings, tensión, frecuencia y red" /></label>}<label className="sp-field sp-field--wide"><span>Diagnóstico narrativo</span><textarea maxLength="3000" value={action.diagnosis} onChange={(event) => setAction({ ...action, diagnosis: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'evidence'}>Guardar evidencia</button></form>}

        {canOperate && transitions.length > 0 && <form className="sp-claim-action" onSubmit={advance}><label className="sp-field"><span>Siguiente estado</span><select required value={action.nextStatus} onChange={(event) => setAction({ ...action, nextStatus: event.target.value })}><option value="">Selecciona acción</option>{transitions.map((status) => <option value={status} key={status}>{ACTION_LABEL[status] ?? STATUS[status]}</option>)}</select></label>{action.nextStatus === 'approved' && <label className="sp-field"><span>Folio de proveedor</span><input required value={action.externalReference} onChange={(event) => setAction({ ...action, externalReference: event.target.value })} /></label>}{action.nextStatus === 'replacement_in_transit' && <label className="sp-field"><span>Guía / reemplazo</span><input required value={action.replacementReference} onChange={(event) => setAction({ ...action, replacementReference: event.target.value })} /></label>}<label className="sp-field"><span>Próximo seguimiento</span><input type="datetime-local" value={action.nextFollowUpAt} onChange={(event) => setAction({ ...action, nextFollowUpAt: event.target.value })} /></label><label className="sp-field sp-field--wide"><span>Nota de decisión</span><textarea required={['rejected','cancelled','closed'].includes(action.nextStatus)} maxLength="3000" value={action.note} onChange={(event) => setAction({ ...action, note: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'advance' || !action.nextStatus}>Aplicar movimiento</button></form>}

        {isAdmin && claim.status === 'replacement_in_transit' && <form className="sp-claim-special" onSubmit={receiveReplacement}><div><p className="sp-section-number">RECEPCIÓN CONTROLADA</p><h5>Apartar el reemplazo.</h5><p>La serie nueva sale de existencia disponible y queda reservada para este proyecto.</p></div><label className="sp-field"><span>Serie recibida</span><select required value={replacement.serialId} onChange={(event) => setReplacement({ ...replacement, serialId: event.target.value })}><option value="">Selecciona existencia</option>{replacementCandidates.map((item) => <option value={item.id} key={item.id}>{item.serial_number} · {item.solar_inventory_items?.sku} · {item.solar_inventory_locations?.name}</option>)}</select></label><label className="sp-field"><span>Referencia de recepción</span><input required value={replacement.reference} onChange={(event) => setReplacement({ ...replacement, reference: event.target.value })} /></label><label className="sp-field"><span>Orden de trabajo</span><select value={replacement.workOrderId} onChange={(event) => setReplacement({ ...replacement, workOrderId: event.target.value })}><option value="">Se asignará después</option>{data.workOrders.filter((item) => item.project_id === project.id).map((item) => <option value={item.id} key={item.id}>{item.folio}</option>)}</select></label><button className="sp-button sp-button--secondary" disabled={busy === 'replacement'}>Recibir y apartar</button></form>}

        {isAdmin && ['approved','replacement_received'].includes(claim.status) && <form className="sp-claim-special" onSubmit={resolveClaim}><div><p className="sp-section-number">RESOLUCIÓN FINAL</p><h5>Actualizar equipo y garantía.</h5><p>La sustitución sólo se habilita cuando la serie nueva ya fue instalada desde Inventario.</p></div><label className="sp-field"><span>Resultado</span><select value={resolution.type} onChange={(event) => setResolution({ ...resolution, type: event.target.value })}>{claim.status === 'replacement_received' ? <option value="replacement">Reemplazo instalado</option> : <><option value="repair">Equipo reparado</option><option value="credit">Nota de crédito</option><option value="refund">Reembolso</option></>}</select></label>{['repair','replacement'].includes(resolution.type) && <><label className="sp-field"><span>Inicio de servicio</span><input type="date" required value={resolution.startedAt} onChange={(event) => setResolution({ ...resolution, startedAt: event.target.value })} /></label><label className="sp-field"><span>Término de servicio</span><input type="date" min={resolution.startedAt} max={isoDate()} required value={resolution.completedAt} onChange={(event) => setResolution({ ...resolution, completedAt: event.target.value })} /></label></>}<label className="sp-field sp-field--wide"><span>Resolución documentada</span><textarea required minLength="5" maxLength="3000" value={resolution.detail} onChange={(event) => setResolution({ ...resolution, detail: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'resolve'}>Resolver expediente</button></form>}

        <div className="sp-claim-timeline"><p className="sp-section-number">CADENA DE DECISIONES</p>{[...(claim.solar_warranty_claim_events ?? [])].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).map((event) => <article key={event.id}><i /><div><strong>{STATUS[event.next_status] ?? event.event_type}</strong><p>{event.note || 'Movimiento registrado sin nota adicional.'}</p><small>{displayDate(event.created_at, true)} · {event.event_type.replaceAll('_',' ')}</small></div></article>)}</div>
      </div>}
    </div>
    <p className="sp-compliance-note">La póliza entregada al cliente conserva su alcance real. El tiempo de reparación no reduce la vigencia; cuando se sustituye el bien, la garantía se renueva desde la entrega del reemplazo.</p>
  </section>;
}

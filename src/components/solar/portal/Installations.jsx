import { useEffect, useMemo, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import { downloadHandoverCertificate } from '../../../lib/solar/project-documents.js';
import {
  cacheFieldSnapshot,
  enqueueFieldAction,
  flushFieldActions,
  getQueuedFieldActions,
} from '../../../lib/solar/field-offline.js';

const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const STATUS = {
  planned: 'Planeada', confirmed: 'Confirmada', in_progress: 'En ejecución',
  paused: 'Pausa de seguridad', completed: 'Terminada', cancelled: 'Cancelada',
};
const CATEGORY = {
  pre_start: 'Preparación', safety: 'Seguridad', mounting: 'Montaje', dc: 'Circuitos DC',
  ac: 'Circuitos AC', testing: 'Pruebas', handover: 'Entrega',
};
const TRADES = {
  foreman: 'Jefe de cuadrilla', installer: 'Instalador', electrician: 'Electricista',
  helper: 'Ayudante', safety: 'Seguridad', other: 'Otro',
};
const ERROR_MESSAGES = {
  INSTALLATION_APPROVAL_REQUIRED: 'El proyecto debe estar aprobado para instalación antes de ocupar capacidad de una cuadrilla.',
  CREW_SCHEDULE_CONFLICT: 'La cuadrilla ya tiene otra orden que se cruza con este horario.',
  ACTIVE_CREW_REQUIRED: 'Selecciona una cuadrilla activa.',
  SAFETY_GATE_INCOMPLETE: 'Completa todos los controles de preparación y seguridad antes de iniciar.',
  APPROVED_ENGINEERING_REQUIRED: 'La ingeniería del proyecto debe estar aprobada antes de iniciar campo.',
  SAFETY_STOP_REASON_REQUIRED: 'Documenta el motivo de la pausa de seguridad.',
  INSTALLATION_CHECKLIST_INCOMPLETE: 'Completa todos los controles obligatorios antes de cerrar la orden.',
  OPEN_CRITICAL_INCIDENT: 'Resuelve las incidencias altas o críticas antes de cerrar la orden.',
  INSTALLATION_EVIDENCE_REQUIRED: 'Carga evidencia fotográfica de la instalación antes de cerrar la orden.',
  BLOCKED_ITEM_NOTES_REQUIRED: 'Explica el bloqueo para que operaciones pueda resolverlo.',
  OPEN_INCIDENT_REQUIRED: 'La incidencia ya fue resuelta o no está disponible.',
};

function friendlyError(error) {
  const raw = error?.message?.replace(/^.*?:\s*/, '') || '';
  return ERROR_MESSAGES[raw] ?? (raw || 'No se pudo completar la acción.');
}

function isoLocal(value = new Date()) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

function readiness(worker) {
  const today = new Date().toISOString().slice(0, 10);
  const warnings = [];
  if (!worker.height_work_authorized_until || worker.height_work_authorized_until < today) warnings.push('altura');
  if (!worker.medical_clearance_until || worker.medical_clearance_until < today) warnings.push('aptitud');
  if (!worker.ppe_verified_at) warnings.push('EPP');
  return warnings;
}

export default function Installations({ data, profile, isAdmin, refresh, onOpenProject }) {
  const [tab, setTab] = useState('schedule');
  const [selectedId, setSelectedId] = useState(data.workOrders[0]?.id ?? null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queued, setQueued] = useState(getQueuedFieldActions().length);
  const [optimistic, setOptimistic] = useState({});
  const [schedule, setSchedule] = useState({ projectId: '', crewId: '', start: isoLocal(), end: isoLocal(new Date(Date.now() + 8 * 60 * 60 * 1000)), panels: '8', scope: 'Instalación de sistema fotovoltaico interconectado', address: '', contact: '' });
  const [incident, setIncident] = useState({ type: 'quality', severity: 'low', description: '', action: '' });
  const [worker, setWorker] = useState({ fullName: '', phone: '', trade: 'installer', heightUntil: '', medicalUntil: '', ppeAt: new Date().toISOString().slice(0, 10), emergency: '' });
  const [crew, setCrew] = useState({ name: '', capacity: '8', notes: '' });
  const [assignment, setAssignment] = useState({ crewId: '', workerId: '', role: 'installer' });

  const orders = useMemo(() => [...data.workOrders].sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start))), [data.workOrders]);
  const selected = orders.find((item) => item.id === selectedId) ?? orders[0] ?? null;
  const project = selected ? data.projects.find((item) => item.id === selected.project_id) : null;
  const checklist = selected?.solar_work_order_checklist_items ?? [];
  const incidents = selected?.solar_work_order_incidents ?? [];
  const completeCount = checklist.filter((item) => (optimistic[item.id] ?? item.status) === 'complete').length;
  const checklistPercent = checklist.length ? Math.round(completeCount / checklist.length * 100) : 0;
  const eligibleProjects = data.projects.filter((item) => ['approved_for_installation', 'installation_scheduled'].includes(item.status));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const week = new Date(today); week.setDate(week.getDate() + 8);
  const todayOrders = orders.filter((item) => new Date(item.scheduled_start) < tomorrow && new Date(item.scheduled_end) >= today && !['cancelled', 'completed'].includes(item.status));
  const weekPanels = orders.filter((item) => new Date(item.scheduled_start) >= today && new Date(item.scheduled_start) < week && !['cancelled'].includes(item.status)).reduce((sum, item) => sum + Number(item.planned_panels), 0);
  const weeklyCapacity = data.crews.filter((item) => item.active).reduce((sum, item) => sum + Number(item.daily_capacity_panels) * 6, 0);

  useEffect(() => {
    cacheFieldSnapshot(orders);
  }, [orders]);

  useEffect(() => {
    const handleOnline = async () => {
      setOnline(true);
      const result = await flushFieldActions(getSupabaseClient());
      setQueued(result.remaining);
      if (result.synced) {
        setMessage(`${result.synced} cambio${result.synced === 1 ? '' : 's'} de campo sincronizado${result.synced === 1 ? '' : 's'}.`);
        setOptimistic({});
        await refresh();
      }
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (navigator.onLine && queued) handleOnline();
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);

  async function run(key, action, success) {
    setBusy(key); setMessage('');
    const { error } = await action();
    setBusy('');
    if (error) return setMessage(friendlyError(error));
    setMessage(success);
    await refresh();
  }

  async function scheduleOrder(event) {
    event.preventDefault();
    await run('schedule', () => getSupabaseClient().rpc('schedule_solar_work_order', { p_data: {
      projectId: schedule.projectId, crewId: schedule.crewId,
      scheduledStart: new Date(schedule.start).toISOString(), scheduledEnd: new Date(schedule.end).toISOString(),
      plannedPanels: Number(schedule.panels), workScope: schedule.scope, siteAddress: schedule.address, customerContact: schedule.contact,
    } }), 'Orden confirmada y capacidad reservada.');
  }

  async function setOrderStatus(status) {
    const reason = status === 'paused' ? window.prompt('Motivo de la pausa de seguridad:') : null;
    if (status === 'paused' && !reason?.trim()) return;
    await run(`status-${status}`, () => getSupabaseClient().rpc('set_solar_work_order_status', { p_work_order_id: selected.id, p_status: status, p_reason: reason }),
      status === 'in_progress' ? 'Orden iniciada. La bitácora de campo está activa.' : status === 'completed' ? 'Orden terminada; el proyecto avanzó a interconexión pendiente.' : 'Pausa registrada y proyecto bloqueado por seguridad.');
  }

  async function setChecklist(item, status) {
    const notes = status === 'blocked' ? window.prompt('¿Qué impide completar este control?') : item.notes;
    if (status === 'blocked' && !notes?.trim()) return;
    const payload = { p_item_id: item.id, p_status: status, p_notes: notes || null };
    setOptimistic((current) => ({ ...current, [item.id]: status }));
    if (!navigator.onLine) {
      enqueueFieldAction({ type: 'checklist', payload });
      setQueued(getQueuedFieldActions().length);
      return setMessage('Cambio guardado en este teléfono. Se sincronizará al volver la señal.');
    }
    const { error } = await getSupabaseClient().rpc('set_solar_work_order_checklist_item', payload);
    if (error) {
      if (/fetch|network/i.test(error.message ?? '')) {
        enqueueFieldAction({ type: 'checklist', payload });
        setQueued(getQueuedFieldActions().length);
        return setMessage('La señal se interrumpió. El cambio quedó protegido en este teléfono.');
      }
      setOptimistic((current) => ({ ...current, [item.id]: item.status }));
      return setMessage(friendlyError(error));
    }
    await refresh();
  }

  async function reportIncident(event) {
    event.preventDefault();
    const payload = { p_work_order_id: selected.id, p_type: incident.type, p_severity: incident.severity, p_description: incident.description, p_immediate_action: incident.action || null };
    if (!navigator.onLine) {
      enqueueFieldAction({ type: 'incident', payload });
      setQueued(getQueuedFieldActions().length);
      setIncident({ type: 'quality', severity: 'low', description: '', action: '' });
      return setMessage('Incidencia protegida en este teléfono; se enviará al recuperar señal.');
    }
    await run('incident', () => getSupabaseClient().rpc('report_solar_work_order_incident', payload), incident.severity === 'high' || incident.severity === 'critical' ? 'Incidencia registrada. La orden se pausó automáticamente.' : 'Incidencia registrada para seguimiento.');
    setIncident({ type: 'quality', severity: 'low', description: '', action: '' });
  }

  async function resolveIncident(item) {
    const resolution = window.prompt('Describe cómo quedó resuelta la incidencia:');
    if (!resolution?.trim()) return;
    await run(`incident-${item.id}`, () => getSupabaseClient().rpc('resolve_solar_work_order_incident', { p_incident_id: item.id, p_resolution: resolution }), 'Incidencia cerrada con resolución auditable.');
  }

  async function uploadEvidence(files) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length || !project) return;
    const document = project.solar_project_documents?.find((item) => item.document_code === 'installation_evidence' && item.status !== 'not_applicable');
    if (!document) return setMessage('El proyecto no tiene habilitado el requisito de evidencia de instalación.');
    const invalid = selectedFiles.find((file) => !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size > 15728640);
    if (invalid) return setMessage(`${invalid.name}: usa JPG, PNG, WEBP o PDF de máximo 15 MB.`);
    setBusy('evidence'); setMessage('');
    const client = getSupabaseClient();
    for (const file of selectedFiles) {
      const safe = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-110);
      const path = `${project.id}/installation_evidence/${Date.now()}-${crypto.randomUUID()}-${safe}`;
      const uploaded = await client.storage.from('solar-projects').upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) { setBusy(''); return setMessage(friendlyError(uploaded.error)); }
      const registered = await client.rpc('register_solar_project_document_upload', { p_document_id: document.id, p_storage_path: path, p_mime_type: file.type, p_file_size_bytes: file.size, p_original_name: file.name });
      if (registered.error) { setBusy(''); return setMessage(friendlyError(registered.error)); }
    }
    setBusy(''); setMessage(`${selectedFiles.length} evidencia${selectedFiles.length === 1 ? '' : 's'} integrada${selectedFiles.length === 1 ? '' : 's'} al expediente.`);
    await refresh();
  }

  async function createWorker(event) {
    event.preventDefault();
    await run('worker', () => getSupabaseClient().rpc('create_solar_field_worker', { p_data: { fullName: worker.fullName, phone: worker.phone, trade: worker.trade, heightAuthorizedUntil: worker.heightUntil, medicalClearanceUntil: worker.medicalUntil, ppeVerifiedAt: worker.ppeAt, emergencyContact: worker.emergency } }), 'Técnico agregado al padrón de campo.');
    setWorker({ fullName: '', phone: '', trade: 'installer', heightUntil: '', medicalUntil: '', ppeAt: new Date().toISOString().slice(0, 10), emergency: '' });
  }

  async function createCrew(event) {
    event.preventDefault();
    await run('crew', () => getSupabaseClient().rpc('create_solar_crew', { p_name: crew.name, p_daily_capacity_panels: Number(crew.capacity), p_notes: crew.notes || null }), 'Cuadrilla creada. Ya puede recibir personal y órdenes.');
    setCrew({ name: '', capacity: '8', notes: '' });
  }

  async function assignWorker(event) {
    event.preventDefault();
    await run('assignment', () => getSupabaseClient().rpc('assign_solar_crew_member', { p_crew_id: assignment.crewId, p_worker_id: assignment.workerId, p_role: assignment.role }), 'Personal asignado a la cuadrilla.');
  }

  return <section className="sp-view sp-installations">
    <header className="sp-view-header">
      <div><p className="sp-section-number">INSTALACIONES / CAMPO</p><h1>La obra empieza antes de subir al techo.</h1></div>
      <p className="sp-header-note">Capacidad, seguridad, calidad y evidencia en una sola orden. Si una condición no es segura, el sistema ayuda a detener y documentar.</p>
    </header>
    <div className="sp-field-signal" role="status"><b className={online ? 'is-online' : 'is-offline'}>{online ? 'En línea' : 'Sin señal'}</b><span>{queued ? `${queued} cambio${queued === 1 ? '' : 's'} protegido${queued === 1 ? '' : 's'} en este dispositivo` : 'Todos los cambios de campo están sincronizados'}</span></div>
    <div className="sp-ledger">
      <div><span>Órdenes para hoy</span><strong>{todayOrders.length}</strong><small>cuadrillas en movimiento</small></div>
      <div><span>Paneles esta semana</span><strong>{weekPanels}</strong><small>programados</small></div>
      <div><span>Capacidad semanal</span><strong>{weeklyCapacity}</strong><small>{weeklyCapacity ? number.format(weekPanels / weeklyCapacity * 100) : 0}% reservada</small></div>
      <div><span>Incidencias abiertas</span><strong>{data.workOrders.flatMap((item) => item.solar_work_order_incidents ?? []).filter((item) => item.status === 'open').length}</strong><small>requieren seguimiento</small></div>
    </div>
    <div className="sp-install-tabs" role="tablist"><button className={tab === 'schedule' ? 'is-active' : ''} onClick={() => setTab('schedule')}>Programa</button><button className={tab === 'field' ? 'is-active' : ''} onClick={() => setTab('field')}>Orden de campo</button>{isAdmin && <button className={tab === 'team' ? 'is-active' : ''} onClick={() => setTab('team')}>Cuadrillas</button>}</div>
    {message && <p className="sp-inline-notice" role="status">{message}</p>}

    {tab === 'schedule' && <div className="sp-install-schedule">
      <div className="sp-work-order-list">
        {orders.map((order) => <button type="button" className={selected?.id === order.id ? 'is-active' : ''} onClick={() => { setSelectedId(order.id); setTab('field'); }} key={order.id}>
          <time><b>{new Date(order.scheduled_start).toLocaleDateString('es-MX', { day: '2-digit' })}</b>{new Date(order.scheduled_start).toLocaleDateString('es-MX', { month: 'short' })}</time>
          <div><span>{STATUS[order.status]}</span><strong>{order.solar_projects?.customer_name ?? order.folio}</strong><small>{order.solar_crews?.name} · {order.planned_panels} paneles · {dateTime.format(new Date(order.scheduled_start))}</small></div>
          <i><b style={{ width: `${order.solar_work_order_checklist_items?.length ? order.solar_work_order_checklist_items.filter((item) => item.status === 'complete').length / order.solar_work_order_checklist_items.length * 100 : 0}%` }} /></i>
        </button>)}
        {!orders.length && <div className="sp-empty"><span>—</span><h3>Sin órdenes programadas</h3><p>Cuando un proyecto esté aprobado para instalar, reserva una cuadrilla y horario.</p></div>}
      </div>
      {isAdmin && <form className="sp-work-order-form" onSubmit={scheduleOrder}>
        <p className="sp-section-number">NUEVA ORDEN</p><h2>Reservar capacidad.</h2>
        <label className="sp-field"><span>Proyecto aprobado</span><select required value={schedule.projectId} onChange={(event) => { const value = event.target.value; const selectedProject = data.projects.find((item) => item.id === value); setSchedule({ ...schedule, projectId: value, panels: String(selectedProject?.sold_scope_snapshot?.panelCount ?? selectedProject?.solar_quotes?.panel_count ?? 8) }); }}><option value="">Selecciona</option>{eligibleProjects.map((item) => <option value={item.id} key={item.id}>{item.folio} · {item.customer_name}</option>)}</select></label>
        <label className="sp-field"><span>Cuadrilla</span><select required value={schedule.crewId} onChange={(event) => setSchedule({ ...schedule, crewId: event.target.value })}><option value="">Selecciona</option>{data.crews.filter((item) => item.active).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.daily_capacity_panels} paneles/día</option>)}</select></label>
        <div className="sp-field-pair"><label className="sp-field"><span>Inicio</span><input type="datetime-local" required value={schedule.start} onChange={(event) => setSchedule({ ...schedule, start: event.target.value })} /></label><label className="sp-field"><span>Fin</span><input type="datetime-local" required value={schedule.end} onChange={(event) => setSchedule({ ...schedule, end: event.target.value })} /></label></div>
        <label className="sp-field"><span>Paneles planeados</span><input type="number" min="1" max="100" required value={schedule.panels} onChange={(event) => setSchedule({ ...schedule, panels: event.target.value })} /></label>
        <label className="sp-field"><span>Dirección de trabajo</span><input maxLength="240" placeholder="Usa el domicilio del expediente si se deja vacío" value={schedule.address} onChange={(event) => setSchedule({ ...schedule, address: event.target.value })} /></label>
        <label className="sp-field"><span>Contacto en sitio</span><input maxLength="160" placeholder="Nombre y teléfono para el acceso" value={schedule.contact} onChange={(event) => setSchedule({ ...schedule, contact: event.target.value })} /></label>
        <label className="sp-field"><span>Alcance</span><textarea maxLength="500" value={schedule.scope} onChange={(event) => setSchedule({ ...schedule, scope: event.target.value })} /></label>
        <button className="sp-button sp-button--primary" disabled={busy === 'schedule' || !data.crews.length}>{busy === 'schedule' ? 'Validando capacidad…' : 'Confirmar orden'}</button>
      </form>}
    </div>}

    {tab === 'field' && (selected ? <div className="sp-field-order">
      <header className="sp-field-order-head"><div><p className="sp-section-number">{selected.folio}</p><h2>{project?.customer_name ?? 'Proyecto solar'}</h2><p>{selected.solar_crews?.name} · {dateTime.format(new Date(selected.scheduled_start))} · {selected.planned_panels} paneles</p></div><div className="sp-field-progress"><strong>{checklistPercent}%</strong><span>{completeCount} de {checklist.length} controles</span></div></header>
      <div className="sp-field-actions"><button type="button" onClick={() => onOpenProject(selected.project_id)}>Expediente</button>{selected.status === 'confirmed' && <button type="button" className="is-primary" onClick={() => setOrderStatus('in_progress')}>Iniciar orden</button>}{selected.status === 'paused' && <button type="button" className="is-primary" onClick={() => setOrderStatus('in_progress')}>Reanudar</button>}{selected.status === 'in_progress' && <button type="button" className="is-stop" onClick={() => setOrderStatus('paused')}>Detener por seguridad</button>}{['in_progress', 'paused'].includes(selected.status) && <button type="button" onClick={() => setOrderStatus('completed')}>Terminar orden</button>}<button type="button" onClick={() => downloadHandoverCertificate({ ...project, _profileMap: data.profileMap }, selected)}>Generar acta</button></div>
      <div className="sp-field-grid">
        <div className="sp-field-checklist">
          {Object.entries(CATEGORY).map(([category, label]) => {
            const items = checklist.filter((item) => item.category === category);
            if (!items.length) return null;
            const count = items.filter((item) => (optimistic[item.id] ?? item.status) === 'complete').length;
            return <section key={category} className={category === 'safety' ? 'is-safety' : ''}><header><div><span>{category === 'safety' ? 'PUERTA' : 'ETAPA'}</span><h3>{label}</h3></div><b>{count}/{items.length}</b></header>{items.map((item) => { const status = optimistic[item.id] ?? item.status; return <article className={`is-${status}`} key={item.id}><button type="button" aria-label={`${status === 'complete' ? 'Reabrir' : 'Completar'} ${item.title}`} onClick={() => setChecklist(item, status === 'complete' ? 'pending' : 'complete')}><span>{status === 'complete' ? '✓' : ''}</span><div><strong>{item.title}</strong><small>{item.guidance}</small>{item.notes && <em>{item.notes}</em>}</div></button>{status !== 'complete' && <button type="button" className="sp-block-item" onClick={() => setChecklist(item, 'blocked')}>Bloquear</button>}</article>; })}</section>;
          })}
        </div>
        <aside className="sp-field-rail">
          <section><p className="sp-section-number">EVIDENCIA</p><h3>Fotos y pruebas</h3><p>JPG, PNG, WEBP o PDF. Se guardan directamente en el expediente privado.</p><label className="sp-upload-action"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple capture="environment" onChange={(event) => uploadEvidence(event.target.files)} disabled={!online || busy === 'evidence'} />{busy === 'evidence' ? 'Subiendo…' : online ? '+ Tomar o elegir evidencia' : 'Espera conexión para subir'}</label></section>
          <section><p className="sp-section-number">INCIDENCIAS</p><h3>Registrar sin ocultar.</h3><form onSubmit={reportIncident}><label className="sp-field"><span>Tipo</span><select value={incident.type} onChange={(event) => setIncident({ ...incident, type: event.target.value })}><option value="safety">Seguridad</option><option value="roof">Techo</option><option value="electrical">Eléctrica</option><option value="material">Material</option><option value="weather">Clima</option><option value="customer">Cliente</option><option value="quality">Calidad</option><option value="other">Otra</option></select></label><label className="sp-field"><span>Severidad</span><select value={incident.severity} onChange={(event) => setIncident({ ...incident, severity: event.target.value })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta · pausa automática</option><option value="critical">Crítica · pausa automática</option></select></label><label className="sp-field"><span>Qué ocurrió</span><textarea minLength="5" maxLength="1500" required value={incident.description} onChange={(event) => setIncident({ ...incident, description: event.target.value })} /></label><label className="sp-field"><span>Acción inmediata</span><textarea maxLength="1000" value={incident.action} onChange={(event) => setIncident({ ...incident, action: event.target.value })} /></label><button className="sp-button sp-button--secondary" disabled={busy === 'incident'}>Registrar incidencia</button></form>
            <div className="sp-incident-list">{incidents.map((item) => <article key={item.id}><span className={`is-${item.severity}`}>{item.severity}</span><strong>{item.description}</strong><small>{item.status === 'resolved' ? `Resuelta: ${item.resolution}` : item.immediate_action || 'Sin acción inmediata registrada'}</small>{isAdmin && item.status === 'open' && <button type="button" onClick={() => resolveIncident(item)}>Resolver</button>}</article>)}</div>
          </section>
        </aside>
      </div>
    </div> : <div className="sp-empty"><span>—</span><h3>Selecciona una orden</h3><p>Abre una orden desde Programa para trabajar su checklist.</p></div>)}

    {tab === 'team' && isAdmin && <div className="sp-team-operations">
      <section><header><p className="sp-section-number">PERSONAL</p><h2>Competencia y vigencia.</h2></header><div className="sp-field-worker-list">{data.fieldWorkers.map((item) => { const warnings = readiness(item); return <article key={item.id}><div><strong>{item.full_name}</strong><small>{TRADES[item.trade]} · {item.phone || 'sin teléfono'}</small></div><span className={warnings.length ? 'is-warning' : 'is-ready'}>{warnings.length ? `Revisar ${warnings.join(', ')}` : 'Vigente'}</span></article>; })}</div><form className="sp-team-form" onSubmit={createWorker}><label className="sp-field"><span>Nombre</span><input required maxLength="140" value={worker.fullName} onChange={(event) => setWorker({ ...worker, fullName: event.target.value })} /></label><label className="sp-field"><span>Oficio</span><select value={worker.trade} onChange={(event) => setWorker({ ...worker, trade: event.target.value })}>{Object.entries(TRADES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="sp-field"><span>Teléfono</span><input maxLength="30" value={worker.phone} onChange={(event) => setWorker({ ...worker, phone: event.target.value })} /></label><label className="sp-field"><span>Autorización altura hasta</span><input type="date" value={worker.heightUntil} onChange={(event) => setWorker({ ...worker, heightUntil: event.target.value })} /></label><label className="sp-field"><span>Aptitud médica hasta</span><input type="date" value={worker.medicalUntil} onChange={(event) => setWorker({ ...worker, medicalUntil: event.target.value })} /></label><label className="sp-field"><span>EPP verificado</span><input type="date" value={worker.ppeAt} onChange={(event) => setWorker({ ...worker, ppeAt: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'worker'}>Agregar técnico</button></form></section>
      <section><header><p className="sp-section-number">CUADRILLAS</p><h2>Capacidad real.</h2></header><div className="sp-crew-list">{data.crews.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.solar_crew_members?.filter((member) => member.active).length ?? 0} integrantes</small></div><b>{item.daily_capacity_panels}<small>paneles/día</small></b></article>)}</div><form className="sp-team-form sp-team-form--crew" onSubmit={createCrew}><label className="sp-field"><span>Nombre de cuadrilla</span><input required maxLength="80" value={crew.name} onChange={(event) => setCrew({ ...crew, name: event.target.value })} /></label><label className="sp-field"><span>Capacidad paneles/día</span><input type="number" min="1" max="100" required value={crew.capacity} onChange={(event) => setCrew({ ...crew, capacity: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'crew'}>Crear cuadrilla</button></form><form className="sp-team-form sp-team-form--assign" onSubmit={assignWorker}><label className="sp-field"><span>Cuadrilla</span><select required value={assignment.crewId} onChange={(event) => setAssignment({ ...assignment, crewId: event.target.value })}><option value="">Selecciona</option>{data.crews.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="sp-field"><span>Técnico</span><select required value={assignment.workerId} onChange={(event) => setAssignment({ ...assignment, workerId: event.target.value })}><option value="">Selecciona</option>{data.fieldWorkers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label className="sp-field"><span>Función</span><select value={assignment.role} onChange={(event) => setAssignment({ ...assignment, role: event.target.value })}>{Object.entries(TRADES).filter(([key]) => key !== 'other').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="sp-button sp-button--secondary" disabled={busy === 'assignment'}>Asignar</button></form></section>
    </div>}
  </section>;
}

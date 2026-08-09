import { useEffect, useMemo, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';

const STATUS = {
  draft: 'Preparación', submitted: 'Ingresada', under_review: 'En revisión', observation: 'Con observación',
  responded: 'Respuesta enviada', approved: 'Aprobada', contracts_pending: 'Contratos pendientes',
  meter_pending: 'Medidor pendiente', meter_scheduled: 'Medidor programado', meter_installed: 'Medidor instalado',
  interconnected: 'Interconectado', closed: 'Cerrado', cancelled: 'Cancelado',
};
const WAITING = { none: 'Sin espera', cdse: 'CDSE', customer: 'Cliente', cfe: 'CFE', distributor: 'Distribuidora', supplier: 'Suministradora', third_party: 'Tercero' };
const CHANNEL = { office: 'Oficina', portal: 'Portal', supplier: 'Suministradora', other: 'Otro' };
const STAGES = [
  ['submitted', 'Ingreso'], ['under_review', 'Revisión'], ['approved', 'Respuesta'],
  ['contracts_pending', 'Contratos'], ['meter_pending', 'Medidor'], ['interconnected', 'Interconexión'],
];
const STATUS_ORDER = ['draft','submitted','under_review','observation','responded','approved','contracts_pending','meter_pending','meter_scheduled','meter_installed','interconnected','closed'];
const CFE_DOCUMENTS = ['interconnection_application','cfe_acknowledgement','cfe_response','interconnection_contract','compensation_contract','bidirectional_meter_evidence'];
const ERROR_MESSAGES = {
  CFE_SUBMISSION_DATA_REQUIRED: 'Captura folio y fecha de ingreso antes de avanzar el trámite.',
  PROJECT_NOT_READY_FOR_CFE: 'El proyecto aún no tiene visita, ingeniería y documentos base aprobados para presentar.',
  CFE_CLOSURE_DOCUMENTS_REQUIRED: 'Antes de cerrar, aprueba respuesta CFE, ambos contratos y evidencia del medidor.',
  BIDIRECTIONAL_METER_DATA_REQUIRED: 'Captura serie y fecha del medidor bidireccional.',
  INTERCONNECTION_DATE_REQUIRED: 'Captura la fecha efectiva de interconexión.',
  OBSERVATION_DESCRIPTION_REQUIRED: 'Describe con precisión la observación recibida.',
  OBSERVATION_RESPONSE_REQUIRED: 'Documenta la respuesta enviada.',
  OPEN_OBSERVATION_REQUIRED: 'La observación ya no está abierta para respuesta.',
};

const toLocal = (value) => value ? new Date(value).toISOString().slice(0, 16) : '';
const daysSince = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 86400000)) : 0;
const dateTime = (value) => value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Pendiente';
const friendlyError = (error) => {
  const raw = error?.message?.replace(/^.*?:\s*/, '') ?? '';
  return ERROR_MESSAGES[raw] ?? (raw || 'No se pudo completar la acción.');
};

function emptyForm(projectId = '') {
  return {
    projectId, status: 'draft', submissionChannel: 'office', receivingOffice: '', trackingFolio: '', submittedAt: '',
    studyRequired: false, referenceSlaDays: '13', referenceTargetAt: '', waitingOn: 'cdse', lastExternalContactAt: '',
    nextFollowUpAt: '', interconnectionContractNumber: '', compensationContractNumber: '', previousMeterSerial: '',
    bidirectionalMeterSerial: '', meterAppointmentAt: '', meterChangedAt: '', interconnectedAt: '', notes: '',
  };
}

function formFrom(item) {
  return {
    projectId: item.project_id, status: item.status, submissionChannel: item.submission_channel ?? 'office',
    receivingOffice: item.receiving_office ?? '', trackingFolio: item.tracking_folio ?? '', submittedAt: toLocal(item.submitted_at),
    studyRequired: item.study_required, referenceSlaDays: String(item.reference_sla_days ?? 13), referenceTargetAt: toLocal(item.reference_target_at),
    waitingOn: item.waiting_on, lastExternalContactAt: toLocal(item.last_external_contact_at), nextFollowUpAt: toLocal(item.next_follow_up_at),
    interconnectionContractNumber: item.interconnection_contract_number ?? '', compensationContractNumber: item.compensation_contract_number ?? '',
    previousMeterSerial: item.previous_meter_serial ?? '', bidirectionalMeterSerial: item.bidirectional_meter_serial ?? '',
    meterAppointmentAt: toLocal(item.meter_appointment_at), meterChangedAt: toLocal(item.meter_changed_at),
    interconnectedAt: toLocal(item.interconnected_at), notes: item.notes ?? '',
  };
}

export default function CfeTracking({ data, isAdmin, refresh, onOpenProject, openCaseId }) {
  const [selectedId, setSelectedId] = useState(data.cfeCases[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [observation, setObservation] = useState({ description: '', dueAt: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const cases = useMemo(() => [...data.cfeCases].sort((a, b) => String(b.submitted_at ?? b.created_at).localeCompare(String(a.submitted_at ?? a.created_at))), [data.cfeCases]);
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0] ?? null;
  const project = selected ? data.projects.find((item) => item.id === selected.project_id) : null;
  const observations = [...(selected?.solar_cfe_observations ?? [])].sort((a, b) => b.observation_number - a.observation_number);
  const activeCases = cases.filter((item) => !['closed','cancelled'].includes(item.status));
  const overdueFollowups = activeCases.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at) < new Date());
  const openObservations = cases.flatMap((item) => item.solar_cfe_observations ?? []).filter((item) => ['open','rejected'].includes(item.status));
  const waitingExternal = activeCases.filter((item) => ['cfe','distributor','supplier','third_party'].includes(item.waiting_on));
  useEffect(() => { if (openCaseId) setSelectedId(openCaseId); }, [openCaseId]);
  const projectsWithoutCase = data.projects.filter((item) => !cases.some((cfeCase) => cfeCase.project_id === item.id) && !['cancelled','operational'].includes(item.status));

  useEffect(() => {
    setEditing(false);
    setMessage('');
  }, [selectedId]);

  async function saveCase(event) {
    event.preventDefault();
    setBusy('case'); setMessage('');
    const payload = Object.fromEntries(Object.entries(form).filter(([key]) => key !== 'projectId'));
    const { data: result, error } = await getSupabaseClient().rpc('save_solar_cfe_case', { p_project_id: form.projectId, p_data: payload });
    setBusy('');
    if (error) return setMessage(friendlyError(error));
    setSelectedId(result.id); setEditing(false); setMessage('Seguimiento CFE actualizado con bitácora.');
    await refresh();
  }

  async function createObservation(event) {
    event.preventDefault();
    setBusy('observation'); setMessage('');
    const { error } = await getSupabaseClient().rpc('create_solar_cfe_observation', {
      p_case_id: selected.id, p_description: observation.description,
      p_internal_due_at: observation.dueAt ? new Date(observation.dueAt).toISOString() : null,
    });
    setBusy('');
    if (error) return setMessage(friendlyError(error));
    setObservation({ description: '', dueAt: '' }); setMessage('Observación registrada; el proyecto quedó marcado en riesgo.');
    await refresh();
  }

  async function respond(item) {
    const response = window.prompt('Describe la respuesta enviada y la corrección realizada:')?.trim();
    if (!response) return;
    const projectDocuments = project?.solar_project_documents ?? [];
    const responseDoc = projectDocuments.find((document) => document.document_code === 'cfe_response' && ['uploaded','approved'].includes(document.status));
    setBusy(item.id); setMessage('');
    const { error } = await getSupabaseClient().rpc('respond_solar_cfe_observation', {
      p_observation_id: item.id, p_response: response, p_response_document_id: responseDoc?.id ?? null,
    });
    setBusy('');
    if (error) return setMessage(friendlyError(error));
    setMessage(responseDoc ? 'Respuesta vinculada al documento del expediente.' : 'Respuesta registrada. Carga la evidencia en el expediente para completar el respaldo.');
    await refresh();
  }

  const currentIndex = selected ? STATUS_ORDER.indexOf(selected.status) : -1;
  const docs = (project?.solar_project_documents ?? []).filter((item) => CFE_DOCUMENTS.includes(item.document_code));
  const completeDocs = docs.filter((item) => item.status === 'approved').length;

  return <section className="sp-view sp-cfe">
    <header className="sp-view-header"><div><p className="sp-section-number">INTERCONEXIÓN / CFE</p><h1>Un folio no es el final del trámite.</h1></div><p className="sp-header-note">Ingreso, observaciones, contratos, medidor e interconexión con evidencia y tiempo atribuible. Los plazos visibles son referencias operativas, no promesas al cliente.</p></header>
    <div className="sp-ledger">
      <div><span>Trámites activos</span><strong>{activeCases.length}</strong><small>con responsable visible</small></div>
      <div><span>Seguimientos vencidos</span><strong>{overdueFollowups.length}</strong><small>requieren contacto</small></div>
      <div><span>Observaciones abiertas</span><strong>{openObservations.length}</strong><small>respuesta pendiente</small></div>
      <div><span>Espera externa</span><strong>{waitingExternal.length}</strong><small>CFE, distribuidora o tercero</small></div>
    </div>

    {message && <p className="sp-inline-notice" role="status">{message}</p>}
    <div className="sp-cfe-shell">
      <aside className="sp-cfe-list">
        <div className="sp-subhead"><h2>Trámites</h2>{isAdmin && <button type="button" onClick={() => { setForm(emptyForm(projectsWithoutCase[0]?.id)); setEditing(true); setSelectedId(null); }}>Nuevo</button>}</div>
        {cases.map((item) => <button type="button" className={selected?.id === item.id ? 'is-active' : ''} onClick={() => setSelectedId(item.id)} key={item.id}>
          <span className={`sp-cfe-dot is-${item.status}`} />
          <div><strong>{item.solar_projects?.customer_name ?? item.tracking_folio ?? 'Trámite en preparación'}</strong><small>{item.tracking_folio ?? 'Sin folio'} · {STATUS[item.status]}</small></div>
          <b>{daysSince(item.waiting_since)}<small>d espera</small></b>
        </button>)}
        {!cases.length && <div className="sp-empty"><span>—</span><h3>Sin trámites registrados</h3><p>Abre el caso cuando el expediente esté listo para presentarse.</p></div>}
      </aside>

      <main className="sp-cfe-detail">
        {editing ? <form className="sp-cfe-form" onSubmit={saveCase}>
          <div className="sp-subhead"><div><p className="sp-section-number">CONTROL CFE</p><h2>{selected ? 'Actualizar trámite' : 'Abrir trámite'}</h2></div><button type="button" onClick={() => setEditing(false)}>Cancelar</button></div>
          <div className="sp-form-grid">
            {!selected && <label className="sp-field sp-field--wide"><span>Proyecto</span><select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">Selecciona</option>{projectsWithoutCase.map((item) => <option key={item.id} value={item.id}>{item.folio} · {item.customer_name}</option>)}</select></label>}
            <label className="sp-field"><span>Etapa del trámite</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{Object.entries(STATUS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="sp-field"><span>En espera de</span><select value={form.waitingOn} onChange={(event) => setForm({ ...form, waitingOn: event.target.value })}>{Object.entries(WAITING).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="sp-field"><span>Canal de ingreso</span><select value={form.submissionChannel} onChange={(event) => setForm({ ...form, submissionChannel: event.target.value })}>{Object.entries(CHANNEL).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="sp-field"><span>Oficina receptora</span><input value={form.receivingOffice} onChange={(event) => setForm({ ...form, receivingOffice: event.target.value })} /></label>
            <label className="sp-field"><span>Folio</span><input value={form.trackingFolio} onChange={(event) => setForm({ ...form, trackingFolio: event.target.value })} /></label>
            <label className="sp-field"><span>Fecha de ingreso</span><input type="datetime-local" value={form.submittedAt} onChange={(event) => setForm({ ...form, submittedAt: event.target.value })} /></label>
            <label className="sp-field"><span>Referencia interna (días)</span><input type="number" min="1" max="180" value={form.referenceSlaDays} onChange={(event) => setForm({ ...form, referenceSlaDays: event.target.value })} /></label>
            <label className="sp-field"><span>Fecha objetivo de referencia</span><input type="datetime-local" value={form.referenceTargetAt} onChange={(event) => setForm({ ...form, referenceTargetAt: event.target.value })} /></label>
            <label className="sp-field"><span>Último contacto externo</span><input type="datetime-local" value={form.lastExternalContactAt} onChange={(event) => setForm({ ...form, lastExternalContactAt: event.target.value })} /></label>
            <label className="sp-field"><span>Próximo seguimiento</span><input type="datetime-local" value={form.nextFollowUpAt} onChange={(event) => setForm({ ...form, nextFollowUpAt: event.target.value })} /></label>
            <label className="sp-field"><span>Contrato de interconexión</span><input value={form.interconnectionContractNumber} onChange={(event) => setForm({ ...form, interconnectionContractNumber: event.target.value })} /></label>
            <label className="sp-field"><span>Contrato de contraprestación</span><input value={form.compensationContractNumber} onChange={(event) => setForm({ ...form, compensationContractNumber: event.target.value })} /></label>
            <label className="sp-field"><span>Serie medidor anterior</span><input value={form.previousMeterSerial} onChange={(event) => setForm({ ...form, previousMeterSerial: event.target.value })} /></label>
            <label className="sp-field"><span>Serie medidor bidireccional</span><input value={form.bidirectionalMeterSerial} onChange={(event) => setForm({ ...form, bidirectionalMeterSerial: event.target.value })} /></label>
            <label className="sp-field"><span>Cita de medidor</span><input type="datetime-local" value={form.meterAppointmentAt} onChange={(event) => setForm({ ...form, meterAppointmentAt: event.target.value })} /></label>
            <label className="sp-field"><span>Cambio de medidor</span><input type="datetime-local" value={form.meterChangedAt} onChange={(event) => setForm({ ...form, meterChangedAt: event.target.value })} /></label>
            <label className="sp-field"><span>Interconexión efectiva</span><input type="datetime-local" value={form.interconnectedAt} onChange={(event) => setForm({ ...form, interconnectedAt: event.target.value })} /></label>
            <label className="sp-field sp-field--wide"><span>Notas operativas</span><textarea maxLength="2000" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <label className="sp-checkbox sp-field--wide"><input type="checkbox" checked={form.studyRequired} onChange={(event) => setForm({ ...form, studyRequired: event.target.checked, referenceSlaDays: event.target.checked ? '18' : '13' })} /><span>La Distribuidora indicó estudio de interconexión</span></label>
          </div>
          <button className="sp-button sp-button--primary" disabled={busy === 'case' || !form.projectId}>{busy === 'case' ? 'Guardando…' : 'Guardar seguimiento'}</button>
        </form> : selected && project ? <>
          <header className="sp-cfe-hero"><div><p className="sp-section-number">{project.folio} / {selected.tracking_folio ?? 'SIN FOLIO'}</p><h2>{project.customer_name}</h2><p>{STATUS[selected.status]} · espera de {WAITING[selected.waiting_on].toLowerCase()}</p></div>{isAdmin && <button type="button" className="sp-button sp-button--secondary" onClick={() => { setForm(formFrom(selected)); setEditing(true); }}>Actualizar</button>}</header>
          <div className="sp-cfe-clock"><div><span>Desde ingreso</span><strong>{daysSince(selected.submitted_at)}</strong><small>días calendario</small></div><div><span>Espera actual</span><strong>{daysSince(selected.waiting_since)}</strong><small>atribuibles a {WAITING[selected.waiting_on]}</small></div><div><span>Referencia interna</span><strong>{selected.reference_sla_days}</strong><small>días · no es promesa</small></div><div><span>Próximo contacto</span><strong>{selected.next_follow_up_at ? new Date(selected.next_follow_up_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '—'}</strong><small>{selected.next_follow_up_at && new Date(selected.next_follow_up_at) < new Date() ? 'vencido' : 'programado'}</small></div></div>
          <div className="sp-cfe-rail">{STAGES.map(([status,label], index) => <div className={currentIndex >= STATUS_ORDER.indexOf(status) || (status === 'approved' && ['observation','responded'].includes(selected.status)) ? 'is-complete' : ''} key={status}><span>{String(index + 1).padStart(2,'0')}</span><strong>{label}</strong></div>)}</div>
          <div className="sp-cfe-columns">
            <section><div className="sp-subhead"><div><p className="sp-section-number">EXPEDIENTE</p><h3>{completeDocs} de {docs.length} respaldos aprobados</h3></div><button type="button" onClick={() => onOpenProject(project.id)}>Abrir proyecto</button></div><div className="sp-cfe-docs">{docs.map((document) => <div key={document.id}><span className={`is-${document.status}`} /> <strong>{document.title}</strong><small>{document.status === 'approved' ? 'Aprobado' : document.status === 'uploaded' ? 'Por revisar' : 'Pendiente'}</small></div>)}</div></section>
            <section><div className="sp-subhead"><div><p className="sp-section-number">DATOS DE CIERRE</p><h3>Contratos y medición</h3></div></div><dl className="sp-cfe-facts"><div><dt>Interconexión</dt><dd>{selected.interconnection_contract_number ?? 'Pendiente'}</dd></div><div><dt>Contraprestación</dt><dd>{selected.compensation_contract_number ?? 'Pendiente'}</dd></div><div><dt>Medidor bidireccional</dt><dd>{selected.bidirectional_meter_serial ?? 'Pendiente'}</dd></div><div><dt>Fecha de cambio</dt><dd>{dateTime(selected.meter_changed_at)}</dd></div></dl></section>
          </div>
          <section className="sp-cfe-observations"><div className="sp-subhead"><div><p className="sp-section-number">CICLOS DE CORRECCIÓN</p><h3>Observaciones y respuestas</h3></div></div>
            {observations.map((item) => <article key={item.id} className={`is-${item.status}`}><div><span>OBSERVACIÓN {String(item.observation_number).padStart(2,'0')}</span><strong>{item.description}</strong><small>Recibida {dateTime(item.observed_at)}{item.internal_due_at ? ` · compromiso ${dateTime(item.internal_due_at)}` : ''}</small>{item.response && <p><b>Respuesta:</b> {item.response}</p>}</div>{isAdmin && ['open','rejected'].includes(item.status) && <button type="button" onClick={() => respond(item)} disabled={busy === item.id}>Registrar respuesta</button>}</article>)}
            {!observations.length && <p className="sp-track-empty">Sin observaciones registradas. Si la Distribuidora previene o solicita corrección, abre un ciclo y conserva la respuesta.</p>}
            {isAdmin && <form className="sp-cfe-observation-form" onSubmit={createObservation}><label className="sp-field"><span>Nueva observación</span><textarea required minLength="5" value={observation.description} onChange={(event) => setObservation({ ...observation, description: event.target.value })} /></label><label className="sp-field"><span>Compromiso interno</span><input type="datetime-local" value={observation.dueAt} onChange={(event) => setObservation({ ...observation, dueAt: event.target.value })} /></label><button className="sp-button sp-button--primary" disabled={busy === 'observation'}>Registrar observación</button></form>}
          </section>
        </> : <div className="sp-empty"><span>01</span><h3>Selecciona o abre un trámite</h3><p>El seguimiento comienza cuando CDSE identifica el proyecto y prepara su ingreso.</p></div>}
      </main>
    </div>
  </section>;
}

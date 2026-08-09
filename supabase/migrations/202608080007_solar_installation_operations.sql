-- CDSE Solar — installation orders, crews and field quality gates.

create table public.solar_field_workers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 140),
  phone text,
  trade text not null default 'installer' check (trade in (
    'foreman', 'installer', 'electrician', 'helper', 'safety', 'other'
  )),
  active boolean not null default true,
  height_work_authorized_until date,
  medical_clearance_until date,
  ppe_verified_at date,
  emergency_contact text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_crews (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  daily_capacity_panels integer not null default 8 check (daily_capacity_panels between 1 and 100),
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_crew_members (
  crew_id uuid not null references public.solar_crews(id) on delete cascade,
  worker_id uuid not null references public.solar_field_workers(id) on delete restrict,
  crew_role text not null check (crew_role in ('foreman', 'installer', 'electrician', 'helper', 'safety')),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (crew_id, worker_id)
);

create table public.solar_work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  crew_id uuid not null references public.solar_crews(id) on delete restrict,
  folio_number bigint generated always as identity unique,
  folio text generated always as ('CDSE-OT-' || lpad(folio_number::text, 6, '0')) stored unique,
  status text not null default 'planned' check (status in (
    'planned', 'confirmed', 'in_progress', 'paused', 'completed', 'cancelled'
  )),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  planned_panels integer not null check (planned_panels > 0),
  work_scope text not null default 'Instalación de sistema fotovoltaico interconectado',
  site_address text,
  customer_contact text,
  safety_stop_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end > scheduled_start),
  check (status <> 'paused' or nullif(trim(safety_stop_reason), '') is not null),
  check (status <> 'completed' or completed_at is not null)
);

create index solar_work_orders_schedule_idx on public.solar_work_orders (crew_id, scheduled_start, scheduled_end);
create index solar_work_orders_project_idx on public.solar_work_orders (project_id, status, scheduled_start);

create table public.solar_work_order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.solar_work_orders(id) on delete cascade,
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  item_code text not null check (item_code ~ '^[a-z0-9_]+$'),
  category text not null check (category in (
    'pre_start', 'safety', 'mounting', 'dc', 'ac', 'testing', 'handover'
  )),
  title text not null,
  guidance text,
  required boolean not null default true,
  evidence_required boolean not null default false,
  status text not null default 'pending' check (status in (
    'pending', 'complete', 'blocked', 'not_applicable'
  )),
  notes text,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  unique (work_order_id, item_code),
  check (status <> 'complete' or completed_at is not null),
  check (status <> 'blocked' or nullif(trim(notes), '') is not null)
);

create index solar_work_order_checklist_order_idx
  on public.solar_work_order_checklist_items (work_order_id, category, sort_order);

create table public.solar_work_order_incidents (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.solar_work_orders(id) on delete cascade,
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  incident_type text not null check (incident_type in (
    'safety', 'roof', 'electrical', 'material', 'weather', 'customer', 'quality', 'other'
  )),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  description text not null check (char_length(description) between 5 and 1500),
  immediate_action text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reported_by uuid not null references auth.users(id) on delete restrict,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'resolved' or (resolved_at is not null and nullif(trim(resolution), '') is not null))
);

create index solar_work_order_incidents_open_idx
  on public.solar_work_order_incidents (work_order_id, status, severity);

create trigger solar_field_workers_set_updated_at before update on public.solar_field_workers
for each row execute function public.set_updated_at();
create trigger solar_crews_set_updated_at before update on public.solar_crews
for each row execute function public.set_updated_at();
create trigger solar_work_orders_set_updated_at before update on public.solar_work_orders
for each row execute function public.set_updated_at();
create trigger solar_work_order_checklist_set_updated_at before update on public.solar_work_order_checklist_items
for each row execute function public.set_updated_at();
create trigger solar_work_order_incidents_set_updated_at before update on public.solar_work_order_incidents
for each row execute function public.set_updated_at();

create or replace function public.seed_solar_work_order_checklist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.solar_work_order_checklist_items (
    work_order_id, project_id, item_code, category, title, guidance,
    required, evidence_required, sort_order
  ) values
    (new.id,new.project_id,'approved_engineering_on_site','pre_start','Ingeniería aprobada disponible','Confirmar revisión vigente, unifilar y fichas de equipos.',true,false,10),
    (new.id,new.project_id,'customer_access_confirmed','pre_start','Acceso y contacto confirmados','Validar acceso al inmueble, azotea, tablero y área de maniobra.',true,false,20),
    (new.id,new.project_id,'roof_route_revalidated','pre_start','Techo y ruta revalidados','Detener si las condiciones difieren del levantamiento aprobado.',true,true,30),
    (new.id,new.project_id,'weather_safe','safety','Clima seguro para trabajar','Suspender con lluvia, tormenta eléctrica o viento que comprometa la seguridad.',true,false,40),
    (new.id,new.project_id,'crew_briefing','safety','Charla y autorización de trabajo','Responsables, alcance, riesgos, comunicación y plan de emergencia.',true,false,50),
    (new.id,new.project_id,'ppe_checked','safety','EPP revisado y colocado','Casco, calzado, guantes y protección adicional según análisis de riesgo.',true,false,60),
    (new.id,new.project_id,'fall_protection','safety','Sistema contra caídas verificado','Arnés, línea, conectores y anclaje cuando aplique.',true,true,70),
    (new.id,new.project_id,'work_area_secured','safety','Área delimitada y herramientas aseguradas','Impedir acceso y caída de herramientas o materiales.',true,false,80),
    (new.id,new.project_id,'electrical_lockout','safety','Circuitos identificados y condición segura','Desenergizar, verificar ausencia de tensión y controlar reconexión cuando aplique.',true,false,90),
    (new.id,new.project_id,'layout_confirmed','mounting','Trazo y separaciones confirmados','Respetar ingeniería, pasillos, sombras y accesos.',true,false,110),
    (new.id,new.project_id,'anchors_structure','mounting','Anclajes y estructura terminados','Verificar fijación, nivelación, torque y compatibilidad del techo.',true,true,120),
    (new.id,new.project_id,'waterproofing','mounting','Sellado e impermeabilización revisados','Documentar penetraciones y acabado final.',true,true,130),
    (new.id,new.project_id,'modules_installed','mounting','Módulos instalados e identificados','Cantidad, modelo, sujeción y números de serie cuando aplique.',true,true,140),
    (new.id,new.project_id,'dc_strings','dc','Strings DC conforme a ingeniería','Polaridad, conectores, sujeción y ruta sin esfuerzos.',true,false,210),
    (new.id,new.project_id,'dc_protection_labels','dc','Protecciones y señalización DC','Canalización, seccionamiento y etiquetas terminadas.',true,true,220),
    (new.id,new.project_id,'inverter_installed','ac','Inversor instalado','Ubicación, ventilación, fijación, modelo y serie.',true,true,310),
    (new.id,new.project_id,'ac_protection','ac','Protecciones y conexión AC','Calibres, interruptores, aprietes y señalización conforme al diseño.',true,true,320),
    (new.id,new.project_id,'grounding_complete','ac','Puesta a tierra terminada','Continuidad, uniones y conductores conforme a ingeniería.',true,true,330),
    (new.id,new.project_id,'electrical_tests','testing','Pruebas eléctricas registradas','Polaridad, voltajes, continuidad y resultados de arranque.',true,true,410),
    (new.id,new.project_id,'monitoring_online','testing','Monitoreo configurado','Cuenta, conectividad y visualización verificadas cuando aplique.',true,false,420),
    (new.id,new.project_id,'site_clean','handover','Área limpia y sin pendientes físicos','Retirar residuos, sobrantes y protecciones temporales.',true,true,510),
    (new.id,new.project_id,'customer_orientation','handover','Cliente orientado','Explicar operación, paro, monitoreo, garantías y contacto de soporte.',true,false,520),
    (new.id,new.project_id,'handover_ready','handover','Acta de entrega preparada','Datos del sistema, equipos, pruebas y firmas listos para revisión.',true,false,530);
  return new;
end;
$$;

create trigger solar_work_orders_seed_checklist after insert on public.solar_work_orders
for each row execute function public.seed_solar_work_order_checklist();

create or replace function public.create_solar_field_worker(p_data jsonb)
returns public.solar_field_workers language plpgsql security definer set search_path = '' as $$
declare v_worker public.solar_field_workers;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_data->>'fullName'), '') is null then raise exception 'WORKER_NAME_REQUIRED'; end if;
  insert into public.solar_field_workers (
    full_name, phone, trade, height_work_authorized_until, medical_clearance_until,
    ppe_verified_at, emergency_contact, notes, created_by
  ) values (
    trim(p_data->>'fullName'), nullif(trim(p_data->>'phone'), ''), coalesce(nullif(p_data->>'trade',''),'installer'),
    nullif(p_data->>'heightAuthorizedUntil','')::date, nullif(p_data->>'medicalClearanceUntil','')::date,
    nullif(p_data->>'ppeVerifiedAt','')::date, nullif(trim(p_data->>'emergencyContact'),''),
    nullif(trim(p_data->>'notes'),''), auth.uid()
  ) returning * into v_worker;
  return v_worker;
end; $$;

create or replace function public.create_solar_crew(p_name text, p_daily_capacity_panels integer, p_notes text default null)
returns public.solar_crews language plpgsql security definer set search_path = '' as $$
declare v_crew public.solar_crews;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  insert into public.solar_crews (name, daily_capacity_panels, notes, created_by)
  values (trim(p_name), p_daily_capacity_panels, nullif(trim(p_notes),''), auth.uid()) returning * into v_crew;
  return v_crew;
end; $$;

create or replace function public.assign_solar_crew_member(p_crew_id uuid, p_worker_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  insert into public.solar_crew_members (crew_id, worker_id, crew_role, assigned_by)
  values (p_crew_id, p_worker_id, p_role, auth.uid())
  on conflict (crew_id, worker_id) do update set crew_role = excluded.crew_role, active = true, assigned_by = auth.uid(), assigned_at = now();
end; $$;

create or replace function public.schedule_solar_work_order(p_data jsonb)
returns public.solar_work_orders language plpgsql security definer set search_path = '' as $$
declare v_order public.solar_work_orders; v_project public.solar_projects; v_start timestamptz; v_end timestamptz;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_project from public.solar_projects where id = (p_data->>'projectId')::uuid;
  if v_project.id is null then raise exception 'PROJECT_NOT_FOUND'; end if;
  if v_project.status not in ('approved_for_installation','installation_scheduled') then raise exception 'INSTALLATION_APPROVAL_REQUIRED'; end if;
  v_start := (p_data->>'scheduledStart')::timestamptz; v_end := (p_data->>'scheduledEnd')::timestamptz;
  if v_end <= v_start then raise exception 'INVALID_WORK_ORDER_RANGE'; end if;
  if not exists (select 1 from public.solar_crews where id=(p_data->>'crewId')::uuid and active) then raise exception 'ACTIVE_CREW_REQUIRED'; end if;
  if exists (select 1 from public.solar_work_orders where crew_id=(p_data->>'crewId')::uuid and status not in ('cancelled','completed') and scheduled_start < v_end and scheduled_end > v_start) then raise exception 'CREW_SCHEDULE_CONFLICT'; end if;

  insert into public.solar_work_orders (project_id, crew_id, status, scheduled_start, scheduled_end, planned_panels, work_scope, site_address, customer_contact, created_by)
  values (v_project.id, (p_data->>'crewId')::uuid, 'confirmed', v_start, v_end,
    coalesce(nullif(p_data->>'plannedPanels','')::integer, coalesce((v_project.sold_scope_snapshot->>'panelCount')::integer,1)),
    coalesce(nullif(trim(p_data->>'workScope'),''),'Instalación de sistema fotovoltaico interconectado'),
    nullif(trim(p_data->>'siteAddress'),''), nullif(trim(p_data->>'customerContact'),''), auth.uid()) returning * into v_order;
  update public.solar_projects set status='installation_scheduled', target_installation_at=v_start, next_action='Preparar orden de trabajo y puerta de seguridad' where id=v_project.id;
  insert into public.solar_project_events (project_id,event_name,actor_user_id,metadata) values (v_project.id,'installation_scheduled',auth.uid(),jsonb_build_object('workOrderId',v_order.id,'folio',v_order.folio,'crewId',v_order.crew_id,'start',v_start,'end',v_end));
  return v_order;
end; $$;

create or replace function public.set_solar_work_order_checklist_item(p_item_id uuid, p_status text, p_notes text default null)
returns public.solar_work_order_checklist_items language plpgsql security definer set search_path = '' as $$
declare v_item public.solar_work_order_checklist_items;
begin
  select * into v_item from public.solar_work_order_checklist_items where id=p_item_id;
  if v_item.id is null then raise exception 'CHECKLIST_ITEM_NOT_FOUND'; end if;
  if not public.can_access_solar_project(v_item.project_id) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_status not in ('pending','complete','blocked','not_applicable') then raise exception 'INVALID_CHECKLIST_STATUS'; end if;
  if p_status='blocked' and nullif(trim(p_notes),'') is null then raise exception 'BLOCKED_ITEM_NOTES_REQUIRED'; end if;
  update public.solar_work_order_checklist_items set status=p_status, notes=nullif(trim(p_notes),''),
    completed_by=case when p_status='complete' then auth.uid() else null end,
    completed_at=case when p_status='complete' then now() else null end
  where id=p_item_id returning * into v_item;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata) values(v_item.project_id,'installation_checklist_updated',auth.uid(),jsonb_build_object('workOrderId',v_item.work_order_id,'itemCode',v_item.item_code,'status',v_item.status,'notes',v_item.notes));
  return v_item;
end; $$;

create or replace function public.set_solar_work_order_status(p_work_order_id uuid, p_status text, p_reason text default null)
returns public.solar_work_orders language plpgsql security definer set search_path = '' as $$
declare v_order public.solar_work_orders; v_missing integer; v_old text;
begin
  select * into v_order from public.solar_work_orders where id=p_work_order_id;
  if v_order.id is null then raise exception 'WORK_ORDER_NOT_FOUND'; end if;
  if not public.can_access_solar_project(v_order.project_id) then raise exception 'NOT_AUTHORIZED'; end if;
  v_old:=v_order.status;
  if p_status='in_progress' then
    if v_old not in ('confirmed','paused') then raise exception 'CONFIRMED_WORK_ORDER_REQUIRED'; end if;
    if not exists(select 1 from public.solar_engineering_revisions where project_id=v_order.project_id and status='approved') then raise exception 'APPROVED_ENGINEERING_REQUIRED'; end if;
    select count(*) into v_missing from public.solar_work_order_checklist_items where work_order_id=v_order.id and required and category in ('pre_start','safety') and status<>'complete';
    if v_missing>0 then raise exception 'SAFETY_GATE_INCOMPLETE'; end if;
  elsif p_status='paused' then
    if nullif(trim(p_reason),'') is null then raise exception 'SAFETY_STOP_REASON_REQUIRED'; end if;
  elsif p_status='completed' then
    select count(*) into v_missing from public.solar_work_order_checklist_items where work_order_id=v_order.id and required and status<>'complete';
    if v_missing>0 then raise exception 'INSTALLATION_CHECKLIST_INCOMPLETE'; end if;
    if exists(select 1 from public.solar_work_order_incidents where work_order_id=v_order.id and status='open' and severity in ('high','critical')) then raise exception 'OPEN_CRITICAL_INCIDENT'; end if;
    if not exists(select 1 from public.solar_project_documents where project_id=v_order.project_id and document_code='installation_evidence' and status in ('uploaded','approved')) then raise exception 'INSTALLATION_EVIDENCE_REQUIRED'; end if;
  elsif p_status not in ('confirmed','cancelled') then raise exception 'INVALID_WORK_ORDER_STATUS'; end if;

  update public.solar_work_orders set status=p_status,
    safety_stop_reason=case when p_status='paused' then trim(p_reason) when p_status='in_progress' then null else safety_stop_reason end,
    started_at=case when p_status='in_progress' then coalesce(started_at,now()) else started_at end,
    completed_at=case when p_status='completed' then now() else completed_at end
  where id=v_order.id returning * into v_order;
  update public.solar_projects set status=case when p_status='in_progress' then 'installation_in_progress' when p_status='completed' then 'installed_pending_interconnection' else status end,
    health=case when p_status='paused' then 'blocked' when p_status in ('in_progress','completed') then 'on_track' else health end,
    blocked_reason=case when p_status='paused' then trim(p_reason) when p_status in ('in_progress','completed') then null else blocked_reason end,
    next_action=case when p_status='paused' then 'Resolver paro de seguridad en '||v_order.folio when p_status='completed' then 'Revisar evidencia y continuar interconexión/entrega' else next_action end
  where id=v_order.project_id;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata) values(v_order.project_id,'work_order_status_changed',auth.uid(),jsonb_build_object('workOrderId',v_order.id,'previousStatus',v_old,'status',p_status,'reason',p_reason));
  return v_order;
end; $$;

create or replace function public.report_solar_work_order_incident(p_work_order_id uuid, p_type text, p_severity text, p_description text, p_immediate_action text default null)
returns public.solar_work_order_incidents language plpgsql security definer set search_path = '' as $$
declare v_order public.solar_work_orders; v_incident public.solar_work_order_incidents;
begin
  select * into v_order from public.solar_work_orders where id=p_work_order_id;
  if v_order.id is null or not public.can_access_solar_project(v_order.project_id) then raise exception 'NOT_AUTHORIZED'; end if;
  insert into public.solar_work_order_incidents(work_order_id,project_id,incident_type,severity,description,immediate_action,reported_by)
  values(p_work_order_id,v_order.project_id,p_type,p_severity,trim(p_description),nullif(trim(p_immediate_action),''),auth.uid()) returning * into v_incident;
  if p_severity in ('high','critical') then
    update public.solar_work_orders set status='paused',safety_stop_reason='Incidencia '||p_severity||': '||left(trim(p_description),180) where id=p_work_order_id and status='in_progress';
    update public.solar_projects set health='blocked',blocked_reason='Incidencia de instalación: '||left(trim(p_description),180) where id=v_order.project_id;
  end if;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata) values(v_order.project_id,'installation_incident_reported',auth.uid(),jsonb_build_object('workOrderId',p_work_order_id,'incidentId',v_incident.id,'type',p_type,'severity',p_severity));
  return v_incident;
end; $$;

create or replace function public.resolve_solar_work_order_incident(p_incident_id uuid, p_resolution text)
returns public.solar_work_order_incidents language plpgsql security definer set search_path = '' as $$
declare v_incident public.solar_work_order_incidents;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  update public.solar_work_order_incidents set status='resolved',resolution=trim(p_resolution),resolved_by=auth.uid(),resolved_at=now()
  where id=p_incident_id and status='open' returning * into v_incident;
  if v_incident.id is null then raise exception 'OPEN_INCIDENT_REQUIRED'; end if;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata) values(v_incident.project_id,'installation_incident_resolved',auth.uid(),jsonb_build_object('incidentId',v_incident.id,'resolution',v_incident.resolution));
  return v_incident;
end; $$;

alter table public.solar_field_workers enable row level security;
alter table public.solar_crews enable row level security;
alter table public.solar_crew_members enable row level security;
alter table public.solar_work_orders enable row level security;
alter table public.solar_work_order_checklist_items enable row level security;
alter table public.solar_work_order_incidents enable row level security;

create policy "solar staff read field workers" on public.solar_field_workers for select to authenticated using (public.is_solar_admin() or public.is_active_solar_seller());
create policy "admins manage field workers" on public.solar_field_workers for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "solar staff read crews" on public.solar_crews for select to authenticated using (public.is_solar_admin() or public.is_active_solar_seller());
create policy "admins manage crews" on public.solar_crews for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "solar staff read crew members" on public.solar_crew_members for select to authenticated using (public.is_solar_admin() or public.is_active_solar_seller());
create policy "admins manage crew members" on public.solar_crew_members for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "members read work orders" on public.solar_work_orders for select to authenticated using (public.can_access_solar_project(project_id));
create policy "admins manage work orders" on public.solar_work_orders for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "members read work order checklist" on public.solar_work_order_checklist_items for select to authenticated using (public.can_access_solar_project(project_id));
create policy "admins manage work order checklist" on public.solar_work_order_checklist_items for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "members read work order incidents" on public.solar_work_order_incidents for select to authenticated using (public.can_access_solar_project(project_id));
create policy "admins manage work order incidents" on public.solar_work_order_incidents for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());

grant select,insert,update,delete on public.solar_field_workers,public.solar_crews,public.solar_crew_members,public.solar_work_orders,public.solar_work_order_checklist_items,public.solar_work_order_incidents to authenticated;
grant usage,select on sequence public.solar_work_orders_folio_number_seq to authenticated;

revoke all on function public.create_solar_field_worker(jsonb) from public;
revoke all on function public.create_solar_crew(text,integer,text) from public;
revoke all on function public.assign_solar_crew_member(uuid,uuid,text) from public;
revoke all on function public.schedule_solar_work_order(jsonb) from public;
revoke all on function public.set_solar_work_order_checklist_item(uuid,text,text) from public;
revoke all on function public.set_solar_work_order_status(uuid,text,text) from public;
revoke all on function public.report_solar_work_order_incident(uuid,text,text,text,text) from public;
revoke all on function public.resolve_solar_work_order_incident(uuid,text) from public;
grant execute on function public.create_solar_field_worker(jsonb) to authenticated;
grant execute on function public.create_solar_crew(text,integer,text) to authenticated;
grant execute on function public.assign_solar_crew_member(uuid,uuid,text) to authenticated;
grant execute on function public.schedule_solar_work_order(jsonb) to authenticated;
grant execute on function public.set_solar_work_order_checklist_item(uuid,text,text) to authenticated;
grant execute on function public.set_solar_work_order_status(uuid,text,text) to authenticated;
grant execute on function public.report_solar_work_order_incident(uuid,text,text,text,text) to authenticated;
grant execute on function public.resolve_solar_work_order_incident(uuid,text) to authenticated;

comment on table public.solar_work_orders is 'Installation execution order with crew, schedule and hard safety/quality gates.';
comment on table public.solar_work_order_checklist_items is 'Field checklist derived from approved engineering and Mexican work-at-height/electrical safety controls.';

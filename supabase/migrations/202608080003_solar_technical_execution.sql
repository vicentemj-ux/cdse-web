-- CDSE Solar — structured site survey and engineering control.
-- Makes the technical visit and engineering revision auditable records and
-- prevents declaring a dossier ready for CFE without approved evidence.

create table public.solar_site_surveys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'approved', 'rejected'
  )),
  visited_at timestamptz,
  technician_user_id uuid references auth.users(id) on delete set null,
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  roof_type text check (roof_type is null or roof_type in (
    'concrete_slab', 'metal_sheet', 'tile', 'ground', 'other'
  )),
  roof_condition text check (roof_condition is null or roof_condition in (
    'good', 'fair', 'poor'
  )),
  usable_area_m2 numeric(10, 2) check (usable_area_m2 is null or usable_area_m2 > 0),
  orientation_degrees numeric(6, 2) check (orientation_degrees is null or orientation_degrees between 0 and 360),
  tilt_degrees numeric(6, 2) check (tilt_degrees is null or tilt_degrees between 0 and 90),
  shading_level text check (shading_level is null or shading_level in (
    'none', 'low', 'moderate', 'high'
  )),
  electrical_service text check (electrical_service is null or electrical_service in (
    'single_phase', 'two_phase', 'three_phase'
  )),
  service_voltage integer check (service_voltage is null or service_voltage between 90 and 600),
  main_breaker_amps numeric(8, 2) check (main_breaker_amps is null or main_breaker_amps > 0),
  panelboard_condition text check (panelboard_condition is null or panelboard_condition in (
    'good', 'requires_adjustment', 'requires_replacement'
  )),
  grounding_available boolean,
  meter_accessible boolean,
  route_length_m numeric(10, 2) check (route_length_m is null or route_length_m >= 0),
  structure_notes text,
  electrical_notes text,
  safety_notes text,
  general_notes text,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version),
  check (status <> 'submitted' or submitted_at is not null),
  check (status <> 'approved' or reviewed_at is not null),
  check (status <> 'rejected' or (reviewed_at is not null and nullif(trim(rejection_reason), '') is not null))
);

create index solar_site_surveys_project_version_idx
  on public.solar_site_surveys (project_id, version desc);

create table public.solar_engineering_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'approved', 'rejected'
  )),
  panel_count integer check (panel_count is null or panel_count > 0),
  module_model text,
  inverter_model text,
  inverter_quantity integer check (inverter_quantity is null or inverter_quantity > 0),
  system_dc_kw numeric(10, 3) check (system_dc_kw is null or system_dc_kw > 0),
  inverter_ac_kw numeric(10, 3) check (inverter_ac_kw is null or inverter_ac_kw > 0),
  dc_ac_ratio_percent numeric(6, 2) check (
    dc_ac_ratio_percent is null or dc_ac_ratio_percent between 50 and 120
  ),
  string_configuration text,
  mppt_configuration text,
  dc_protection text,
  ac_protection text,
  conductor_specification text,
  grounding_design text,
  design_notes text,
  single_line_document_id uuid references public.solar_project_documents(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version),
  check (status <> 'submitted' or submitted_at is not null),
  check (status <> 'approved' or reviewed_at is not null),
  check (status <> 'rejected' or (reviewed_at is not null and nullif(trim(rejection_reason), '') is not null))
);

create index solar_engineering_revisions_project_version_idx
  on public.solar_engineering_revisions (project_id, version desc);

create trigger solar_site_surveys_set_updated_at
before update on public.solar_site_surveys
for each row execute function public.set_updated_at();

create trigger solar_engineering_revisions_set_updated_at
before update on public.solar_engineering_revisions
for each row execute function public.set_updated_at();

alter table public.solar_site_surveys enable row level security;
alter table public.solar_engineering_revisions enable row level security;

create policy "members read project site surveys"
on public.solar_site_surveys for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "members read project engineering revisions"
on public.solar_engineering_revisions for select to authenticated
using ((select public.can_access_solar_project(project_id)));

grant select on public.solar_site_surveys to authenticated;
grant select on public.solar_engineering_revisions to authenticated;

create or replace function public.save_solar_site_survey(
  p_project_id uuid,
  p_survey jsonb,
  p_submit boolean default false
)
returns public.solar_site_surveys
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey public.solar_site_surveys;
  v_version integer;
begin
  if not (select public.can_access_solar_project(p_project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_survey
  from public.solar_site_surveys
  where project_id = p_project_id
    and status in ('draft', 'rejected')
  order by version desc
  limit 1;

  if v_survey.id is null then
    select coalesce(max(version), 0) + 1 into v_version
    from public.solar_site_surveys
    where project_id = p_project_id;

    insert into public.solar_site_surveys (project_id, version, created_by)
    values (p_project_id, v_version, (select auth.uid()))
    returning * into v_survey;
  end if;

  update public.solar_site_surveys
  set
    visited_at = nullif(p_survey->>'visitedAt', '')::timestamptz,
    technician_user_id = coalesce(nullif(p_survey->>'technicianUserId', '')::uuid, (select auth.uid())),
    latitude = nullif(p_survey->>'latitude', '')::numeric,
    longitude = nullif(p_survey->>'longitude', '')::numeric,
    roof_type = nullif(p_survey->>'roofType', ''),
    roof_condition = nullif(p_survey->>'roofCondition', ''),
    usable_area_m2 = nullif(p_survey->>'usableAreaM2', '')::numeric,
    orientation_degrees = nullif(p_survey->>'orientationDegrees', '')::numeric,
    tilt_degrees = nullif(p_survey->>'tiltDegrees', '')::numeric,
    shading_level = nullif(p_survey->>'shadingLevel', ''),
    electrical_service = nullif(p_survey->>'electricalService', ''),
    service_voltage = nullif(p_survey->>'serviceVoltage', '')::integer,
    main_breaker_amps = nullif(p_survey->>'mainBreakerAmps', '')::numeric,
    panelboard_condition = nullif(p_survey->>'panelboardCondition', ''),
    grounding_available = case when p_survey ? 'groundingAvailable' then (p_survey->>'groundingAvailable')::boolean else null end,
    meter_accessible = case when p_survey ? 'meterAccessible' then (p_survey->>'meterAccessible')::boolean else null end,
    route_length_m = nullif(p_survey->>'routeLengthM', '')::numeric,
    structure_notes = nullif(trim(p_survey->>'structureNotes'), ''),
    electrical_notes = nullif(trim(p_survey->>'electricalNotes'), ''),
    safety_notes = nullif(trim(p_survey->>'safetyNotes'), ''),
    general_notes = nullif(trim(p_survey->>'generalNotes'), ''),
    status = case when p_submit then 'submitted' else 'draft' end,
    submitted_by = case when p_submit then (select auth.uid()) else null end,
    submitted_at = case when p_submit then now() else null end,
    reviewed_by = null,
    reviewed_at = null,
    rejection_reason = null
  where id = v_survey.id
  returning * into v_survey;

  if p_submit and (
    v_survey.visited_at is null
    or v_survey.roof_type is null
    or v_survey.roof_condition is null
    or v_survey.usable_area_m2 is null
    or v_survey.shading_level is null
    or v_survey.electrical_service is null
    or v_survey.service_voltage is null
    or v_survey.main_breaker_amps is null
    or v_survey.panelboard_condition is null
    or v_survey.grounding_available is null
    or v_survey.meter_accessible is null
    or v_survey.route_length_m is null
  ) then
    raise exception 'INCOMPLETE_SITE_SURVEY';
  end if;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (
    p_project_id,
    case when p_submit then 'site_survey_submitted' else 'site_survey_saved' end,
    (select auth.uid()),
    jsonb_build_object('surveyId', v_survey.id, 'version', v_survey.version)
  );

  return v_survey;
end;
$$;

create or replace function public.review_solar_site_survey(
  p_survey_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns public.solar_site_surveys
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey public.solar_site_surveys;
begin
  if not (select public.is_solar_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;

  select * into v_survey from public.solar_site_surveys where id = p_survey_id;
  if v_survey.id is null then raise exception 'SITE_SURVEY_NOT_FOUND'; end if;
  if v_survey.status <> 'submitted' then raise exception 'SUBMITTED_SITE_SURVEY_REQUIRED'; end if;
  if p_decision = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  update public.solar_site_surveys
  set
    status = p_decision,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    rejection_reason = case when p_decision = 'rejected' then trim(p_rejection_reason) else null end
  where id = p_survey_id
  returning * into v_survey;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (
    v_survey.project_id, 'site_survey_reviewed', (select auth.uid()),
    jsonb_build_object('surveyId', v_survey.id, 'version', v_survey.version, 'decision', p_decision, 'reason', p_rejection_reason)
  );

  return v_survey;
end;
$$;

create or replace function public.save_solar_engineering_revision(
  p_project_id uuid,
  p_design jsonb,
  p_submit boolean default false
)
returns public.solar_engineering_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_design public.solar_engineering_revisions;
  v_version integer;
  v_unifilar_id uuid;
  v_dc numeric;
  v_ac numeric;
  v_ratio numeric;
begin
  if not (select public.can_access_solar_project(p_project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_dc := nullif(p_design->>'systemDcKw', '')::numeric;
  v_ac := nullif(p_design->>'inverterAcKw', '')::numeric;
  v_ratio := case when v_dc is not null and v_ac is not null and v_ac > 0 then round(v_dc / v_ac * 100, 2) else null end;

  if v_ratio is not null and v_ratio > 120 then
    raise exception 'INVERTER_OVERPRODUCTION_LIMIT_EXCEEDED';
  end if;

  select document.id into v_unifilar_id
  from public.solar_project_documents document
  where document.project_id = p_project_id
    and document.document_code = 'single_line_diagram'
    and document.status = 'approved'
  order by document.version desc
  limit 1;

  select * into v_design
  from public.solar_engineering_revisions
  where project_id = p_project_id
    and status in ('draft', 'rejected')
  order by version desc
  limit 1;

  if v_design.id is null then
    select coalesce(max(version), 0) + 1 into v_version
    from public.solar_engineering_revisions
    where project_id = p_project_id;

    insert into public.solar_engineering_revisions (project_id, version, created_by)
    values (p_project_id, v_version, (select auth.uid()))
    returning * into v_design;
  end if;

  update public.solar_engineering_revisions
  set
    panel_count = nullif(p_design->>'panelCount', '')::integer,
    module_model = nullif(trim(p_design->>'moduleModel'), ''),
    inverter_model = nullif(trim(p_design->>'inverterModel'), ''),
    inverter_quantity = nullif(p_design->>'inverterQuantity', '')::integer,
    system_dc_kw = v_dc,
    inverter_ac_kw = v_ac,
    dc_ac_ratio_percent = v_ratio,
    string_configuration = nullif(trim(p_design->>'stringConfiguration'), ''),
    mppt_configuration = nullif(trim(p_design->>'mpptConfiguration'), ''),
    dc_protection = nullif(trim(p_design->>'dcProtection'), ''),
    ac_protection = nullif(trim(p_design->>'acProtection'), ''),
    conductor_specification = nullif(trim(p_design->>'conductorSpecification'), ''),
    grounding_design = nullif(trim(p_design->>'groundingDesign'), ''),
    design_notes = nullif(trim(p_design->>'designNotes'), ''),
    single_line_document_id = v_unifilar_id,
    status = case when p_submit then 'submitted' else 'draft' end,
    submitted_by = case when p_submit then (select auth.uid()) else null end,
    submitted_at = case when p_submit then now() else null end,
    reviewed_by = null,
    reviewed_at = null,
    rejection_reason = null
  where id = v_design.id
  returning * into v_design;

  if p_submit and (
    v_design.panel_count is null
    or v_design.module_model is null
    or v_design.inverter_model is null
    or v_design.inverter_quantity is null
    or v_design.system_dc_kw is null
    or v_design.inverter_ac_kw is null
    or v_design.dc_ac_ratio_percent is null
    or v_design.string_configuration is null
    or v_design.dc_protection is null
    or v_design.ac_protection is null
    or v_design.conductor_specification is null
    or v_design.grounding_design is null
  ) then
    raise exception 'INCOMPLETE_ENGINEERING_REVISION';
  end if;

  if p_submit and v_unifilar_id is null then
    raise exception 'APPROVED_SINGLE_LINE_DIAGRAM_REQUIRED';
  end if;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (
    p_project_id,
    case when p_submit then 'engineering_revision_submitted' else 'engineering_revision_saved' end,
    (select auth.uid()),
    jsonb_build_object('engineeringRevisionId', v_design.id, 'version', v_design.version, 'dcAcRatioPercent', v_design.dc_ac_ratio_percent)
  );

  return v_design;
end;
$$;

create or replace function public.review_solar_engineering_revision(
  p_revision_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns public.solar_engineering_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_design public.solar_engineering_revisions;
begin
  if not (select public.is_solar_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_REVIEW_DECISION'; end if;

  select * into v_design from public.solar_engineering_revisions where id = p_revision_id;
  if v_design.id is null then raise exception 'ENGINEERING_REVISION_NOT_FOUND'; end if;
  if v_design.status <> 'submitted' then raise exception 'SUBMITTED_ENGINEERING_REVISION_REQUIRED'; end if;
  if p_decision = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  update public.solar_engineering_revisions
  set
    status = p_decision,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    rejection_reason = case when p_decision = 'rejected' then trim(p_rejection_reason) else null end
  where id = p_revision_id
  returning * into v_design;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (
    v_design.project_id, 'engineering_revision_reviewed', (select auth.uid()),
    jsonb_build_object('engineeringRevisionId', v_design.id, 'version', v_design.version, 'decision', p_decision, 'reason', p_rejection_reason)
  );

  return v_design;
end;
$$;

create or replace function public.get_solar_project_readiness(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_survey_approved boolean;
  v_engineering_approved boolean;
  v_missing_documents jsonb;
  v_missing_count integer;
begin
  if not (select public.can_access_solar_project(p_project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select exists (
    select 1 from public.solar_site_surveys
    where project_id = p_project_id and status = 'approved'
  ) into v_survey_approved;

  select exists (
    select 1 from public.solar_engineering_revisions
    where project_id = p_project_id and status = 'approved'
  ) into v_engineering_approved;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'code', checklist.item_code,
    'title', checklist.title,
    'stage', checklist.stage,
    'status', checklist.status
  ) order by checklist.sort_order), '[]'::jsonb)
  into v_missing_count, v_missing_documents
  from public.solar_project_checklist_items checklist
  where checklist.project_id = p_project_id
    and checklist.required
    and checklist.stage in ('commercial', 'site_survey', 'engineering', 'cfe')
    and checklist.item_code <> 'cfe_acknowledgement'
    and checklist.status <> 'complete';

  return jsonb_build_object(
    'siteSurveyApproved', v_survey_approved,
    'engineeringApproved', v_engineering_approved,
    'missingDocumentCount', v_missing_count,
    'missingDocuments', v_missing_documents,
    'readyForCfe', v_survey_approved and v_engineering_approved and v_missing_count = 0
  );
end;
$$;

create or replace function public.update_solar_project_operations(
  p_project_id uuid,
  p_status text,
  p_health text,
  p_next_action text,
  p_blocked_reason text default null,
  p_cfe_tracking_folio text default null,
  p_target_site_survey_at timestamptz default null,
  p_target_installation_at timestamptz default null
)
returns public.solar_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.solar_projects;
  v_old_status text;
  v_readiness jsonb;
begin
  if not (select public.is_solar_admin()) then raise exception 'ADMIN_REQUIRED'; end if;

  if p_status not in (
    'sold_pending_validation', 'site_survey_scheduled', 'engineering',
    'documents_pending', 'ready_for_submission', 'submitted_to_cfe',
    'cfe_observation', 'approved_for_installation', 'installation_scheduled',
    'installation_in_progress', 'installed_pending_interconnection',
    'meter_change_pending', 'commissioning', 'operational', 'on_hold', 'cancelled'
  ) then raise exception 'INVALID_PROJECT_STATUS'; end if;

  if p_health not in ('on_track', 'at_risk', 'blocked', 'overdue') then
    raise exception 'INVALID_PROJECT_HEALTH';
  end if;
  if p_health = 'blocked' and nullif(trim(p_blocked_reason), '') is null then
    raise exception 'BLOCKED_REASON_REQUIRED';
  end if;

  select status into v_old_status from public.solar_projects where id = p_project_id;
  if v_old_status is null then raise exception 'PROJECT_NOT_FOUND'; end if;

  if p_status in ('ready_for_submission', 'submitted_to_cfe') then
    v_readiness := public.get_solar_project_readiness(p_project_id);
    if not coalesce((v_readiness->>'readyForCfe')::boolean, false) then
      raise exception 'PROJECT_NOT_READY_FOR_CFE';
    end if;
  end if;
  if p_status = 'submitted_to_cfe' and nullif(trim(p_cfe_tracking_folio), '') is null then
    raise exception 'CFE_TRACKING_FOLIO_REQUIRED';
  end if;

  update public.solar_projects
  set
    status = p_status,
    health = p_health,
    next_action = nullif(trim(p_next_action), ''),
    blocked_reason = case when p_health = 'blocked' then trim(p_blocked_reason) else null end,
    cfe_tracking_folio = nullif(trim(p_cfe_tracking_folio), ''),
    cfe_submitted_at = case when p_status = 'submitted_to_cfe' then coalesce(cfe_submitted_at, now()) else cfe_submitted_at end,
    target_site_survey_at = p_target_site_survey_at,
    target_installation_at = p_target_installation_at,
    meter_changed_at = case when p_status in ('commissioning', 'operational') then coalesce(meter_changed_at, now()) else meter_changed_at end,
    commissioned_at = case when p_status = 'operational' then coalesce(commissioned_at, now()) else commissioned_at end
  where id = p_project_id
  returning * into v_project;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (
    p_project_id, 'project_operations_updated', (select auth.uid()),
    jsonb_build_object('previousStatus', v_old_status, 'status', p_status, 'health', p_health, 'nextAction', p_next_action, 'cfeTrackingFolio', p_cfe_tracking_folio)
  );

  return v_project;
end;
$$;

revoke all on function public.save_solar_site_survey(uuid, jsonb, boolean) from public;
revoke all on function public.review_solar_site_survey(uuid, text, text) from public;
revoke all on function public.save_solar_engineering_revision(uuid, jsonb, boolean) from public;
revoke all on function public.review_solar_engineering_revision(uuid, text, text) from public;
revoke all on function public.get_solar_project_readiness(uuid) from public;

grant execute on function public.save_solar_site_survey(uuid, jsonb, boolean) to authenticated;
grant execute on function public.review_solar_site_survey(uuid, text, text) to authenticated;
grant execute on function public.save_solar_engineering_revision(uuid, jsonb, boolean) to authenticated;
grant execute on function public.review_solar_engineering_revision(uuid, text, text) to authenticated;
grant execute on function public.get_solar_project_readiness(uuid) to authenticated;

comment on table public.solar_site_surveys is
  'Versioned technical visit record covering roof, electrical service, route and safety conditions.';
comment on table public.solar_engineering_revisions is
  'Versioned executable design; DC/AC ratio is capped at 120 percent and tied to an approved single-line diagram.';
comment on function public.get_solar_project_readiness(uuid) is
  'Returns the approved technical gates and missing dossier documents required before CFE submission.';

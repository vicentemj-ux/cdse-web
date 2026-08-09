-- Traceable CFE workflow: submission, observations, contracts, meter and interconnection.

create table public.solar_cfe_cases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.solar_projects(id) on delete cascade,
  status text not null default 'draft' check (status in (
    'draft','submitted','under_review','observation','responded','approved',
    'contracts_pending','meter_pending','meter_scheduled','meter_installed',
    'interconnected','closed','cancelled'
  )),
  submission_channel text check (submission_channel is null or submission_channel in ('office','portal','supplier','other')),
  receiving_office text,
  tracking_folio text,
  submitted_at timestamptz,
  study_required boolean not null default false,
  reference_sla_days integer not null default 13 check (reference_sla_days between 1 and 180),
  reference_target_at timestamptz,
  waiting_on text not null default 'cdse' check (waiting_on in ('none','cdse','customer','cfe','distributor','supplier','third_party')),
  waiting_since timestamptz not null default now(),
  last_external_contact_at timestamptz,
  next_follow_up_at timestamptz,
  interconnection_contract_number text,
  compensation_contract_number text,
  previous_meter_serial text,
  bidirectional_meter_serial text,
  meter_appointment_at timestamptz,
  meter_changed_at timestamptz,
  interconnected_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('submitted','under_review','observation','responded','approved','contracts_pending','meter_pending','meter_scheduled','meter_installed','interconnected','closed') or (nullif(trim(tracking_folio),'') is not null and submitted_at is not null)),
  check (status not in ('meter_installed','interconnected','closed') or (nullif(trim(bidirectional_meter_serial),'') is not null and meter_changed_at is not null)),
  check (status not in ('interconnected','closed') or interconnected_at is not null)
);

create index solar_cfe_cases_status_followup_idx
  on public.solar_cfe_cases(status, next_follow_up_at);
create index solar_cfe_cases_waiting_idx
  on public.solar_cfe_cases(waiting_on, waiting_since);

create table public.solar_cfe_observations (
  id uuid primary key default gen_random_uuid(),
  cfe_case_id uuid not null references public.solar_cfe_cases(id) on delete cascade,
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  observation_number integer not null check (observation_number > 0),
  status text not null default 'open' check (status in ('open','responded','accepted','rejected')),
  observed_at timestamptz not null default now(),
  description text not null check (char_length(trim(description)) between 5 and 3000),
  internal_due_at timestamptz,
  response text,
  responded_at timestamptz,
  response_document_id uuid references public.solar_project_documents(id) on delete set null,
  resolution_notes text,
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cfe_case_id, observation_number),
  check (status = 'open' or (nullif(trim(response),'') is not null and responded_at is not null))
);

create index solar_cfe_observations_case_status_idx
  on public.solar_cfe_observations(cfe_case_id, status, observed_at desc);

create trigger solar_cfe_cases_set_updated_at before update on public.solar_cfe_cases
for each row execute function public.set_updated_at();
create trigger solar_cfe_observations_set_updated_at before update on public.solar_cfe_observations
for each row execute function public.set_updated_at();

insert into public.solar_document_requirements (
  code,name,description,stage,requirement_scope,required_by_default,
  contains_sensitive_data,retention_policy,regulatory_reference,sort_order
) values
  ('cfe_response','Respuesta o dictamen de la Distribuidora','Respuesta, autorización, prevención u oficio emitido durante el trámite.','cfe','regulatory',true,true,'project_plus_legal_term','Procedimiento de interconexión de Generación Distribuida',320),
  ('interconnection_contract','Contrato de interconexión','Contrato celebrado con la Distribuidora para interconectar la central.','cfe','regulatory',true,true,'contractual','DACG y modelos de contrato aplicables a Generación Distribuida',330),
  ('compensation_contract','Contrato de contraprestación','Contrato con la Suministradora para el esquema de energía entregada a la red.','cfe','regulatory',true,true,'contractual','DACG y modelos de contrato aplicables a Generación Distribuida',340)
on conflict (code) do update set
  name=excluded.name,description=excluded.description,stage=excluded.stage,
  requirement_scope=excluded.requirement_scope,required_by_default=excluded.required_by_default,
  contains_sensitive_data=excluded.contains_sensitive_data,retention_policy=excluded.retention_policy,
  regulatory_reference=excluded.regulatory_reference,sort_order=excluded.sort_order,active=true;

insert into public.solar_project_documents(project_id,requirement_id,document_code,title,status)
select project.id, requirement.id, requirement.code, requirement.name, 'missing'
from public.solar_projects project
cross join public.solar_document_requirements requirement
where requirement.code in ('cfe_response','interconnection_contract','compensation_contract')
  and not exists (
    select 1 from public.solar_project_documents document
    where document.project_id=project.id and document.document_code=requirement.code
  );

insert into public.solar_project_checklist_items(
  project_id,item_code,title,stage,requirement_scope,required,status,sort_order
)
select project.id, requirement.code, requirement.name, requirement.stage,
       requirement.requirement_scope, true, 'pending', requirement.sort_order
from public.solar_projects project
cross join public.solar_document_requirements requirement
where requirement.code in ('cfe_response','interconnection_contract','compensation_contract')
  and not exists (
    select 1 from public.solar_project_checklist_items item
    where item.project_id=project.id and item.item_code=requirement.code
  );

create or replace function public.save_solar_cfe_case(p_project_id uuid, p_data jsonb)
returns public.solar_cfe_cases
language plpgsql security definer set search_path=''
as $$
declare
  v_case public.solar_cfe_cases;
  v_status text := coalesce(nullif(p_data->>'status',''),'draft');
  v_previous_waiting text;
  v_tracking text := nullif(trim(p_data->>'trackingFolio'),'');
  v_submitted timestamptz := nullif(p_data->>'submittedAt','')::timestamptz;
  v_meter_changed timestamptz := nullif(p_data->>'meterChangedAt','')::timestamptz;
  v_interconnected timestamptz := nullif(p_data->>'interconnectedAt','')::timestamptz;
  v_waiting text := coalesce(nullif(p_data->>'waitingOn',''),'cdse');
  v_project_status text;
begin
  if not (select public.is_solar_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  if not exists(select 1 from public.solar_projects where id=p_project_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if v_status not in ('draft','submitted','under_review','observation','responded','approved','contracts_pending','meter_pending','meter_scheduled','meter_installed','interconnected','closed','cancelled') then raise exception 'INVALID_CFE_STATUS'; end if;
  if v_waiting not in ('none','cdse','customer','cfe','distributor','supplier','third_party') then raise exception 'INVALID_WAITING_PARTY'; end if;
  if v_status not in ('draft','cancelled') and (v_tracking is null or v_submitted is null) then raise exception 'CFE_SUBMISSION_DATA_REQUIRED'; end if;
  if v_status in ('meter_installed','interconnected','closed') and (nullif(trim(p_data->>'bidirectionalMeterSerial'),'') is null or v_meter_changed is null) then raise exception 'BIDIRECTIONAL_METER_DATA_REQUIRED'; end if;
  if v_status in ('interconnected','closed') and v_interconnected is null then raise exception 'INTERCONNECTION_DATE_REQUIRED'; end if;

  select waiting_on into v_previous_waiting from public.solar_cfe_cases where project_id=p_project_id;
  insert into public.solar_cfe_cases(
    project_id,status,submission_channel,receiving_office,tracking_folio,submitted_at,
    study_required,reference_sla_days,reference_target_at,waiting_on,waiting_since,
    last_external_contact_at,next_follow_up_at,interconnection_contract_number,
    compensation_contract_number,previous_meter_serial,bidirectional_meter_serial,
    meter_appointment_at,meter_changed_at,interconnected_at,notes,created_by,updated_by
  ) values (
    p_project_id,v_status,nullif(p_data->>'submissionChannel',''),nullif(trim(p_data->>'receivingOffice'),''),v_tracking,v_submitted,
    coalesce((p_data->>'studyRequired')::boolean,false),coalesce(nullif(p_data->>'referenceSlaDays','')::integer,13),nullif(p_data->>'referenceTargetAt','')::timestamptz,v_waiting,now(),
    nullif(p_data->>'lastExternalContactAt','')::timestamptz,nullif(p_data->>'nextFollowUpAt','')::timestamptz,nullif(trim(p_data->>'interconnectionContractNumber'),''),
    nullif(trim(p_data->>'compensationContractNumber'),''),nullif(trim(p_data->>'previousMeterSerial'),''),nullif(trim(p_data->>'bidirectionalMeterSerial'),''),
    nullif(p_data->>'meterAppointmentAt','')::timestamptz,v_meter_changed,v_interconnected,nullif(trim(p_data->>'notes'),''),(select auth.uid()),(select auth.uid())
  ) on conflict(project_id) do update set
    status=excluded.status,submission_channel=excluded.submission_channel,receiving_office=excluded.receiving_office,
    tracking_folio=excluded.tracking_folio,submitted_at=excluded.submitted_at,study_required=excluded.study_required,
    reference_sla_days=excluded.reference_sla_days,reference_target_at=excluded.reference_target_at,
    waiting_on=excluded.waiting_on,waiting_since=case when public.solar_cfe_cases.waiting_on is distinct from excluded.waiting_on then now() else public.solar_cfe_cases.waiting_since end,
    last_external_contact_at=excluded.last_external_contact_at,next_follow_up_at=excluded.next_follow_up_at,
    interconnection_contract_number=excluded.interconnection_contract_number,compensation_contract_number=excluded.compensation_contract_number,
    previous_meter_serial=excluded.previous_meter_serial,bidirectional_meter_serial=excluded.bidirectional_meter_serial,
    meter_appointment_at=excluded.meter_appointment_at,meter_changed_at=excluded.meter_changed_at,
    interconnected_at=excluded.interconnected_at,notes=excluded.notes,updated_by=(select auth.uid())
  returning * into v_case;

  select status into v_project_status from public.solar_projects where id=p_project_id;
  update public.solar_projects set
    cfe_tracking_folio=coalesce(v_tracking,cfe_tracking_folio),
    cfe_submitted_at=coalesce(v_submitted,cfe_submitted_at),
    meter_changed_at=coalesce(v_meter_changed,meter_changed_at),
    commissioned_at=case when v_status in ('interconnected','closed') then coalesce(commissioned_at,v_interconnected) else commissioned_at end,
    status=case
      when v_status='observation' and v_project_status='submitted_to_cfe' then 'cfe_observation'
      when v_status in ('submitted','under_review','responded','approved','contracts_pending') and v_project_status in ('ready_for_submission','cfe_observation') then 'submitted_to_cfe'
      when v_status in ('meter_pending','meter_scheduled') and v_project_status='installed_pending_interconnection' then 'meter_change_pending'
      when v_status='meter_installed' and v_project_status in ('installed_pending_interconnection','meter_change_pending') then 'commissioning'
      when v_status in ('interconnected','closed') then 'operational'
      else v_project_status end,
    next_action=case
      when v_status='observation' then 'Responder observación de CFE con evidencia'
      when v_status in ('meter_pending','meter_scheduled') then 'Confirmar cambio a medidor bidireccional'
      when v_status in ('interconnected','closed') then 'Entregar cierre y seguimiento postventa'
      when v_status='cancelled' then next_action
      else 'Dar seguimiento al trámite CFE' end
  where id=p_project_id;

  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'cfe_case_saved',(select auth.uid()),jsonb_build_object('caseId',v_case.id,'status',v_status,'waitingOn',v_waiting,'trackingFolio',v_tracking));
  return v_case;
end;
$$;

create or replace function public.create_solar_cfe_observation(p_case_id uuid, p_description text, p_internal_due_at timestamptz default null)
returns public.solar_cfe_observations
language plpgsql security definer set search_path=''
as $$
declare v_case public.solar_cfe_cases; v_result public.solar_cfe_observations; v_number integer;
begin
  if not (select public.is_solar_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_case from public.solar_cfe_cases where id=p_case_id;
  if v_case.id is null then raise exception 'CFE_CASE_NOT_FOUND'; end if;
  if char_length(trim(coalesce(p_description,''))) < 5 then raise exception 'OBSERVATION_DESCRIPTION_REQUIRED'; end if;
  select coalesce(max(observation_number),0)+1 into v_number from public.solar_cfe_observations where cfe_case_id=p_case_id;
  insert into public.solar_cfe_observations(cfe_case_id,project_id,observation_number,description,internal_due_at,created_by)
  values(p_case_id,v_case.project_id,v_number,trim(p_description),p_internal_due_at,(select auth.uid())) returning * into v_result;
  update public.solar_cfe_cases set status='observation',waiting_on='cdse',waiting_since=now(),updated_by=(select auth.uid()) where id=p_case_id;
  update public.solar_projects set status=case when status='submitted_to_cfe' then 'cfe_observation' else status end,health='at_risk',next_action='Responder observación de CFE con evidencia' where id=v_case.project_id;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata) values(v_case.project_id,'cfe_observation_created',(select auth.uid()),jsonb_build_object('observationId',v_result.id,'number',v_number,'internalDueAt',p_internal_due_at));
  return v_result;
end;
$$;

create or replace function public.respond_solar_cfe_observation(p_observation_id uuid, p_response text, p_response_document_id uuid default null)
returns public.solar_cfe_observations
language plpgsql security definer set search_path=''
as $$
declare v_result public.solar_cfe_observations;
begin
  if not (select public.is_solar_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(trim(coalesce(p_response,''))) < 5 then raise exception 'OBSERVATION_RESPONSE_REQUIRED'; end if;
  update public.solar_cfe_observations set status='responded',response=trim(p_response),responded_at=now(),response_document_id=p_response_document_id,resolved_by=(select auth.uid()) where id=p_observation_id and status in ('open','rejected') returning * into v_result;
  if v_result.id is null then raise exception 'OPEN_OBSERVATION_REQUIRED'; end if;
  update public.solar_cfe_cases set status='responded',waiting_on='cfe',waiting_since=now(),last_external_contact_at=now(),updated_by=(select auth.uid()) where id=v_result.cfe_case_id;
  update public.solar_projects set status=case when status='cfe_observation' then 'submitted_to_cfe' else status end,health='on_track',next_action='Dar seguimiento a respuesta de observación CFE' where id=v_result.project_id;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata) values(v_result.project_id,'cfe_observation_responded',(select auth.uid()),jsonb_build_object('observationId',v_result.id,'number',v_result.observation_number,'documentId',p_response_document_id));
  return v_result;
end;
$$;

alter table public.solar_cfe_cases enable row level security;
alter table public.solar_cfe_observations enable row level security;

create policy "project members read cfe cases" on public.solar_cfe_cases for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "admins manage cfe cases" on public.solar_cfe_cases for all to authenticated using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));
create policy "project members read cfe observations" on public.solar_cfe_observations for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "admins manage cfe observations" on public.solar_cfe_observations for all to authenticated using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));

grant select,insert,update on public.solar_cfe_cases to authenticated;
grant select,insert,update on public.solar_cfe_observations to authenticated;
revoke all on function public.save_solar_cfe_case(uuid,jsonb) from public;
revoke all on function public.create_solar_cfe_observation(uuid,text,timestamptz) from public;
revoke all on function public.respond_solar_cfe_observation(uuid,text,uuid) from public;
grant execute on function public.save_solar_cfe_case(uuid,jsonb) to authenticated;
grant execute on function public.create_solar_cfe_observation(uuid,text,timestamptz) to authenticated;
grant execute on function public.respond_solar_cfe_observation(uuid,text,uuid) to authenticated;

-- CDSE Solar — controlled warranty claims, quarantine, supplier RMA and replacement custody.

create table public.solar_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  folio_number bigint generated always as identity unique,
  folio text generated always as ('CDSE-RMA-' || lpad(folio_number::text, 6, '0')) stored unique,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  service_case_id uuid references public.solar_service_cases(id) on delete set null,
  serial_id uuid not null references public.solar_inventory_serials(id) on delete restrict,
  asset_id uuid references public.solar_assets(id) on delete set null,
  warranty_id uuid references public.solar_warranties(id) on delete set null,
  replacement_serial_id uuid references public.solar_inventory_serials(id) on delete restrict,
  claim_type text not null check (claim_type in ('manufacturer_warranty','supplier_return','installation_warranty','shipping_damage','other')),
  requested_resolution text not null check (requested_resolution in ('diagnosis','repair','replacement','credit','refund')),
  resolution_type text check (resolution_type in ('repair','replacement','credit','refund')),
  status text not null default 'diagnosing' check (status in (
    'diagnosing','awaiting_evidence','submitted','approved','rejected',
    'replacement_in_transit','replacement_received','resolved','closed','cancelled'
  )),
  provider text not null check (char_length(trim(provider)) between 2 and 160),
  external_reference text,
  return_reference text,
  replacement_reference text,
  failure_summary text not null check (char_length(trim(failure_summary)) between 10 and 3000),
  diagnosis text,
  resolution text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  assigned_to uuid references auth.users(id) on delete set null,
  next_follow_up_at timestamptz,
  submitted_at timestamptz,
  response_at timestamptz,
  service_started_at date,
  service_completed_at date,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (replacement_serial_id is null or replacement_serial_id<>serial_id),
  check (service_completed_at is null or service_started_at is not null),
  check (service_completed_at is null or service_completed_at>=service_started_at),
  check (status not in ('resolved','closed') or (resolved_at is not null and nullif(trim(resolution),'') is not null)),
  check (status<>'closed' or closed_at is not null)
);

create unique index solar_warranty_claims_active_serial_unique on public.solar_warranty_claims(serial_id)
  where status not in ('closed','cancelled');
create unique index solar_warranty_claims_replacement_unique on public.solar_warranty_claims(replacement_serial_id)
  where replacement_serial_id is not null;
create index solar_warranty_claims_project_status_idx on public.solar_warranty_claims(project_id,status,next_follow_up_at,created_at desc);

create table public.solar_warranty_claim_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.solar_warranty_claims(id) on delete restrict,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  event_type text not null check (event_type in (
    'created','evidence_updated','status_changed','submitted','approved','rejected',
    'replacement_linked','resolved','closed','cancelled'
  )),
  previous_status text,
  next_status text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index solar_warranty_claim_events_claim_created_idx on public.solar_warranty_claim_events(claim_id,created_at desc);
create trigger solar_warranty_claims_set_updated_at before update on public.solar_warranty_claims
for each row execute function public.set_updated_at();

create or replace function public.can_operate_solar_warranty_claim(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select public.is_solar_admin()) or exists(
    select 1 from public.solar_profiles profile
    where profile.user_id=(select auth.uid()) and profile.active and profile.role::text='operations'
      and (select public.can_solar_project_action(p_project_id,'post_sales.manage'))
  );
$$;

create or replace function public.create_solar_warranty_claim(p_project_id uuid,p_data jsonb)
returns public.solar_warranty_claims language plpgsql security definer set search_path='' as $$
declare
  v_serial public.solar_inventory_serials;
  v_warranty public.solar_warranties;
  v_case public.solar_service_cases;
  v_claim public.solar_warranty_claims;
  v_service_case_id uuid;
  v_provider text;
begin
  if not public.can_solar_project_action(p_project_id,'post_sales.manage') then raise exception 'WARRANTY_CLAIM_ACCESS_DENIED'; end if;
  select * into v_serial from public.solar_inventory_serials where id=nullif(p_data->>'serialId','')::uuid for update;
  if v_serial.id is null or v_serial.project_id<>p_project_id or v_serial.status<>'installed' then raise exception 'INSTALLED_SERIAL_REQUIRED'; end if;
  if nullif(p_data->>'warrantyId','') is not null then
    select * into v_warranty from public.solar_warranties where id=(p_data->>'warrantyId')::uuid and project_id=p_project_id and (asset_id is null or asset_id=v_serial.asset_id);
    if v_warranty.id is null then raise exception 'WARRANTY_PROJECT_MISMATCH'; end if;
  else
    select * into v_warranty from public.solar_warranties where project_id=p_project_id and status='active'
      and (asset_id=v_serial.asset_id or asset_id is null) order by (asset_id is not null) desc,expires_at nulls last limit 1;
  end if;
  v_provider:=coalesce(nullif(trim(p_data->>'provider'),''),v_warranty.provider);
  if v_provider is null then raise exception 'WARRANTY_PROVIDER_REQUIRED'; end if;

  if nullif(p_data->>'serviceCaseId','') is not null then
    select id into v_service_case_id from public.solar_service_cases where id=(p_data->>'serviceCaseId')::uuid and project_id=p_project_id;
    if v_service_case_id is null then raise exception 'SERVICE_CASE_PROJECT_MISMATCH'; end if;
  else
    v_case:=public.create_solar_service_case(p_project_id,jsonb_build_object(
      'assetId',v_serial.asset_id,'category','equipment','priority',coalesce(nullif(p_data->>'priority',''),'high'),
      'source',coalesce(nullif(p_data->>'source',''),'internal'),'subject','Garantía de equipo '||v_serial.serial_number,
      'description',trim(p_data->>'failureSummary'),'assignedTo',nullif(p_data->>'assignedTo','')
    ));
    v_service_case_id:=v_case.id;
  end if;

  insert into public.solar_warranty_claims(
    project_id,service_case_id,serial_id,asset_id,warranty_id,claim_type,requested_resolution,
    provider,failure_summary,evidence,assigned_to,next_follow_up_at,created_by
  ) values(
    p_project_id,v_service_case_id,v_serial.id,v_serial.asset_id,v_warranty.id,
    coalesce(nullif(p_data->>'claimType',''),'manufacturer_warranty'),
    coalesce(nullif(p_data->>'requestedResolution',''),'replacement'),v_provider,trim(p_data->>'failureSummary'),
    coalesce(p_data->'evidence','{}'::jsonb),nullif(p_data->>'assignedTo','')::uuid,
    coalesce(nullif(p_data->>'nextFollowUpAt','')::timestamptz,now()+interval '3 days'),auth.uid()
  ) returning * into v_claim;

  update public.solar_inventory_serials set status='quarantined',notes=concat_ws(E'\n',notes,'Aislado por '||v_claim.folio) where id=v_serial.id;
  insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,location_id,allocation_id,project_id,work_order_id,asset_id,reference,notes,actor_user_id)
  values(v_serial.id,'quarantined','installed','quarantined',v_serial.location_id,v_serial.allocation_id,p_project_id,v_serial.work_order_id,v_serial.asset_id,v_claim.folio,v_claim.failure_summary,auth.uid());
  if v_serial.asset_id is not null and not exists(select 1 from public.solar_inventory_serials where asset_id=v_serial.asset_id and status='installed') then
    update public.solar_assets set status='inactive' where id=v_serial.asset_id;
  end if;
  if v_warranty.id is not null then update public.solar_warranties set status='claim_open' where id=v_warranty.id; end if;
  insert into public.solar_warranty_claim_events(claim_id,project_id,event_type,next_status,note,metadata,actor_user_id)
  values(v_claim.id,p_project_id,'created','diagnosing',v_claim.failure_summary,jsonb_build_object('serialId',v_serial.id,'serviceCaseId',v_service_case_id),auth.uid());
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'warranty_claim_created',auth.uid(),jsonb_build_object('claimId',v_claim.id,'folio',v_claim.folio,'serialId',v_serial.id));
  return v_claim;
end; $$;

create or replace function public.advance_solar_warranty_claim(p_claim_id uuid,p_next_status text,p_data jsonb default '{}'::jsonb)
returns public.solar_warranty_claims language plpgsql security definer set search_path='' as $$
declare
  v_claim public.solar_warranty_claims;
  v_previous text;
  v_evidence jsonb;
  v_note text;
  v_allowed boolean;
  v_event text;
begin
  select * into v_claim from public.solar_warranty_claims where id=p_claim_id for update;
  if v_claim.id is null or not public.can_operate_solar_warranty_claim(v_claim.project_id) then raise exception 'WARRANTY_OPERATION_DENIED'; end if;
  if p_next_status in ('replacement_received','resolved') then raise exception 'DEDICATED_WARRANTY_ACTION_REQUIRED'; end if;
  v_previous:=v_claim.status;
  v_note:=nullif(trim(p_data->>'note'),'');
  v_allowed:=p_next_status=v_previous or case v_previous
    when 'diagnosing' then p_next_status in ('awaiting_evidence','submitted','cancelled')
    when 'awaiting_evidence' then p_next_status in ('diagnosing','submitted','cancelled')
    when 'submitted' then p_next_status in ('approved','rejected','cancelled')
    when 'approved' then p_next_status in ('replacement_in_transit','cancelled')
    when 'rejected' then p_next_status in ('diagnosing','closed')
    when 'replacement_in_transit' then p_next_status='cancelled'
    when 'resolved' then p_next_status='closed'
    else false end;
  if not v_allowed then raise exception 'INVALID_WARRANTY_TRANSITION'; end if;
  v_evidence:=v_claim.evidence||coalesce(p_data->'evidence','{}'::jsonb);
  if p_next_status='submitted' and (
    nullif(trim(v_evidence->>'purchaseDocumentReference'),'') is null or
    nullif(trim(v_evidence->>'serialEvidenceReference'),'') is null or
    nullif(trim(v_evidence->>'diagnosticEvidenceReference'),'') is null or
    nullif(trim(v_evidence->>'faultEvidenceReference'),'') is null or
    (v_claim.claim_type='manufacturer_warranty' and nullif(trim(v_evidence->>'systemConfiguration'),'') is null)
  ) then raise exception 'WARRANTY_EVIDENCE_INCOMPLETE'; end if;
  if p_next_status='approved' and coalesce(nullif(trim(p_data->>'externalReference'),''),v_claim.external_reference) is null then raise exception 'SUPPLIER_REFERENCE_REQUIRED'; end if;
  if p_next_status in ('rejected','cancelled','closed') and v_note is null then raise exception 'WARRANTY_DECISION_NOTE_REQUIRED'; end if;
  if p_next_status='replacement_in_transit' and coalesce(nullif(trim(p_data->>'replacementReference'),''),v_claim.replacement_reference) is null then raise exception 'REPLACEMENT_TRACKING_REQUIRED'; end if;

  update public.solar_warranty_claims set status=p_next_status,evidence=v_evidence,
    diagnosis=coalesce(nullif(trim(p_data->>'diagnosis'),''),diagnosis),
    external_reference=coalesce(nullif(trim(p_data->>'externalReference'),''),external_reference),
    return_reference=coalesce(nullif(trim(p_data->>'returnReference'),''),return_reference),
    replacement_reference=coalesce(nullif(trim(p_data->>'replacementReference'),''),replacement_reference),
    assigned_to=coalesce(nullif(p_data->>'assignedTo','')::uuid,assigned_to),
    next_follow_up_at=coalesce(nullif(p_data->>'nextFollowUpAt','')::timestamptz,next_follow_up_at),
    submitted_at=case when p_next_status='submitted' then coalesce(submitted_at,now()) else submitted_at end,
    response_at=case when p_next_status in ('approved','rejected') then now() else response_at end,
    closed_at=case when p_next_status='closed' then now() else closed_at end
  where id=v_claim.id returning * into v_claim;

  if p_next_status='cancelled' then
    update public.solar_inventory_serials set status='installed' where id=v_claim.serial_id and status='quarantined';
    if found then
      insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,project_id,asset_id,reference,notes,actor_user_id)
      values(v_claim.serial_id,'reactivated','quarantined','installed',v_claim.project_id,v_claim.asset_id,v_claim.folio,v_note,auth.uid());
    end if;
    update public.solar_assets set status='active' where id=v_claim.asset_id;
    update public.solar_warranties set status='active' where id=v_claim.warranty_id;
  end if;
  v_event:=case p_next_status when 'submitted' then 'submitted' when 'approved' then 'approved' when 'rejected' then 'rejected' when 'closed' then 'closed' when 'cancelled' then 'cancelled' else case when p_next_status=v_previous then 'evidence_updated' else 'status_changed' end end;
  insert into public.solar_warranty_claim_events(claim_id,project_id,event_type,previous_status,next_status,note,metadata,actor_user_id)
  values(v_claim.id,v_claim.project_id,v_event,v_previous,p_next_status,v_note,jsonb_build_object('evidence',v_evidence,'externalReference',v_claim.external_reference),auth.uid());
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(v_claim.project_id,'warranty_claim_status_changed',auth.uid(),jsonb_build_object('claimId',v_claim.id,'folio',v_claim.folio,'previousStatus',v_previous,'status',p_next_status));
  return v_claim;
end; $$;

create or replace function public.register_solar_warranty_replacement(p_claim_id uuid,p_replacement_serial_id uuid,p_reference text,p_work_order_id uuid default null)
returns public.solar_warranty_claims language plpgsql security definer set search_path='' as $$
declare
  v_claim public.solar_warranty_claims;
  v_old public.solar_inventory_serials;
  v_new public.solar_inventory_serials;
  v_allocation public.solar_inventory_allocations;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_claim from public.solar_warranty_claims where id=p_claim_id for update;
  if v_claim.id is null or v_claim.status<>'replacement_in_transit' then raise exception 'REPLACEMENT_NOT_EXPECTED'; end if;
  if nullif(trim(p_reference),'') is null then raise exception 'REPLACEMENT_REFERENCE_REQUIRED'; end if;
  select * into v_old from public.solar_inventory_serials where id=v_claim.serial_id;
  select * into v_new from public.solar_inventory_serials where id=p_replacement_serial_id for update;
  if v_new.id is null or v_new.status<>'in_stock' or v_new.location_id is null then raise exception 'REPLACEMENT_SERIAL_NOT_AVAILABLE'; end if;
  if v_new.id=v_old.id or not exists(
    select 1 from public.solar_inventory_items old_item join public.solar_inventory_items new_item on new_item.id=v_new.item_id
    where old_item.id=v_old.item_id and old_item.category=new_item.category
  ) then raise exception 'REPLACEMENT_SERIAL_INCOMPATIBLE'; end if;
  if p_work_order_id is not null and not exists(select 1 from public.solar_work_orders where id=p_work_order_id and project_id=v_claim.project_id) then raise exception 'WORK_ORDER_PROJECT_MISMATCH'; end if;

  v_allocation:=public.plan_solar_project_material(v_claim.project_id,v_new.item_id,v_new.location_id,1,p_work_order_id,'Reposición vinculada a '||v_claim.folio);
  perform public.move_solar_project_serials(v_allocation.id,'reserve',array[v_new.id],p_work_order_id,p_reference,'Equipo de reemplazo de '||v_claim.folio);
  update public.solar_warranty_claims set replacement_serial_id=v_new.id,status='replacement_received',replacement_reference=trim(p_reference),next_follow_up_at=now()+interval '3 days'
    where id=v_claim.id returning * into v_claim;
  insert into public.solar_warranty_claim_events(claim_id,project_id,event_type,previous_status,next_status,note,metadata,actor_user_id)
  values(v_claim.id,v_claim.project_id,'replacement_linked','replacement_in_transit','replacement_received','Reemplazo recibido y apartado al proyecto.',jsonb_build_object('replacementSerialId',v_new.id,'allocationId',v_allocation.id,'reference',p_reference),auth.uid());
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(v_claim.project_id,'warranty_replacement_received',auth.uid(),jsonb_build_object('claimId',v_claim.id,'replacementSerialId',v_new.id,'allocationId',v_allocation.id));
  return v_claim;
end; $$;

create or replace function public.resolve_solar_warranty_claim(p_claim_id uuid,p_resolution_type text,p_resolution text,p_service_started_at date default null,p_service_completed_at date default null)
returns public.solar_warranty_claims language plpgsql security definer set search_path='' as $$
declare
  v_claim public.solar_warranty_claims;
  v_old public.solar_inventory_serials;
  v_new public.solar_inventory_serials;
  v_warranty public.solar_warranties;
  v_duration integer;
  v_pause integer;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_claim from public.solar_warranty_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'WARRANTY_CLAIM_NOT_FOUND'; end if;
  if p_resolution_type not in ('repair','replacement','credit','refund') or nullif(trim(p_resolution),'') is null then raise exception 'WARRANTY_RESOLUTION_REQUIRED'; end if;
  if (p_resolution_type='replacement' and v_claim.status<>'replacement_received') or (p_resolution_type<>'replacement' and v_claim.status<>'approved') then raise exception 'WARRANTY_RESOLUTION_NOT_READY'; end if;
  select * into v_old from public.solar_inventory_serials where id=v_claim.serial_id for update;
  select * into v_warranty from public.solar_warranties where id=v_claim.warranty_id for update;

  if p_resolution_type='repair' then
    if p_service_started_at is null or p_service_completed_at is null or p_service_completed_at<p_service_started_at or p_service_completed_at>current_date then raise exception 'REPAIR_DATES_REQUIRED'; end if;
    update public.solar_inventory_serials set status='installed' where id=v_old.id and status='quarantined';
    insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,project_id,asset_id,reference,notes,actor_user_id)
    values(v_old.id,'reactivated','quarantined','installed',v_claim.project_id,v_claim.asset_id,v_claim.folio,trim(p_resolution),auth.uid());
    update public.solar_assets set status='active' where id=v_claim.asset_id;
    if v_warranty.id is not null then
      v_pause:=greatest(p_service_completed_at-p_service_started_at,0);
      update public.solar_warranties set status='active',expires_at=case when expires_at is null then null else expires_at+v_pause end where id=v_warranty.id;
    end if;
  elsif p_resolution_type='replacement' then
    if p_service_started_at is null or p_service_completed_at is null or p_service_completed_at<p_service_started_at or p_service_completed_at>current_date then raise exception 'REPLACEMENT_DATES_REQUIRED'; end if;
    select * into v_new from public.solar_inventory_serials where id=v_claim.replacement_serial_id for update;
    if v_new.id is null or v_new.project_id<>v_claim.project_id or v_new.status<>'installed' then raise exception 'REPLACEMENT_MUST_BE_INSTALLED'; end if;
    update public.solar_inventory_serials set status='retired',notes=concat_ws(E'\n',notes,'Sustituido por '||v_new.serial_number||' en '||v_claim.folio) where id=v_old.id;
    insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,project_id,asset_id,reference,notes,actor_user_id)
    values(v_old.id,'retired','quarantined','retired',v_claim.project_id,v_claim.asset_id,v_claim.folio,'Sustituido por serie '||v_new.serial_number||'. '||trim(p_resolution),auth.uid());
    if not exists(select 1 from public.solar_inventory_serials where asset_id=v_claim.asset_id and status='installed') then update public.solar_assets set status='replaced' where id=v_claim.asset_id; end if;
    if v_warranty.id is not null then
      v_duration:=case when v_warranty.expires_at is null then null else greatest(v_warranty.expires_at-v_warranty.starts_at,0) end;
      update public.solar_warranties set asset_id=v_new.asset_id,status='active',starts_at=p_service_completed_at,
        expires_at=case when v_duration is null then null else p_service_completed_at+v_duration end,
        policy_reference=concat_ws(' · ',policy_reference,'Reposición '||v_claim.folio)
      where id=v_warranty.id;
    end if;
  else
    update public.solar_inventory_serials set status='retired',notes=concat_ws(E'\n',notes,'Baja por resolución '||v_claim.folio) where id=v_old.id;
    insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,project_id,asset_id,reference,notes,actor_user_id)
    values(v_old.id,'retired','quarantined','retired',v_claim.project_id,v_claim.asset_id,v_claim.folio,trim(p_resolution),auth.uid());
    update public.solar_assets set status='removed' where id=v_claim.asset_id;
    update public.solar_warranties set status='fulfilled' where id=v_warranty.id;
  end if;

  update public.solar_warranty_claims set status='resolved',resolution_type=p_resolution_type,resolution=trim(p_resolution),
    service_started_at=p_service_started_at,service_completed_at=p_service_completed_at,resolved_at=now(),next_follow_up_at=null
  where id=v_claim.id returning * into v_claim;
  insert into public.solar_warranty_claim_events(claim_id,project_id,event_type,previous_status,next_status,note,metadata,actor_user_id)
  values(v_claim.id,v_claim.project_id,'resolved',case when p_resolution_type='replacement' then 'replacement_received' else 'approved' end,'resolved',trim(p_resolution),jsonb_build_object('resolutionType',p_resolution_type,'replacementSerialId',v_claim.replacement_serial_id),auth.uid());
  if v_claim.service_case_id is not null and exists(select 1 from public.solar_service_cases where id=v_claim.service_case_id and status not in ('resolved','closed','cancelled')) then
    perform public.update_solar_service_case(v_claim.service_case_id,'resolved','Garantía '||v_claim.folio||': '||trim(p_resolution),null,null);
  end if;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(v_claim.project_id,'warranty_claim_resolved',auth.uid(),jsonb_build_object('claimId',v_claim.id,'folio',v_claim.folio,'resolutionType',p_resolution_type));
  return v_claim;
end; $$;

alter table public.solar_warranty_claims enable row level security;
alter table public.solar_warranty_claim_events enable row level security;
create policy "members read warranty claims" on public.solar_warranty_claims for select to authenticated using (public.can_access_solar_project(project_id));
create policy "members read warranty claim events" on public.solar_warranty_claim_events for select to authenticated using (public.can_access_solar_project(project_id));

grant select on public.solar_warranty_claims,public.solar_warranty_claim_events to authenticated;
grant usage,select on sequence public.solar_warranty_claims_folio_number_seq,public.solar_warranty_claim_events_id_seq to authenticated;
revoke insert,update,delete on public.solar_warranty_claims,public.solar_warranty_claim_events from authenticated;
revoke all on function public.can_operate_solar_warranty_claim(uuid) from public;
revoke all on function public.create_solar_warranty_claim(uuid,jsonb) from public;
revoke all on function public.advance_solar_warranty_claim(uuid,text,jsonb) from public;
revoke all on function public.register_solar_warranty_replacement(uuid,uuid,text,uuid) from public;
revoke all on function public.resolve_solar_warranty_claim(uuid,text,text,date,date) from public;
grant execute on function public.can_operate_solar_warranty_claim(uuid) to authenticated;
grant execute on function public.create_solar_warranty_claim(uuid,jsonb) to authenticated;
grant execute on function public.advance_solar_warranty_claim(uuid,text,jsonb) to authenticated;
grant execute on function public.register_solar_warranty_replacement(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.resolve_solar_warranty_claim(uuid,text,text,date,date) to authenticated;

comment on table public.solar_warranty_claims is 'Operational warranty and supplier RMA record linked to service, serialized equipment and replacement custody.';
comment on table public.solar_warranty_claim_events is 'Immutable evidence and decision timeline for each warranty claim.';

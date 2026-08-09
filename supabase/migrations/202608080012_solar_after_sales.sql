-- CDSE Solar — installed assets, warranties, service and generation follow-up.

create table public.solar_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  source_work_order_id uuid references public.solar_work_orders(id) on delete set null,
  asset_type text not null check (asset_type in ('module','inverter','meter','monitoring','structure','protection','other')),
  manufacturer text,
  model text not null check (char_length(trim(model)) between 2 and 180),
  serial_number text,
  quantity integer not null default 1 check (quantity between 1 and 1000),
  installed_at date,
  status text not null default 'active' check (status in ('active','inactive','replaced','removed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index solar_assets_project_serial_unique
  on public.solar_assets (project_id, lower(serial_number)) where serial_number is not null;
create unique index solar_assets_seeded_scope_unique
  on public.solar_assets (source_work_order_id, asset_type) where source_work_order_id is not null and asset_type in ('module','inverter');
create index solar_assets_project_status_idx on public.solar_assets (project_id, status, asset_type);

create table public.solar_warranties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  asset_id uuid references public.solar_assets(id) on delete set null,
  warranty_type text not null check (warranty_type in ('product','performance','inverter','workmanship','structure','monitoring','other')),
  provider text not null check (char_length(trim(provider)) between 2 and 160),
  starts_at date not null,
  expires_at date,
  coverage_summary text,
  claim_contact text,
  policy_reference text,
  status text not null default 'active' check (status in ('active','expired','claim_open','fulfilled','void')),
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at >= starts_at),
  check (status <> 'void' or nullif(trim(void_reason), '') is not null)
);

create index solar_warranties_project_expiry_idx on public.solar_warranties (project_id, status, expires_at);

create table public.solar_service_cases (
  id uuid primary key default gen_random_uuid(),
  folio_number bigint generated always as identity unique,
  folio text generated always as ('CDSE-SP-' || lpad(folio_number::text, 6, '0')) stored unique,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  asset_id uuid references public.solar_assets(id) on delete set null,
  category text not null check (category in ('generation','electrical','monitoring','equipment','workmanship','maintenance','customer_question','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'open' check (status in ('open','diagnosing','waiting_customer','waiting_supplier','waiting_parts','scheduled','resolved','closed','cancelled')),
  source text not null default 'internal' check (source in ('customer','seller','monitoring','installer','internal')),
  subject text not null check (char_length(trim(subject)) between 3 and 160),
  description text not null check (char_length(trim(description)) between 5 and 3000),
  assigned_to uuid references auth.users(id) on delete set null,
  internal_target_at timestamptz,
  scheduled_at timestamptz,
  diagnosed_at timestamptz,
  diagnosis text,
  resolution text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('resolved','closed') or (resolved_at is not null and nullif(trim(resolution), '') is not null)),
  check (status <> 'closed' or closed_at is not null)
);

create index solar_service_cases_project_status_idx on public.solar_service_cases (project_id, status, priority, created_at desc);
create index solar_service_cases_assignee_target_idx on public.solar_service_cases (assigned_to, status, internal_target_at);

create table public.solar_service_case_events (
  id bigint generated always as identity primary key,
  service_case_id uuid not null references public.solar_service_cases(id) on delete cascade,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  event_type text not null check (event_type in ('created','status_changed','assigned','note','resolved','closed','cancelled')),
  previous_status text,
  next_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index solar_service_case_events_case_created_idx on public.solar_service_case_events (service_case_id, created_at desc);

create table public.solar_generation_readings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  actual_kwh numeric(14, 2) not null check (actual_kwh >= 0),
  expected_kwh numeric(14, 2) check (expected_kwh >= 0),
  source text not null default 'manual' check (source in ('manual','inverter_portal','customer_bill','monitoring_export','other')),
  source_reference text,
  notes text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, period_start, period_end),
  check (period_end >= period_start)
);

create index solar_generation_readings_project_period_idx on public.solar_generation_readings (project_id, period_end desc);

create table public.solar_customer_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  survey_stage text not null default 'post_installation' check (survey_stage in ('post_installation','post_interconnection','service_follow_up','annual_review')),
  nps_score smallint check (nps_score between 0 and 10),
  comments text check (comments is null or char_length(comments) <= 2000),
  referral_permission boolean not null default false,
  referral_note text,
  surveyed_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index solar_customer_feedback_project_stage_idx on public.solar_customer_feedback (project_id, survey_stage, surveyed_at desc);

create trigger solar_assets_set_updated_at before update on public.solar_assets for each row execute function public.set_updated_at();
create trigger solar_warranties_set_updated_at before update on public.solar_warranties for each row execute function public.set_updated_at();
create trigger solar_service_cases_set_updated_at before update on public.solar_service_cases for each row execute function public.set_updated_at();
create trigger solar_generation_readings_set_updated_at before update on public.solar_generation_readings for each row execute function public.set_updated_at();

create or replace function public.seed_solar_installed_assets(p_work_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.solar_work_orders;
  v_project public.solar_projects;
  v_module public.solar_modules;
  v_inverter public.solar_inverters;
  v_asset public.solar_assets;
  v_install_date date;
  v_panels integer;
  v_inverters integer;
begin
  select * into v_order from public.solar_work_orders where id = p_work_order_id and status = 'completed';
  if v_order.id is null then return; end if;
  select * into v_project from public.solar_projects where id = v_order.project_id;
  v_install_date := coalesce(v_order.completed_at::date, current_date);
  v_panels := greatest(coalesce(nullif(v_project.sold_scope_snapshot->>'panelCount','')::integer, v_order.planned_panels), 1);
  v_inverters := greatest(coalesce(nullif(v_project.sold_scope_snapshot->>'inverterQuantity','')::integer, 1), 1);
  select * into v_module from public.solar_modules where id = nullif(v_project.sold_scope_snapshot->>'moduleId','')::uuid;
  select * into v_inverter from public.solar_inverters where id = nullif(v_project.sold_scope_snapshot->>'inverterId','')::uuid;

  if v_module.id is not null then
    insert into public.solar_assets(project_id,source_work_order_id,asset_type,manufacturer,model,quantity,installed_at,metadata,created_by)
    values(v_project.id,v_order.id,'module',v_module.brand,v_module.model,v_panels,v_install_date,
      jsonb_build_object('catalogId',v_module.id,'watts',v_module.watts,'serialsPending',true),v_order.created_by)
    on conflict (source_work_order_id,asset_type) where source_work_order_id is not null and asset_type in ('module','inverter') do nothing
    returning * into v_asset;
    if v_asset.id is not null and coalesce(v_module.product_warranty_years,0) > 0 then
      insert into public.solar_warranties(project_id,asset_id,warranty_type,provider,starts_at,expires_at,coverage_summary,created_by)
      values(v_project.id,v_asset.id,'product',v_module.brand,v_install_date,(v_install_date + make_interval(years=>v_module.product_warranty_years::integer))::date,
        'Garantía de producto según catálogo; validar términos y documento del fabricante.',v_order.created_by);
    end if;
    if v_asset.id is not null and coalesce(v_module.performance_warranty_years,0) > 0 then
      insert into public.solar_warranties(project_id,asset_id,warranty_type,provider,starts_at,expires_at,coverage_summary,created_by)
      values(v_project.id,v_asset.id,'performance',v_module.brand,v_install_date,(v_install_date + make_interval(years=>v_module.performance_warranty_years::integer))::date,
        'Garantía de desempeño según catálogo; validar curva y términos del fabricante.',v_order.created_by);
    end if;
  end if;
  if v_inverter.id is not null then
    insert into public.solar_assets(project_id,source_work_order_id,asset_type,manufacturer,model,quantity,installed_at,metadata,created_by)
    values(v_project.id,v_order.id,'inverter',v_inverter.brand,v_inverter.model,v_inverters,v_install_date,
      jsonb_build_object('catalogId',v_inverter.id,'acCapacityKw',v_inverter.ac_capacity_kw,'serialsPending',true),v_order.created_by)
    on conflict (source_work_order_id,asset_type) where source_work_order_id is not null and asset_type in ('module','inverter') do nothing
    returning * into v_asset;
    if v_asset.id is not null and coalesce(v_inverter.warranty_years,0) > 0 then
      insert into public.solar_warranties(project_id,asset_id,warranty_type,provider,starts_at,expires_at,coverage_summary,created_by)
      values(v_project.id,v_asset.id,'inverter',v_inverter.brand,v_install_date,(v_install_date + make_interval(years=>v_inverter.warranty_years::integer))::date,
        'Garantía de inversor según catálogo; validar términos y registro del fabricante.',v_order.created_by);
    end if;
  end if;
end; $$;

create or replace function public.seed_solar_installed_assets_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin if new.status = 'completed' and old.status is distinct from new.status then perform public.seed_solar_installed_assets(new.id); end if; return new; end; $$;

create trigger solar_work_orders_seed_installed_assets after update of status on public.solar_work_orders
for each row execute function public.seed_solar_installed_assets_trigger();

do $$ declare v_order_id uuid; begin
  for v_order_id in select id from public.solar_work_orders where status='completed' loop perform public.seed_solar_installed_assets(v_order_id); end loop;
end $$;

create or replace function public.save_solar_asset(p_project_id uuid, p_data jsonb)
returns public.solar_assets language plpgsql security definer set search_path = '' as $$
declare v_asset public.solar_assets;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not exists(select 1 from public.solar_projects where id=p_project_id) then raise exception 'PROJECT_NOT_FOUND'; end if;
  insert into public.solar_assets(project_id,asset_type,manufacturer,model,serial_number,quantity,installed_at,status,metadata,created_by)
  values(p_project_id,p_data->>'assetType',nullif(trim(p_data->>'manufacturer'),''),trim(p_data->>'model'),
    nullif(upper(trim(p_data->>'serialNumber')),''),coalesce(nullif(p_data->>'quantity','')::integer,1),
    nullif(p_data->>'installedAt','')::date,coalesce(nullif(p_data->>'status',''),'active'),coalesce(p_data->'metadata','{}'::jsonb),auth.uid())
  returning * into v_asset;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'asset_registered',auth.uid(),jsonb_build_object('assetId',v_asset.id,'type',v_asset.asset_type,'serialNumber',v_asset.serial_number));
  return v_asset;
end; $$;

create or replace function public.save_solar_warranty(p_project_id uuid, p_data jsonb)
returns public.solar_warranties language plpgsql security definer set search_path = '' as $$
declare v_warranty public.solar_warranties;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(p_data->>'assetId','') is not null and not exists(select 1 from public.solar_assets where id=(p_data->>'assetId')::uuid and project_id=p_project_id) then raise exception 'ASSET_PROJECT_MISMATCH'; end if;
  insert into public.solar_warranties(project_id,asset_id,warranty_type,provider,starts_at,expires_at,coverage_summary,claim_contact,policy_reference,created_by)
  values(p_project_id,nullif(p_data->>'assetId','')::uuid,p_data->>'warrantyType',trim(p_data->>'provider'),(p_data->>'startsAt')::date,
    nullif(p_data->>'expiresAt','')::date,nullif(trim(p_data->>'coverageSummary'),''),nullif(trim(p_data->>'claimContact'),''),nullif(trim(p_data->>'policyReference'),''),auth.uid())
  returning * into v_warranty;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'warranty_registered',auth.uid(),jsonb_build_object('warrantyId',v_warranty.id,'type',v_warranty.warranty_type,'expiresAt',v_warranty.expires_at));
  return v_warranty;
end; $$;

create or replace function public.create_solar_service_case(p_project_id uuid, p_data jsonb)
returns public.solar_service_cases language plpgsql security definer set search_path = '' as $$
declare v_case public.solar_service_cases; v_priority text; v_target timestamptz;
begin
  if not public.can_access_solar_project(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  v_priority := coalesce(nullif(p_data->>'priority',''),'normal');
  v_target := now() + case v_priority when 'critical' then interval '24 hours' when 'high' then interval '72 hours' when 'normal' then interval '7 days' else interval '14 days' end;
  if nullif(p_data->>'assetId','') is not null and not exists(select 1 from public.solar_assets where id=(p_data->>'assetId')::uuid and project_id=p_project_id) then raise exception 'ASSET_PROJECT_MISMATCH'; end if;
  insert into public.solar_service_cases(project_id,asset_id,category,priority,source,subject,description,assigned_to,internal_target_at,created_by)
  values(p_project_id,nullif(p_data->>'assetId','')::uuid,p_data->>'category',v_priority,coalesce(nullif(p_data->>'source',''),'internal'),
    trim(p_data->>'subject'),trim(p_data->>'description'),nullif(p_data->>'assignedTo','')::uuid,v_target,auth.uid()) returning * into v_case;
  insert into public.solar_service_case_events(service_case_id,project_id,event_type,next_status,note,actor_user_id)
  values(v_case.id,p_project_id,'created','open',v_case.description,auth.uid());
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'service_case_created',auth.uid(),jsonb_build_object('serviceCaseId',v_case.id,'folio',v_case.folio,'priority',v_case.priority));
  return v_case;
end; $$;

create or replace function public.update_solar_service_case(p_case_id uuid, p_status text, p_note text default null, p_assigned_to uuid default null, p_scheduled_at timestamptz default null)
returns public.solar_service_cases language plpgsql security definer set search_path = '' as $$
declare v_case public.solar_service_cases; v_old text;
begin
  select * into v_case from public.solar_service_cases where id=p_case_id;
  if v_case.id is null or not public.can_access_solar_project(v_case.project_id) then raise exception 'SERVICE_CASE_ACCESS_DENIED'; end if;
  if not public.is_solar_admin() and p_status not in ('open','waiting_customer') then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status in ('resolved','closed') and nullif(trim(p_note),'') is null then raise exception 'SERVICE_RESOLUTION_REQUIRED'; end if;
  v_old:=v_case.status;
  update public.solar_service_cases set status=p_status,assigned_to=coalesce(p_assigned_to,assigned_to),scheduled_at=coalesce(p_scheduled_at,scheduled_at),
    diagnosed_at=case when p_status='diagnosing' then coalesce(diagnosed_at,now()) else diagnosed_at end,
    diagnosis=case when p_status='diagnosing' and nullif(trim(p_note),'') is not null then trim(p_note) else diagnosis end,
    resolution=case when p_status in ('resolved','closed') then trim(p_note) else resolution end,
    resolved_at=case when p_status in ('resolved','closed') then coalesce(resolved_at,now()) else resolved_at end,
    closed_at=case when p_status='closed' then now() else closed_at end
  where id=p_case_id returning * into v_case;
  insert into public.solar_service_case_events(service_case_id,project_id,event_type,previous_status,next_status,note,actor_user_id)
  values(v_case.id,v_case.project_id,case when p_status='resolved' then 'resolved' when p_status='closed' then 'closed' when p_status='cancelled' then 'cancelled' else 'status_changed' end,v_old,p_status,nullif(trim(p_note),''),auth.uid());
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(v_case.project_id,'service_case_status_changed',auth.uid(),jsonb_build_object('serviceCaseId',v_case.id,'previousStatus',v_old,'status',p_status));
  return v_case;
end; $$;

create or replace function public.save_solar_generation_reading(p_project_id uuid, p_data jsonb)
returns public.solar_generation_readings language plpgsql security definer set search_path = '' as $$
declare v_reading public.solar_generation_readings; v_expected numeric; v_start date; v_end date; v_annual numeric; v_days integer;
begin
  if not public.can_access_solar_project(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  v_start := (p_data->>'periodStart')::date; v_end := (p_data->>'periodEnd')::date;
  if v_end < v_start then raise exception 'GENERATION_PERIOD_INVALID'; end if;
  select nullif(sold_scope_snapshot #>> '{results,annualGenerationKwh}','')::numeric into v_annual from public.solar_projects where id=p_project_id;
  v_days := v_end-v_start+1;
  v_expected := coalesce(nullif(p_data->>'expectedKwh','')::numeric,case when v_annual is not null then round(v_annual*v_days/365.25,2) else null end);
  insert into public.solar_generation_readings(project_id,period_start,period_end,actual_kwh,expected_kwh,source,source_reference,notes,recorded_by)
  values(p_project_id,v_start,v_end,(p_data->>'actualKwh')::numeric,v_expected,coalesce(nullif(p_data->>'source',''),'manual'),nullif(trim(p_data->>'sourceReference'),''),nullif(trim(p_data->>'notes'),''),auth.uid())
  on conflict(project_id,period_start,period_end) do update set actual_kwh=excluded.actual_kwh,expected_kwh=excluded.expected_kwh,source=excluded.source,
    source_reference=excluded.source_reference,notes=excluded.notes,recorded_by=auth.uid(),updated_at=now()
  returning * into v_reading;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'generation_reading_saved',auth.uid(),jsonb_build_object('readingId',v_reading.id,'actualKwh',v_reading.actual_kwh,'expectedKwh',v_reading.expected_kwh,'periodEnd',v_reading.period_end));
  return v_reading;
end; $$;

create or replace function public.save_solar_customer_feedback(p_project_id uuid, p_data jsonb)
returns public.solar_customer_feedback language plpgsql security definer set search_path = '' as $$
declare v_feedback public.solar_customer_feedback;
begin
  if not public.can_access_solar_project(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  insert into public.solar_customer_feedback(project_id,survey_stage,nps_score,comments,referral_permission,referral_note,recorded_by)
  values(p_project_id,coalesce(nullif(p_data->>'surveyStage',''),'post_installation'),nullif(p_data->>'npsScore','')::smallint,
    nullif(trim(p_data->>'comments'),''),coalesce((p_data->>'referralPermission')::boolean,false),nullif(trim(p_data->>'referralNote'),''),auth.uid())
  returning * into v_feedback;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'customer_feedback_saved',auth.uid(),jsonb_build_object('feedbackId',v_feedback.id,'stage',v_feedback.survey_stage,'npsScore',v_feedback.nps_score,'referralPermission',v_feedback.referral_permission));
  return v_feedback;
end; $$;

alter table public.solar_assets enable row level security;
alter table public.solar_warranties enable row level security;
alter table public.solar_service_cases enable row level security;
alter table public.solar_service_case_events enable row level security;
alter table public.solar_generation_readings enable row level security;
alter table public.solar_customer_feedback enable row level security;

create policy "members read solar assets" on public.solar_assets for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "admins manage solar assets" on public.solar_assets for all to authenticated using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));
create policy "members read solar warranties" on public.solar_warranties for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "admins manage solar warranties" on public.solar_warranties for all to authenticated using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));
create policy "members read service cases" on public.solar_service_cases for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "members add service cases" on public.solar_service_cases for insert to authenticated with check ((select public.can_access_solar_project(project_id)) and created_by=(select auth.uid()));
create policy "admins manage service cases" on public.solar_service_cases for all to authenticated using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));
create policy "members read service events" on public.solar_service_case_events for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "members add service events" on public.solar_service_case_events for insert to authenticated with check ((select public.can_access_solar_project(project_id)) and actor_user_id=(select auth.uid()));
create policy "members read generation" on public.solar_generation_readings for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "members manage generation" on public.solar_generation_readings for all to authenticated using ((select public.can_access_solar_project(project_id))) with check ((select public.can_access_solar_project(project_id)) and recorded_by=(select auth.uid()));
create policy "members read feedback" on public.solar_customer_feedback for select to authenticated using ((select public.can_access_solar_project(project_id)));
create policy "members add feedback" on public.solar_customer_feedback for insert to authenticated with check ((select public.can_access_solar_project(project_id)) and recorded_by=(select auth.uid()));

grant select,insert,update on public.solar_assets,public.solar_warranties,public.solar_service_cases,public.solar_service_case_events,public.solar_generation_readings,public.solar_customer_feedback to authenticated;
grant usage,select on sequence public.solar_service_cases_folio_number_seq,public.solar_service_case_events_id_seq to authenticated;
revoke all on function public.seed_solar_installed_assets(uuid) from public;
revoke all on function public.save_solar_asset(uuid,jsonb) from public;
revoke all on function public.save_solar_warranty(uuid,jsonb) from public;
revoke all on function public.create_solar_service_case(uuid,jsonb) from public;
revoke all on function public.update_solar_service_case(uuid,text,text,uuid,timestamptz) from public;
revoke all on function public.save_solar_generation_reading(uuid,jsonb) from public;
revoke all on function public.save_solar_customer_feedback(uuid,jsonb) from public;
grant execute on function public.save_solar_asset(uuid,jsonb) to authenticated;
grant execute on function public.save_solar_warranty(uuid,jsonb) to authenticated;
grant execute on function public.create_solar_service_case(uuid,jsonb) to authenticated;
grant execute on function public.update_solar_service_case(uuid,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.save_solar_generation_reading(uuid,jsonb) to authenticated;
grant execute on function public.save_solar_customer_feedback(uuid,jsonb) to authenticated;

comment on table public.solar_assets is 'Installed project equipment and serial references for service continuity.';
comment on table public.solar_warranties is 'Manufacturer, installer and other warranties; catalog-seeded terms must be validated against the actual document.';
comment on table public.solar_service_cases is 'After-sales service cases with internal targets, not customer-facing SLA promises.';
comment on table public.solar_generation_readings is 'Periodic actual generation compared with a proposal-derived or manually validated expectation.';

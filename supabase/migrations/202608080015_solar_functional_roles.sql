-- CDSE Solar — functional staff roles, project assignments and action-level guards.

alter type public.solar_staff_role add value if not exists 'operations';
alter type public.solar_staff_role add value if not exists 'engineering';
alter type public.solar_staff_role add value if not exists 'installer';
alter type public.solar_staff_role add value if not exists 'finance';
alter type public.solar_staff_role add value if not exists 'viewer';

create table public.solar_access_events (
  id bigint generated always as identity primary key,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.solar_projects(id) on delete cascade,
  event_type text not null check (event_type in ('profile_created','profile_updated','access_suspended','access_restored','project_assigned','project_unassigned')),
  role text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index solar_access_events_target_created_idx on public.solar_access_events(target_user_id,created_at desc);
create index solar_access_events_project_created_idx on public.solar_access_events(project_id,created_at desc) where project_id is not null;

create or replace function public.is_active_solar_staff()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.solar_profiles where user_id=(select auth.uid()) and active);
$$;

create or replace function public.has_solar_capability(p_capability text)
returns boolean language sql stable security definer set search_path='' as $$
  select (select public.is_solar_admin()) or exists(
    select 1 from public.solar_profiles profile
    where profile.user_id=(select auth.uid()) and profile.active and case profile.role::text
      when 'seller' then p_capability in ('sales.workspace','projects.workspace','agenda.workspace','post_sales.workspace','finance.self')
      when 'operations' then p_capability in ('projects.workspace','agenda.workspace','installations.workspace','inventory.workspace','cfe.workspace','post_sales.workspace')
      when 'engineering' then p_capability in ('projects.workspace','agenda.workspace','inventory.workspace','cfe.workspace')
      when 'installer' then p_capability in ('projects.workspace','agenda.workspace','installations.workspace','inventory.workspace')
      when 'finance' then p_capability in ('projects.workspace','agenda.workspace','finance.workspace')
      when 'viewer' then p_capability in ('projects.workspace','agenda.workspace')
      else false end
  );
$$;

create or replace function public.can_access_solar_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select public.is_solar_admin()) or (
    exists(select 1 from public.solar_profiles where user_id=(select auth.uid()) and active)
    and (
      exists(select 1 from public.solar_projects where id=p_project_id and seller_user_id=(select auth.uid()))
      or exists(select 1 from public.solar_project_members where project_id=p_project_id and user_id=(select auth.uid()) and active)
    )
  );
$$;

create or replace function public.can_solar_project_action(p_project_id uuid,p_action text)
returns boolean language sql stable security definer set search_path='' as $$
  select (select public.is_solar_admin()) or exists(
    select 1
    from public.solar_profiles profile
    where profile.user_id=(select auth.uid()) and profile.active and (
      (
        profile.role::text='seller'
        and exists(select 1 from public.solar_projects where id=p_project_id and seller_user_id=(select auth.uid()))
        and p_action in ('sales.manage','project.tasks','project.documents','post_sales.manage')
      ) or exists(
        select 1 from public.solar_project_members member
        where member.project_id=p_project_id and member.user_id=(select auth.uid()) and member.active
          and member.project_role=case profile.role::text
            when 'seller' then 'seller' when 'operations' then 'operations' when 'engineering' then 'engineering'
            when 'installer' then 'installer' when 'finance' then 'finance' when 'viewer' then 'viewer' else '__none__' end
          and case member.project_role
            when 'seller' then p_action in ('sales.manage','project.tasks','project.documents','post_sales.manage')
            when 'operations' then p_action in ('project.tasks','project.documents','survey.manage','installation.execute','cfe.manage','inventory.read','post_sales.manage')
            when 'engineering' then p_action in ('project.tasks','project.documents','survey.manage','engineering.manage','inventory.read')
            when 'installer' then p_action in ('project.tasks','project.documents','installation.execute','inventory.read')
            when 'finance' then p_action in ('project.tasks','finance.capture')
            else false end
      )
    )
  );
$$;

create or replace function public.guard_solar_project_action()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  if auth.uid() is null then return new; end if;
  v_project_id := nullif(to_jsonb(new)->>'project_id','')::uuid;
  if v_project_id is null or not public.can_solar_project_action(v_project_id,tg_argv[0]) then
    raise exception 'PROJECT_ACTION_DENIED:%',tg_argv[0];
  end if;
  return new;
end; $$;

create trigger solar_tasks_action_guard before insert or update on public.solar_project_tasks
for each row execute function public.guard_solar_project_action('project.tasks');
create trigger solar_documents_action_guard before insert or update on public.solar_project_documents
for each row execute function public.guard_solar_project_action('project.documents');
create trigger solar_document_files_action_guard before insert or update on public.solar_project_document_files
for each row execute function public.guard_solar_project_action('project.documents');
create trigger solar_surveys_action_guard before insert or update on public.solar_site_surveys
for each row execute function public.guard_solar_project_action('survey.manage');
create trigger solar_engineering_action_guard before insert or update on public.solar_engineering_revisions
for each row execute function public.guard_solar_project_action('engineering.manage');
create trigger solar_work_orders_action_guard before insert or update on public.solar_work_orders
for each row execute function public.guard_solar_project_action('installation.execute');
create trigger solar_work_checklist_action_guard before insert or update on public.solar_work_order_checklist_items
for each row execute function public.guard_solar_project_action('installation.execute');
create trigger solar_work_incidents_action_guard before insert or update on public.solar_work_order_incidents
for each row execute function public.guard_solar_project_action('installation.execute');
create trigger solar_payments_action_guard before insert or update on public.solar_payments
for each row execute function public.guard_solar_project_action('finance.capture');
create trigger solar_cfe_cases_action_guard before insert or update on public.solar_cfe_cases
for each row execute function public.guard_solar_project_action('cfe.manage');
create trigger solar_cfe_observations_action_guard before insert or update on public.solar_cfe_observations
for each row execute function public.guard_solar_project_action('cfe.manage');
create trigger solar_service_cases_action_guard before insert or update on public.solar_service_cases
for each row execute function public.guard_solar_project_action('post_sales.manage');
create trigger solar_service_events_action_guard before insert or update on public.solar_service_case_events
for each row execute function public.guard_solar_project_action('post_sales.manage');
create trigger solar_generation_action_guard before insert or update on public.solar_generation_readings
for each row execute function public.guard_solar_project_action('post_sales.manage');
create trigger solar_feedback_action_guard before insert or update on public.solar_customer_feedback
for each row execute function public.guard_solar_project_action('post_sales.manage');

create or replace function public.assign_solar_project_member(p_project_id uuid,p_user_id uuid)
returns public.solar_project_members language plpgsql security definer set search_path='' as $$
declare v_profile public.solar_profiles; v_member public.solar_project_members; v_role text;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_profile from public.solar_profiles where user_id=p_user_id and active;
  if v_profile.user_id is null then raise exception 'ACTIVE_PROFILE_REQUIRED'; end if;
  v_role := case v_profile.role::text
    when 'seller' then 'seller' when 'operations' then 'operations' when 'engineering' then 'engineering'
    when 'installer' then 'installer' when 'finance' then 'finance' when 'viewer' then 'viewer' else null end;
  if v_role is null then raise exception 'ASSIGNABLE_ROLE_REQUIRED'; end if;
  insert into public.solar_project_members(project_id,user_id,project_role,active,assigned_by,assigned_at)
  values(p_project_id,p_user_id,v_role,true,auth.uid(),now())
  on conflict(project_id,user_id,project_role) do update set active=true,assigned_by=auth.uid(),assigned_at=now()
  returning * into v_member;
  insert into public.solar_access_events(target_user_id,project_id,event_type,role,actor_user_id)
  values(p_user_id,p_project_id,'project_assigned',v_role,auth.uid());
  return v_member;
end; $$;

create or replace function public.unassign_solar_project_member(p_project_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  update public.solar_project_members set active=false where project_id=p_project_id and user_id=p_user_id and active returning project_role into v_role;
  if v_role is null then raise exception 'ACTIVE_ASSIGNMENT_REQUIRED'; end if;
  insert into public.solar_access_events(target_user_id,project_id,event_type,role,actor_user_id)
  values(p_user_id,p_project_id,'project_unassigned',v_role,auth.uid());
end; $$;

alter table public.solar_access_events enable row level security;
create policy "admins read access events" on public.solar_access_events for select to authenticated using (public.is_solar_admin());
grant select on public.solar_access_events to authenticated;
grant usage,select on sequence public.solar_access_events_id_seq to authenticated;

drop policy if exists "solar staff read field workers" on public.solar_field_workers;
create policy "active staff read field workers" on public.solar_field_workers for select to authenticated using (public.is_active_solar_staff());
drop policy if exists "solar staff read crews" on public.solar_crews;
create policy "active staff read crews" on public.solar_crews for select to authenticated using (public.is_active_solar_staff());
drop policy if exists "solar staff read crew members" on public.solar_crew_members;
create policy "active staff read crew members" on public.solar_crew_members for select to authenticated using (public.is_active_solar_staff());
drop policy if exists "staff read inventory locations" on public.solar_inventory_locations;
create policy "active staff read inventory locations" on public.solar_inventory_locations for select to authenticated using (public.is_active_solar_staff() and (active or public.is_solar_admin()));
drop policy if exists "staff read inventory items" on public.solar_inventory_items;
create policy "active staff read inventory items" on public.solar_inventory_items for select to authenticated using (public.is_active_solar_staff() and (active or public.is_solar_admin()));
drop policy if exists "staff read inventory balances" on public.solar_inventory_balances;
create policy "active staff read inventory balances" on public.solar_inventory_balances for select to authenticated using (public.is_active_solar_staff());

drop policy if exists "staff read active modules" on public.solar_modules;
create policy "active staff read modules" on public.solar_modules for select to authenticated
using (public.is_active_solar_staff() and (active or public.is_solar_admin()));
drop policy if exists "staff read active solar inverters" on public.solar_inverters;
create policy "active staff read solar inverters" on public.solar_inverters for select to authenticated
using (public.is_active_solar_staff() and (active or public.is_solar_admin()));
drop policy if exists "staff read active zones" on public.solar_zones;
create policy "active staff read zones" on public.solar_zones for select to authenticated
using (public.is_active_solar_staff() and (active or public.is_solar_admin()));
drop policy if exists "staff read active price options" on public.solar_price_options;
create policy "active staff read price options" on public.solar_price_options for select to authenticated using (
  public.is_active_solar_staff() and (public.is_solar_admin() or (
    active and (valid_from is null or valid_from <= now()) and (valid_until is null or valid_until > now())
  ))
);
drop policy if exists "staff read active promotions" on public.solar_promotions;
create policy "active staff read promotions" on public.solar_promotions for select to authenticated using (
  public.is_active_solar_staff() and (public.is_solar_admin() or (
    active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
  ))
);
drop policy if exists "staff read active packages" on public.solar_packages;
create policy "active staff read packages" on public.solar_packages for select to authenticated using (
  public.is_active_solar_staff() and (public.is_solar_admin() or (
    active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
  ))
);
drop policy if exists "staff read active financing options" on public.solar_financing_options;
create policy "active staff read financing options" on public.solar_financing_options for select to authenticated
using (public.is_active_solar_staff() and (active or public.is_solar_admin()));
drop policy if exists "staff read document requirements" on public.solar_document_requirements;
create policy "active staff read document requirements" on public.solar_document_requirements for select to authenticated
using (public.is_active_solar_staff());

revoke all on function public.is_active_solar_staff() from public;
revoke all on function public.has_solar_capability(text) from public;
revoke all on function public.can_solar_project_action(uuid,text) from public;
revoke all on function public.assign_solar_project_member(uuid,uuid) from public;
revoke all on function public.unassign_solar_project_member(uuid,uuid) from public;
grant execute on function public.is_active_solar_staff() to authenticated;
grant execute on function public.has_solar_capability(text) to authenticated;
grant execute on function public.can_solar_project_action(uuid,text) to authenticated;
grant execute on function public.assign_solar_project_member(uuid,uuid) to authenticated;
grant execute on function public.unassign_solar_project_member(uuid,uuid) to authenticated;

comment on function public.can_solar_project_action(uuid,text) is 'Action-level authorization combining active global profile and matching project membership.';
comment on table public.solar_access_events is 'Immutable audit trail for account state and project access assignments.';

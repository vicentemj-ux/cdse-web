-- Use the actual catalog columns when seeding project cost budgets.
create or replace function public.seed_solar_project_cost_budget(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.solar_projects;
  v_module public.solar_modules;
  v_inverter public.solar_inverters;
  v_panels integer;
  v_inverters integer;
begin
  select * into v_project from public.solar_projects where id = p_project_id;
  if v_project.id is null or exists (
    select 1 from public.solar_project_cost_entries where project_id = p_project_id and cost_stage = 'budget'
  ) then return; end if;

  v_panels := greatest(coalesce(nullif(v_project.sold_scope_snapshot->>'panelCount', '')::integer, 1), 1);
  v_inverters := greatest(coalesce(nullif(v_project.sold_scope_snapshot->>'inverterQuantity', '')::integer, 1), 1);
  select * into v_module from public.solar_modules where id = nullif(v_project.sold_scope_snapshot->>'moduleId', '')::uuid;
  select * into v_inverter from public.solar_inverters where id = nullif(v_project.sold_scope_snapshot->>'inverterId', '')::uuid;

  if coalesce(v_module.unit_cost_mxn, 0) > 0 then
    insert into public.solar_project_cost_entries (
      project_id, cost_stage, category, description, quantity, unit_cost_before_vat_mxn,
      vat_rate, status, created_by, approved_by, approved_at
    ) values (
      v_project.id, 'budget', 'modules', trim(concat_ws(' ', v_module.brand, v_module.model)), v_panels,
      v_module.unit_cost_mxn, v_project.vat_rate, 'approved', v_project.created_by, v_project.created_by, now()
    );
  end if;
  if coalesce(v_inverter.unit_cost_mxn, 0) > 0 then
    insert into public.solar_project_cost_entries (
      project_id, cost_stage, category, description, quantity, unit_cost_before_vat_mxn,
      vat_rate, status, created_by, approved_by, approved_at
    ) values (
      v_project.id, 'budget', 'inverter', trim(concat_ws(' ', v_inverter.brand, v_inverter.model)), v_inverters,
      v_inverter.unit_cost_mxn, v_project.vat_rate, 'approved', v_project.created_by, v_project.created_by, now()
    );
  end if;
end;
$$;

do $$ declare v_project_id uuid;
begin
  for v_project_id in select id from public.solar_projects loop
    perform public.seed_solar_project_cost_budget(v_project_id);
  end loop;
end $$;

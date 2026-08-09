-- CDSE Solar — physical inventory, project allocations and immutable movement ledger.

create table public.solar_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{2,30}$'),
  name text not null check (char_length(name) between 2 and 100),
  address text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (char_length(sku) between 2 and 80),
  name text not null check (char_length(name) between 2 and 180),
  category text not null check (category in (
    'module','inverter','mounting','electrical','protection','monitoring','consumable','other'
  )),
  unit text not null default 'piece' check (unit in ('piece','meter','kit','roll','box','liter','kg')),
  module_id uuid references public.solar_modules(id) on delete set null,
  inverter_id uuid references public.solar_inverters(id) on delete set null,
  default_unit_cost_before_vat_mxn numeric(14,2) check (default_unit_cost_before_vat_mxn >= 0),
  reorder_point numeric(14,3) not null default 0 check (reorder_point >= 0),
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(module_id, inverter_id) <= 1)
);

create unique index solar_inventory_items_module_unique on public.solar_inventory_items(module_id) where module_id is not null;
create unique index solar_inventory_items_inverter_unique on public.solar_inventory_items(inverter_id) where inverter_id is not null;
create index solar_inventory_items_category_active_idx on public.solar_inventory_items(category, active, name);

create table public.solar_inventory_balances (
  item_id uuid not null references public.solar_inventory_items(id) on delete restrict,
  location_id uuid not null references public.solar_inventory_locations(id) on delete restrict,
  on_hand numeric(14,3) not null default 0 check (on_hand >= 0),
  reserved numeric(14,3) not null default 0 check (reserved >= 0 and reserved <= on_hand),
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);

create table public.solar_inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  work_order_id uuid references public.solar_work_orders(id) on delete set null,
  item_id uuid not null references public.solar_inventory_items(id) on delete restrict,
  location_id uuid not null references public.solar_inventory_locations(id) on delete restrict,
  planned_quantity numeric(14,3) not null check (planned_quantity > 0),
  reserved_quantity numeric(14,3) not null default 0 check (reserved_quantity >= 0),
  issued_quantity numeric(14,3) not null default 0 check (issued_quantity >= 0),
  returned_quantity numeric(14,3) not null default 0 check (returned_quantity >= 0 and returned_quantity <= issued_quantity),
  status text not null default 'pending' check (status in ('pending','partial','ready','issued','closed','cancelled')),
  source text not null default 'manual' check (source in ('sold_scope','engineering','manual','service')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'cancelled' or reserved_quantity = 0)
);

create index solar_inventory_allocations_project_idx on public.solar_inventory_allocations(project_id, status, created_at);
create index solar_inventory_allocations_item_idx on public.solar_inventory_allocations(item_id, location_id, status);

create table public.solar_inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.solar_inventory_items(id) on delete restrict,
  location_id uuid not null references public.solar_inventory_locations(id) on delete restrict,
  allocation_id uuid references public.solar_inventory_allocations(id) on delete restrict,
  project_id uuid references public.solar_projects(id) on delete restrict,
  work_order_id uuid references public.solar_work_orders(id) on delete set null,
  movement_type text not null check (movement_type in (
    'receipt','adjustment_in','adjustment_out','reserve','release','issue','return'
  )),
  quantity numeric(14,3) not null check (quantity > 0),
  on_hand_before numeric(14,3) not null,
  on_hand_after numeric(14,3) not null,
  reserved_before numeric(14,3) not null,
  reserved_after numeric(14,3) not null,
  unit_cost_before_vat_mxn numeric(14,2) check (unit_cost_before_vat_mxn >= 0),
  reference text,
  notes text,
  performed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index solar_inventory_movements_item_created_idx on public.solar_inventory_movements(item_id, location_id, created_at desc);
create index solar_inventory_movements_project_created_idx on public.solar_inventory_movements(project_id, created_at desc) where project_id is not null;

create trigger solar_inventory_locations_set_updated_at before update on public.solar_inventory_locations
for each row execute function public.set_updated_at();
create trigger solar_inventory_items_set_updated_at before update on public.solar_inventory_items
for each row execute function public.set_updated_at();
create trigger solar_inventory_allocations_set_updated_at before update on public.solar_inventory_allocations
for each row execute function public.set_updated_at();

insert into public.solar_inventory_locations (code, name, address)
values ('MORELOS-209', 'Almacén Morelos', 'Calle Morelos #209 Ote., Col. Centro, Los Mochis, Sinaloa')
on conflict (code) do update set name=excluded.name, address=excluded.address, active=true;

insert into public.solar_inventory_items (
  sku, name, category, unit, module_id, default_unit_cost_before_vat_mxn, active
)
select module.sku, module.brand || ' ' || module.model || ' · ' || module.watts || ' W', 'module', 'piece', module.id, module.unit_cost_mxn, module.active
from public.solar_modules module
on conflict (module_id) where module_id is not null do update set
  sku=excluded.sku, name=excluded.name, default_unit_cost_before_vat_mxn=excluded.default_unit_cost_before_vat_mxn, active=excluded.active;

insert into public.solar_inventory_items (
  sku, name, category, unit, inverter_id, default_unit_cost_before_vat_mxn, active
)
select inverter.sku, inverter.brand || ' ' || inverter.model || ' · ' || inverter.ac_capacity_kw || ' kW', 'inverter', 'piece', inverter.id, inverter.unit_cost_mxn, inverter.active
from public.solar_inverters inverter
on conflict (inverter_id) where inverter_id is not null do update set
  sku=excluded.sku, name=excluded.name, default_unit_cost_before_vat_mxn=excluded.default_unit_cost_before_vat_mxn, active=excluded.active;

create or replace function public.sync_solar_catalog_inventory_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'solar_modules' then
    insert into public.solar_inventory_items (sku,name,category,unit,module_id,default_unit_cost_before_vat_mxn,active)
    values (new.sku,new.brand||' '||new.model||' · '||new.watts||' W','module','piece',new.id,new.unit_cost_mxn,new.active)
    on conflict (module_id) where module_id is not null do update set sku=excluded.sku,name=excluded.name,default_unit_cost_before_vat_mxn=excluded.default_unit_cost_before_vat_mxn,active=excluded.active;
  else
    insert into public.solar_inventory_items (sku,name,category,unit,inverter_id,default_unit_cost_before_vat_mxn,active)
    values (new.sku,new.brand||' '||new.model||' · '||new.ac_capacity_kw||' kW','inverter','piece',new.id,new.unit_cost_mxn,new.active)
    on conflict (inverter_id) where inverter_id is not null do update set sku=excluded.sku,name=excluded.name,default_unit_cost_before_vat_mxn=excluded.default_unit_cost_before_vat_mxn,active=excluded.active;
  end if;
  return new;
end; $$;

create trigger solar_modules_sync_inventory after insert or update of sku,brand,model,watts,unit_cost_mxn,active on public.solar_modules
for each row execute function public.sync_solar_catalog_inventory_item();
create trigger solar_inverters_sync_inventory after insert or update of sku,brand,model,ac_capacity_kw,unit_cost_mxn,active on public.solar_inverters
for each row execute function public.sync_solar_catalog_inventory_item();

create or replace function public.refresh_solar_inventory_allocation_status(p_allocation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_allocation public.solar_inventory_allocations; v_net_issued numeric;
begin
  select * into v_allocation from public.solar_inventory_allocations where id=p_allocation_id;
  if v_allocation.id is null or v_allocation.status='cancelled' then return; end if;
  v_net_issued := v_allocation.issued_quantity-v_allocation.returned_quantity;
  update public.solar_inventory_allocations set status = case
    when v_net_issued >= planned_quantity and reserved_quantity=0 then 'issued'
    when reserved_quantity >= greatest(planned_quantity-v_net_issued,0) and planned_quantity-v_net_issued > 0 then 'ready'
    when reserved_quantity > 0 or v_net_issued > 0 then 'partial'
    else 'pending' end
  where id=p_allocation_id;
end; $$;

create or replace function public.seed_solar_project_materials(p_project_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_project public.solar_projects;
  v_location uuid;
  v_item uuid;
  v_quantity numeric;
begin
  select * into v_project from public.solar_projects where id=p_project_id;
  if v_project.id is null then return; end if;
  select id into v_location from public.solar_inventory_locations where active order by created_at limit 1;
  if v_location is null then return; end if;

  select id into v_item from public.solar_inventory_items where module_id=nullif(v_project.sold_scope_snapshot->>'moduleId','')::uuid;
  v_quantity := nullif(v_project.sold_scope_snapshot->>'panelCount','')::numeric;
  if v_item is not null and coalesce(v_quantity,0)>0 and not exists (
    select 1 from public.solar_inventory_allocations where project_id=p_project_id and item_id=v_item and source='sold_scope'
  ) then
    insert into public.solar_inventory_allocations(project_id,item_id,location_id,planned_quantity,source,notes,created_by)
    values (p_project_id,v_item,v_location,v_quantity,'sold_scope','Alcance comercial aceptado',v_project.created_by);
  end if;

  select id into v_item from public.solar_inventory_items where inverter_id=nullif(v_project.sold_scope_snapshot->>'inverterId','')::uuid;
  v_quantity := coalesce(nullif(v_project.sold_scope_snapshot->>'inverterQuantity','')::numeric,1);
  if v_item is not null and v_quantity>0 and not exists (
    select 1 from public.solar_inventory_allocations where project_id=p_project_id and item_id=v_item and source='sold_scope'
  ) then
    insert into public.solar_inventory_allocations(project_id,item_id,location_id,planned_quantity,source,notes,created_by)
    values (p_project_id,v_item,v_location,v_quantity,'sold_scope','Alcance comercial aceptado',v_project.created_by);
  end if;
end; $$;

create or replace function public.seed_solar_project_materials_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.seed_solar_project_materials(new.id); return new; end; $$;

create trigger solar_projects_seed_materials after insert on public.solar_projects
for each row execute function public.seed_solar_project_materials_trigger();

do $$ declare v_project_id uuid; begin
  for v_project_id in select id from public.solar_projects loop perform public.seed_solar_project_materials(v_project_id); end loop;
end $$;

create or replace function public.create_solar_inventory_item(p_data jsonb)
returns public.solar_inventory_items language plpgsql security definer set search_path = '' as $$
declare v_item public.solar_inventory_items;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_data->>'sku'),'') is null or nullif(trim(p_data->>'name'),'') is null then raise exception 'ITEM_IDENTITY_REQUIRED'; end if;
  insert into public.solar_inventory_items(sku,name,category,unit,default_unit_cost_before_vat_mxn,reorder_point,notes,created_by)
  values (upper(trim(p_data->>'sku')),trim(p_data->>'name'),coalesce(nullif(p_data->>'category',''),'other'),coalesce(nullif(p_data->>'unit',''),'piece'),nullif(p_data->>'unitCost','')::numeric,coalesce(nullif(p_data->>'reorderPoint','')::numeric,0),nullif(trim(p_data->>'notes'),''),auth.uid())
  returning * into v_item;
  return v_item;
end; $$;

create or replace function public.record_solar_inventory_stock(
  p_item_id uuid, p_location_id uuid, p_movement_type text, p_quantity numeric,
  p_unit_cost_before_vat_mxn numeric default null, p_reference text default null, p_notes text default null
)
returns public.solar_inventory_balances language plpgsql security definer set search_path = '' as $$
declare v_balance public.solar_inventory_balances; v_before numeric; v_after numeric;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_movement_type not in ('receipt','adjustment_in','adjustment_out') then raise exception 'INVALID_STOCK_MOVEMENT'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  insert into public.solar_inventory_balances(item_id,location_id) values(p_item_id,p_location_id) on conflict do nothing;
  select * into v_balance from public.solar_inventory_balances where item_id=p_item_id and location_id=p_location_id for update;
  v_before := v_balance.on_hand;
  v_after := v_before + case when p_movement_type in ('receipt','adjustment_in') then p_quantity else -p_quantity end;
  if v_after < v_balance.reserved then raise exception 'STOCK_BELOW_RESERVED'; end if;
  update public.solar_inventory_balances set on_hand=v_after,updated_at=now() where item_id=p_item_id and location_id=p_location_id returning * into v_balance;
  insert into public.solar_inventory_movements(item_id,location_id,movement_type,quantity,on_hand_before,on_hand_after,reserved_before,reserved_after,unit_cost_before_vat_mxn,reference,notes,performed_by)
  values(p_item_id,p_location_id,p_movement_type,p_quantity,v_before,v_after,v_balance.reserved,v_balance.reserved,p_unit_cost_before_vat_mxn,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
  return v_balance;
end; $$;

create or replace function public.plan_solar_project_material(
  p_project_id uuid, p_item_id uuid, p_location_id uuid, p_planned_quantity numeric,
  p_work_order_id uuid default null, p_notes text default null
)
returns public.solar_inventory_allocations language plpgsql security definer set search_path = '' as $$
declare v_allocation public.solar_inventory_allocations;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if coalesce(p_planned_quantity,0)<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  if p_work_order_id is not null and not exists(select 1 from public.solar_work_orders where id=p_work_order_id and project_id=p_project_id) then raise exception 'WORK_ORDER_PROJECT_MISMATCH'; end if;
  insert into public.solar_inventory_allocations(project_id,work_order_id,item_id,location_id,planned_quantity,source,notes,created_by)
  values(p_project_id,p_work_order_id,p_item_id,p_location_id,p_planned_quantity,'manual',nullif(trim(p_notes),''),auth.uid()) returning * into v_allocation;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'inventory_material_planned',auth.uid(),jsonb_build_object('allocationId',v_allocation.id,'itemId',p_item_id,'quantity',p_planned_quantity));
  return v_allocation;
end; $$;

create or replace function public.move_solar_project_material(
  p_allocation_id uuid, p_action text, p_quantity numeric, p_work_order_id uuid default null,
  p_reference text default null, p_notes text default null
)
returns public.solar_inventory_allocations language plpgsql security definer set search_path = '' as $$
declare
  v_allocation public.solar_inventory_allocations;
  v_balance public.solar_inventory_balances;
  v_on_hand_before numeric;
  v_reserved_before numeric;
  v_net_issued numeric;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_action not in ('reserve','release','issue','return') then raise exception 'INVALID_PROJECT_MATERIAL_ACTION'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  select * into v_allocation from public.solar_inventory_allocations where id=p_allocation_id for update;
  if v_allocation.id is null then raise exception 'ALLOCATION_NOT_FOUND'; end if;
  if v_allocation.status in ('cancelled','closed') then raise exception 'ALLOCATION_CLOSED'; end if;
  if p_work_order_id is not null and not exists(select 1 from public.solar_work_orders where id=p_work_order_id and project_id=v_allocation.project_id) then raise exception 'WORK_ORDER_PROJECT_MISMATCH'; end if;
  insert into public.solar_inventory_balances(item_id,location_id) values(v_allocation.item_id,v_allocation.location_id) on conflict do nothing;
  select * into v_balance from public.solar_inventory_balances where item_id=v_allocation.item_id and location_id=v_allocation.location_id for update;
  v_on_hand_before := v_balance.on_hand; v_reserved_before := v_balance.reserved;

  if p_action='reserve' then
    if p_quantity > v_balance.on_hand-v_balance.reserved then raise exception 'INSUFFICIENT_AVAILABLE_STOCK'; end if;
    if v_allocation.reserved_quantity+p_quantity+v_allocation.issued_quantity-v_allocation.returned_quantity > v_allocation.planned_quantity then raise exception 'RESERVATION_EXCEEDS_PLAN'; end if;
    update public.solar_inventory_balances set reserved=reserved+p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity+p_quantity where id=v_allocation.id;
  elsif p_action='release' then
    if p_quantity > v_allocation.reserved_quantity then raise exception 'RELEASE_EXCEEDS_RESERVATION'; end if;
    update public.solar_inventory_balances set reserved=reserved-p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity-p_quantity where id=v_allocation.id;
  elsif p_action='issue' then
    if p_quantity > v_allocation.reserved_quantity then raise exception 'ISSUE_REQUIRES_RESERVATION'; end if;
    update public.solar_inventory_balances set on_hand=on_hand-p_quantity,reserved=reserved-p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity-p_quantity,issued_quantity=issued_quantity+p_quantity,work_order_id=coalesce(p_work_order_id,work_order_id) where id=v_allocation.id;
  else
    v_net_issued := v_allocation.issued_quantity-v_allocation.returned_quantity;
    if p_quantity > v_net_issued then raise exception 'RETURN_EXCEEDS_NET_ISSUED'; end if;
    update public.solar_inventory_balances set on_hand=on_hand+p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set returned_quantity=returned_quantity+p_quantity where id=v_allocation.id;
  end if;

  insert into public.solar_inventory_movements(item_id,location_id,allocation_id,project_id,work_order_id,movement_type,quantity,on_hand_before,on_hand_after,reserved_before,reserved_after,reference,notes,performed_by)
  values(v_allocation.item_id,v_allocation.location_id,v_allocation.id,v_allocation.project_id,coalesce(p_work_order_id,v_allocation.work_order_id),p_action,p_quantity,v_on_hand_before,v_balance.on_hand,v_reserved_before,v_balance.reserved,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
  perform public.refresh_solar_inventory_allocation_status(v_allocation.id);
  select * into v_allocation from public.solar_inventory_allocations where id=p_allocation_id;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(v_allocation.project_id,'inventory_material_'||p_action,auth.uid(),jsonb_build_object('allocationId',v_allocation.id,'quantity',p_quantity,'workOrderId',p_work_order_id));
  return v_allocation;
end; $$;

alter table public.solar_inventory_locations enable row level security;
alter table public.solar_inventory_items enable row level security;
alter table public.solar_inventory_balances enable row level security;
alter table public.solar_inventory_allocations enable row level security;
alter table public.solar_inventory_movements enable row level security;

create policy "staff read inventory locations" on public.solar_inventory_locations for select to authenticated using (active or public.is_solar_admin());
create policy "admins manage inventory locations" on public.solar_inventory_locations for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "staff read inventory items" on public.solar_inventory_items for select to authenticated using (active or public.is_solar_admin());
create policy "admins manage inventory items" on public.solar_inventory_items for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "staff read inventory balances" on public.solar_inventory_balances for select to authenticated using (true);
create policy "members read project material allocations" on public.solar_inventory_allocations for select to authenticated using (public.can_access_solar_project(project_id));
create policy "admins manage project material allocations" on public.solar_inventory_allocations for all to authenticated using (public.is_solar_admin()) with check (public.is_solar_admin());
create policy "members read project inventory movements" on public.solar_inventory_movements for select to authenticated using (project_id is null and public.is_solar_admin() or project_id is not null and public.can_access_solar_project(project_id));

grant select,insert,update,delete on public.solar_inventory_locations,public.solar_inventory_items,public.solar_inventory_allocations to authenticated;
grant select on public.solar_inventory_balances,public.solar_inventory_movements to authenticated;
grant usage,select on sequence public.solar_inventory_movements_id_seq to authenticated;

revoke all on function public.sync_solar_catalog_inventory_item() from public;
revoke all on function public.refresh_solar_inventory_allocation_status(uuid) from public;
revoke all on function public.seed_solar_project_materials(uuid) from public;
revoke all on function public.create_solar_inventory_item(jsonb) from public;
revoke all on function public.record_solar_inventory_stock(uuid,uuid,text,numeric,numeric,text,text) from public;
revoke all on function public.plan_solar_project_material(uuid,uuid,uuid,numeric,uuid,text) from public;
revoke all on function public.move_solar_project_material(uuid,text,numeric,uuid,text,text) from public;
grant execute on function public.create_solar_inventory_item(jsonb) to authenticated;
grant execute on function public.record_solar_inventory_stock(uuid,uuid,text,numeric,numeric,text,text) to authenticated;
grant execute on function public.plan_solar_project_material(uuid,uuid,uuid,numeric,uuid,text) to authenticated;
grant execute on function public.move_solar_project_material(uuid,text,numeric,uuid,text,text) to authenticated;

comment on table public.solar_inventory_balances is 'Current physical and reserved stock; only inventory RPCs may mutate balances.';
comment on table public.solar_inventory_movements is 'Immutable audit ledger for every physical or reservation inventory change.';
comment on table public.solar_inventory_allocations is 'Planned, reserved, issued and returned materials linked to a solar project.';

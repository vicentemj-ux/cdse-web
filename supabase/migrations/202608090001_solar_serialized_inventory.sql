-- CDSE Solar — unit-level equipment traceability from warehouse to installed asset.

alter table public.solar_inventory_items
  add column serial_tracking boolean not null default false;

update public.solar_inventory_items
set serial_tracking = true
where category in ('module','inverter');

create or replace function public.enforce_solar_inventory_serial_tracking()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.category in ('module','inverter') then new.serial_tracking:=true; end if;
  return new;
end; $$;

create trigger solar_inventory_items_enforce_serial_tracking
before insert or update of category,serial_tracking on public.solar_inventory_items
for each row execute function public.enforce_solar_inventory_serial_tracking();

create table public.solar_inventory_serials (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.solar_inventory_items(id) on delete restrict,
  location_id uuid references public.solar_inventory_locations(id) on delete restrict,
  allocation_id uuid references public.solar_inventory_allocations(id) on delete restrict,
  project_id uuid references public.solar_projects(id) on delete restrict,
  work_order_id uuid references public.solar_work_orders(id) on delete set null,
  asset_id uuid references public.solar_assets(id) on delete set null,
  serial_number text not null check (char_length(serial_number) between 3 and 180),
  status text not null default 'in_stock' check (status in (
    'in_stock','reserved','issued','installed','quarantined','retired'
  )),
  received_reference text,
  received_at timestamptz not null default now(),
  installed_at date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('reserved','issued','installed') or (allocation_id is not null and project_id is not null)),
  check (status <> 'installed' or (asset_id is not null and installed_at is not null))
);

create unique index solar_inventory_serials_number_unique
  on public.solar_inventory_serials(lower(serial_number));
create index solar_inventory_serials_item_status_idx
  on public.solar_inventory_serials(item_id,location_id,status,serial_number);
create index solar_inventory_serials_project_status_idx
  on public.solar_inventory_serials(project_id,status,serial_number) where project_id is not null;

create table public.solar_inventory_serial_events (
  id bigint generated always as identity primary key,
  serial_id uuid not null references public.solar_inventory_serials(id) on delete restrict,
  event_type text not null check (event_type in (
    'received','identified','reserved','released','issued','returned','installed','quarantined','reactivated','retired'
  )),
  previous_status text,
  next_status text not null,
  location_id uuid references public.solar_inventory_locations(id) on delete set null,
  allocation_id uuid references public.solar_inventory_allocations(id) on delete set null,
  project_id uuid references public.solar_projects(id) on delete set null,
  work_order_id uuid references public.solar_work_orders(id) on delete set null,
  asset_id uuid references public.solar_assets(id) on delete set null,
  reference text,
  notes text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index solar_inventory_serial_events_serial_created_idx
  on public.solar_inventory_serial_events(serial_id,created_at desc);
create index solar_inventory_serial_events_project_created_idx
  on public.solar_inventory_serial_events(project_id,created_at desc) where project_id is not null;

create trigger solar_inventory_serials_set_updated_at before update on public.solar_inventory_serials
for each row execute function public.set_updated_at();

create or replace function public.receive_solar_serialized_stock(
  p_item_id uuid, p_location_id uuid, p_serial_numbers text[],
  p_unit_cost_before_vat_mxn numeric default null, p_reference text default null, p_notes text default null
)
returns setof public.solar_inventory_serials language plpgsql security definer set search_path='' as $$
declare
  v_item public.solar_inventory_items;
  v_balance public.solar_inventory_balances;
  v_serial text;
  v_serials text[];
  v_count integer;
  v_before numeric;
  v_row public.solar_inventory_serials;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_item from public.solar_inventory_items where id=p_item_id and active;
  if v_item.id is null then raise exception 'INVENTORY_ITEM_NOT_FOUND'; end if;
  if not v_item.serial_tracking or v_item.unit <> 'piece' then raise exception 'ITEM_NOT_SERIAL_TRACKED'; end if;
  if nullif(trim(p_reference),'') is null then raise exception 'RECEIPT_REFERENCE_REQUIRED'; end if;

  select array_agg(value order by value) into v_serials from (
    select distinct upper(regexp_replace(trim(raw), '\s+', '', 'g')) value
    from unnest(coalesce(p_serial_numbers,array[]::text[])) raw
    where nullif(trim(raw),'') is not null
  ) normalized;
  v_count := coalesce(array_length(v_serials,1),0);
  if v_count=0 then raise exception 'SERIALS_REQUIRED'; end if;
  if exists(select 1 from unnest(v_serials) value where value !~ '^[A-Z0-9][A-Z0-9._/-]{2,179}$') then raise exception 'INVALID_SERIAL_FORMAT'; end if;
  if exists(select 1 from public.solar_inventory_serials serial where lower(serial.serial_number)=any(select lower(value) from unnest(v_serials) value)) then
    raise exception 'SERIAL_ALREADY_EXISTS';
  end if;

  insert into public.solar_inventory_balances(item_id,location_id) values(p_item_id,p_location_id) on conflict do nothing;
  select * into v_balance from public.solar_inventory_balances where item_id=p_item_id and location_id=p_location_id for update;
  v_before := v_balance.on_hand;
  update public.solar_inventory_balances set on_hand=on_hand+v_count,updated_at=now()
    where item_id=p_item_id and location_id=p_location_id returning * into v_balance;
  insert into public.solar_inventory_movements(item_id,location_id,movement_type,quantity,on_hand_before,on_hand_after,reserved_before,reserved_after,unit_cost_before_vat_mxn,reference,notes,performed_by)
  values(p_item_id,p_location_id,'receipt',v_count,v_before,v_balance.on_hand,v_balance.reserved,v_balance.reserved,p_unit_cost_before_vat_mxn,trim(p_reference),nullif(trim(p_notes),''),auth.uid());

  foreach v_serial in array v_serials loop
    insert into public.solar_inventory_serials(item_id,location_id,serial_number,received_reference,notes,created_by)
    values(p_item_id,p_location_id,v_serial,trim(p_reference),nullif(trim(p_notes),''),auth.uid()) returning * into v_row;
    insert into public.solar_inventory_serial_events(serial_id,event_type,next_status,location_id,reference,notes,actor_user_id)
    values(v_row.id,'received','in_stock',p_location_id,trim(p_reference),nullif(trim(p_notes),''),auth.uid());
    return next v_row;
  end loop;
end; $$;

create or replace function public.identify_solar_inventory_serials(
  p_item_id uuid, p_location_id uuid, p_serial_numbers text[], p_reference text default null, p_notes text default null
)
returns setof public.solar_inventory_serials language plpgsql security definer set search_path='' as $$
declare
  v_item public.solar_inventory_items;
  v_balance public.solar_inventory_balances;
  v_serial text;
  v_serials text[];
  v_count integer;
  v_tracked integer;
  v_row public.solar_inventory_serials;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_item from public.solar_inventory_items where id=p_item_id and active;
  if v_item.id is null then raise exception 'INVENTORY_ITEM_NOT_FOUND'; end if;
  if not v_item.serial_tracking or v_item.unit <> 'piece' then raise exception 'ITEM_NOT_SERIAL_TRACKED'; end if;
  select array_agg(value order by value) into v_serials from (
    select distinct upper(regexp_replace(trim(raw), '\s+', '', 'g')) value
    from unnest(coalesce(p_serial_numbers,array[]::text[])) raw where nullif(trim(raw),'') is not null
  ) normalized;
  v_count := coalesce(array_length(v_serials,1),0);
  if v_count=0 then raise exception 'SERIALS_REQUIRED'; end if;
  if exists(select 1 from unnest(v_serials) value where value !~ '^[A-Z0-9][A-Z0-9._/-]{2,179}$') then raise exception 'INVALID_SERIAL_FORMAT'; end if;
  if exists(select 1 from public.solar_inventory_serials serial where lower(serial.serial_number)=any(select lower(value) from unnest(v_serials) value)) then raise exception 'SERIAL_ALREADY_EXISTS'; end if;
  select * into v_balance from public.solar_inventory_balances where item_id=p_item_id and location_id=p_location_id for update;
  if v_balance.item_id is null then raise exception 'NO_PHYSICAL_STOCK_TO_IDENTIFY'; end if;
  select count(*) into v_tracked from public.solar_inventory_serials where item_id=p_item_id and location_id=p_location_id and status in ('in_stock','reserved');
  if v_tracked+v_count > v_balance.on_hand then raise exception 'SERIALS_EXCEED_PHYSICAL_STOCK'; end if;

  foreach v_serial in array v_serials loop
    insert into public.solar_inventory_serials(item_id,location_id,serial_number,received_reference,notes,created_by)
    values(p_item_id,p_location_id,v_serial,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid()) returning * into v_row;
    insert into public.solar_inventory_serial_events(serial_id,event_type,next_status,location_id,reference,notes,actor_user_id)
    values(v_row.id,'identified','in_stock',p_location_id,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
    return next v_row;
  end loop;
end; $$;

create or replace function public.move_solar_project_serials(
  p_allocation_id uuid, p_action text, p_serial_ids uuid[], p_work_order_id uuid default null,
  p_reference text default null, p_notes text default null
)
returns public.solar_inventory_allocations language plpgsql security definer set search_path='' as $$
declare
  v_allocation public.solar_inventory_allocations;
  v_balance public.solar_inventory_balances;
  v_serial public.solar_inventory_serials;
  v_ids uuid[];
  v_quantity integer;
  v_on_hand_before numeric;
  v_reserved_before numeric;
  v_net_issued numeric;
  v_expected_status text;
  v_next_status text;
  v_event text;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_action not in ('reserve','release','issue','return') then raise exception 'INVALID_PROJECT_MATERIAL_ACTION'; end if;
  select array_agg(distinct value) into v_ids from unnest(coalesce(p_serial_ids,array[]::uuid[])) value;
  v_quantity := coalesce(array_length(v_ids,1),0);
  if v_quantity=0 then raise exception 'SERIALS_REQUIRED'; end if;
  select * into v_allocation from public.solar_inventory_allocations where id=p_allocation_id for update;
  if v_allocation.id is null then raise exception 'ALLOCATION_NOT_FOUND'; end if;
  if v_allocation.status in ('cancelled','closed') then raise exception 'ALLOCATION_CLOSED'; end if;
  if not exists(select 1 from public.solar_inventory_items where id=v_allocation.item_id and serial_tracking) then raise exception 'ITEM_NOT_SERIAL_TRACKED'; end if;
  if p_work_order_id is not null and not exists(select 1 from public.solar_work_orders where id=p_work_order_id and project_id=v_allocation.project_id) then raise exception 'WORK_ORDER_PROJECT_MISMATCH'; end if;

  v_expected_status := case when p_action='reserve' then 'in_stock' when p_action in ('release','issue') then 'reserved' else 'issued' end;
  for v_serial in select * from public.solar_inventory_serials where id=any(v_ids) for update loop
    if v_serial.item_id<>v_allocation.item_id or v_serial.status<>v_expected_status then raise exception 'SERIAL_STATE_MISMATCH'; end if;
    if p_action='reserve' and (v_serial.location_id<>v_allocation.location_id or v_serial.allocation_id is not null) then raise exception 'SERIAL_LOCATION_MISMATCH'; end if;
    if p_action<>'reserve' and v_serial.allocation_id<>v_allocation.id then raise exception 'SERIAL_ALLOCATION_MISMATCH'; end if;
  end loop;
  if (select count(*) from public.solar_inventory_serials where id=any(v_ids))<>v_quantity then raise exception 'SERIAL_NOT_FOUND'; end if;

  insert into public.solar_inventory_balances(item_id,location_id) values(v_allocation.item_id,v_allocation.location_id) on conflict do nothing;
  select * into v_balance from public.solar_inventory_balances where item_id=v_allocation.item_id and location_id=v_allocation.location_id for update;
  v_on_hand_before:=v_balance.on_hand; v_reserved_before:=v_balance.reserved;
  if p_action='reserve' then
    if v_quantity>v_balance.on_hand-v_balance.reserved then raise exception 'INSUFFICIENT_AVAILABLE_STOCK'; end if;
    if v_allocation.reserved_quantity+v_quantity+v_allocation.issued_quantity-v_allocation.returned_quantity>v_allocation.planned_quantity then raise exception 'RESERVATION_EXCEEDS_PLAN'; end if;
    update public.solar_inventory_balances set reserved=reserved+v_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity+v_quantity where id=v_allocation.id;
    v_next_status:='reserved'; v_event:='reserved';
  elsif p_action='release' then
    if v_quantity>v_allocation.reserved_quantity then raise exception 'RELEASE_EXCEEDS_RESERVATION'; end if;
    update public.solar_inventory_balances set reserved=reserved-v_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity-v_quantity where id=v_allocation.id;
    v_next_status:='in_stock'; v_event:='released';
  elsif p_action='issue' then
    if v_quantity>v_allocation.reserved_quantity then raise exception 'ISSUE_REQUIRES_RESERVATION'; end if;
    update public.solar_inventory_balances set on_hand=on_hand-v_quantity,reserved=reserved-v_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity-v_quantity,issued_quantity=issued_quantity+v_quantity,work_order_id=coalesce(p_work_order_id,work_order_id) where id=v_allocation.id;
    v_next_status:='issued'; v_event:='issued';
  else
    v_net_issued:=v_allocation.issued_quantity-v_allocation.returned_quantity;
    if v_quantity>v_net_issued then raise exception 'RETURN_EXCEEDS_NET_ISSUED'; end if;
    update public.solar_inventory_balances set on_hand=on_hand+v_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set returned_quantity=returned_quantity+v_quantity where id=v_allocation.id;
    v_next_status:='in_stock'; v_event:='returned';
  end if;

  insert into public.solar_inventory_movements(item_id,location_id,allocation_id,project_id,work_order_id,movement_type,quantity,on_hand_before,on_hand_after,reserved_before,reserved_after,reference,notes,performed_by)
  values(v_allocation.item_id,v_allocation.location_id,v_allocation.id,v_allocation.project_id,coalesce(p_work_order_id,v_allocation.work_order_id),p_action,v_quantity,v_on_hand_before,v_balance.on_hand,v_reserved_before,v_balance.reserved,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());

  for v_serial in select * from public.solar_inventory_serials where id=any(v_ids) for update loop
    update public.solar_inventory_serials set status=v_next_status,
      allocation_id=case when v_next_status='in_stock' then null else v_allocation.id end,
      project_id=case when v_next_status='in_stock' then null else v_allocation.project_id end,
      work_order_id=case when v_next_status='in_stock' then null else coalesce(p_work_order_id,v_allocation.work_order_id) end
    where id=v_serial.id;
    insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,location_id,allocation_id,project_id,work_order_id,reference,notes,actor_user_id)
    values(v_serial.id,v_event,v_serial.status,v_next_status,v_allocation.location_id,v_allocation.id,v_allocation.project_id,coalesce(p_work_order_id,v_allocation.work_order_id),nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
  end loop;
  perform public.refresh_solar_inventory_allocation_status(v_allocation.id);
  select * into v_allocation from public.solar_inventory_allocations where id=p_allocation_id;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(v_allocation.project_id,'inventory_serials_'||p_action,auth.uid(),jsonb_build_object('allocationId',v_allocation.id,'quantity',v_quantity,'serialIds',to_jsonb(v_ids)));
  return v_allocation;
end; $$;

create or replace function public.install_solar_project_serials(
  p_project_id uuid, p_serial_ids uuid[], p_work_order_id uuid default null, p_installed_at date default current_date,
  p_notes text default null
)
returns setof public.solar_inventory_serials language plpgsql security definer set search_path='' as $$
declare
  v_ids uuid[];
  v_serial public.solar_inventory_serials;
  v_item public.solar_inventory_items;
  v_asset public.solar_assets;
  v_asset_type text;
  v_count integer;
  v_item_count integer;
begin
  if not (public.is_solar_admin() or public.can_solar_project_action(p_project_id,'installation.execute')) then raise exception 'INSTALLATION_ACTION_DENIED'; end if;
  select array_agg(distinct value) into v_ids from unnest(coalesce(p_serial_ids,array[]::uuid[])) value;
  v_count:=coalesce(array_length(v_ids,1),0);
  if v_count=0 then raise exception 'SERIALS_REQUIRED'; end if;
  if p_work_order_id is not null and not exists(select 1 from public.solar_work_orders where id=p_work_order_id and project_id=p_project_id) then raise exception 'WORK_ORDER_PROJECT_MISMATCH'; end if;
  if p_installed_at>current_date then raise exception 'INSTALLATION_DATE_IN_FUTURE'; end if;

  for v_serial in select * from public.solar_inventory_serials where id=any(v_ids) for update loop
    if v_serial.project_id<>p_project_id or v_serial.status<>'issued' then raise exception 'SERIAL_NOT_ISSUED_TO_PROJECT'; end if;
    select * into v_item from public.solar_inventory_items where id=v_serial.item_id;
    v_asset_type:=case v_item.category when 'module' then 'module' when 'inverter' then 'inverter' when 'monitoring' then 'monitoring' when 'protection' then 'protection' when 'mounting' then 'structure' else 'other' end;
    select * into v_asset from public.solar_assets asset where asset.project_id=p_project_id and asset.asset_type=v_asset_type
      and (asset.metadata->>'inventoryItemId'=v_item.id::text or asset.metadata->>'catalogId'=coalesce(v_item.module_id,v_item.inverter_id)::text)
      order by asset.created_at limit 1;
    if v_asset.id is null then
      select count(*) into v_item_count from public.solar_inventory_serials where id=any(v_ids) and item_id=v_item.id;
      insert into public.solar_assets(project_id,asset_type,manufacturer,model,quantity,installed_at,status,metadata,created_by)
      values(p_project_id,v_asset_type,null,v_item.name,v_item_count,p_installed_at,'active',jsonb_build_object('inventoryItemId',v_item.id,'serialsPending',true),auth.uid()) returning * into v_asset;
    end if;
    update public.solar_inventory_serials set status='installed',asset_id=v_asset.id,work_order_id=coalesce(p_work_order_id,work_order_id),installed_at=p_installed_at where id=v_serial.id returning * into v_serial;
    insert into public.solar_inventory_serial_events(serial_id,event_type,previous_status,next_status,location_id,allocation_id,project_id,work_order_id,asset_id,notes,actor_user_id)
    values(v_serial.id,'installed','issued','installed',v_serial.location_id,v_serial.allocation_id,p_project_id,coalesce(p_work_order_id,v_serial.work_order_id),v_asset.id,nullif(trim(p_notes),''),auth.uid());
    if (select count(*) from public.solar_inventory_serials where asset_id=v_asset.id and status='installed')>=v_asset.quantity then
      update public.solar_assets set metadata=metadata||jsonb_build_object('serialsPending',false,'serializedInventory',true) where id=v_asset.id;
    end if;
    return next v_serial;
  end loop;
  if (select count(*) from public.solar_inventory_serials where id=any(v_ids) and status='installed')<>v_count then raise exception 'SERIAL_NOT_FOUND'; end if;
  insert into public.solar_project_events(project_id,event_name,actor_user_id,metadata)
  values(p_project_id,'inventory_serials_installed',auth.uid(),jsonb_build_object('quantity',v_count,'serialIds',to_jsonb(v_ids),'workOrderId',p_work_order_id,'installedAt',p_installed_at));
end; $$;

-- Aggregate stock movements cannot bypass serial identity once tracking is enabled.
create or replace function public.record_solar_inventory_stock(
  p_item_id uuid, p_location_id uuid, p_movement_type text, p_quantity numeric,
  p_unit_cost_before_vat_mxn numeric default null, p_reference text default null, p_notes text default null
)
returns public.solar_inventory_balances language plpgsql security definer set search_path='' as $$
declare v_balance public.solar_inventory_balances; v_before numeric; v_after numeric; v_serial_tracking boolean;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_movement_type not in ('receipt','adjustment_in','adjustment_out') then raise exception 'INVALID_STOCK_MOVEMENT'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  select serial_tracking into v_serial_tracking from public.solar_inventory_items where id=p_item_id;
  if coalesce(v_serial_tracking,false) then raise exception 'SERIALIZED_STOCK_REQUIRES_SERIES'; end if;
  insert into public.solar_inventory_balances(item_id,location_id) values(p_item_id,p_location_id) on conflict do nothing;
  select * into v_balance from public.solar_inventory_balances where item_id=p_item_id and location_id=p_location_id for update;
  v_before:=v_balance.on_hand;
  v_after:=v_before+case when p_movement_type in ('receipt','adjustment_in') then p_quantity else -p_quantity end;
  if v_after<v_balance.reserved then raise exception 'STOCK_BELOW_RESERVED'; end if;
  update public.solar_inventory_balances set on_hand=v_after,updated_at=now() where item_id=p_item_id and location_id=p_location_id returning * into v_balance;
  insert into public.solar_inventory_movements(item_id,location_id,movement_type,quantity,on_hand_before,on_hand_after,reserved_before,reserved_after,unit_cost_before_vat_mxn,reference,notes,performed_by)
  values(p_item_id,p_location_id,p_movement_type,p_quantity,v_before,v_after,v_balance.reserved,v_balance.reserved,p_unit_cost_before_vat_mxn,nullif(trim(p_reference),''),nullif(trim(p_notes),''),auth.uid());
  return v_balance;
end; $$;

-- Private copy of the pre-serialization quantity ledger logic.
create or replace function public.move_solar_project_material_unserialized(
  p_allocation_id uuid, p_action text, p_quantity numeric, p_work_order_id uuid default null,
  p_reference text default null, p_notes text default null
)
returns public.solar_inventory_allocations language plpgsql security definer set search_path='' as $$
declare v_allocation public.solar_inventory_allocations; v_balance public.solar_inventory_balances; v_on_hand_before numeric; v_reserved_before numeric; v_net_issued numeric;
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
  v_on_hand_before:=v_balance.on_hand; v_reserved_before:=v_balance.reserved;
  if p_action='reserve' then
    if p_quantity>v_balance.on_hand-v_balance.reserved then raise exception 'INSUFFICIENT_AVAILABLE_STOCK'; end if;
    if v_allocation.reserved_quantity+p_quantity+v_allocation.issued_quantity-v_allocation.returned_quantity>v_allocation.planned_quantity then raise exception 'RESERVATION_EXCEEDS_PLAN'; end if;
    update public.solar_inventory_balances set reserved=reserved+p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity+p_quantity where id=v_allocation.id;
  elsif p_action='release' then
    if p_quantity>v_allocation.reserved_quantity then raise exception 'RELEASE_EXCEEDS_RESERVATION'; end if;
    update public.solar_inventory_balances set reserved=reserved-p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity-p_quantity where id=v_allocation.id;
  elsif p_action='issue' then
    if p_quantity>v_allocation.reserved_quantity then raise exception 'ISSUE_REQUIRES_RESERVATION'; end if;
    update public.solar_inventory_balances set on_hand=on_hand-p_quantity,reserved=reserved-p_quantity,updated_at=now() where item_id=v_allocation.item_id and location_id=v_allocation.location_id returning * into v_balance;
    update public.solar_inventory_allocations set reserved_quantity=reserved_quantity-p_quantity,issued_quantity=issued_quantity+p_quantity,work_order_id=coalesce(p_work_order_id,work_order_id) where id=v_allocation.id;
  else
    v_net_issued:=v_allocation.issued_quantity-v_allocation.returned_quantity;
    if p_quantity>v_net_issued then raise exception 'RETURN_EXCEEDS_NET_ISSUED'; end if;
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

-- Ensure wrapper resolves after its private implementation is created.
create or replace function public.move_solar_project_material(
  p_allocation_id uuid, p_action text, p_quantity numeric, p_work_order_id uuid default null,
  p_reference text default null, p_notes text default null
)
returns public.solar_inventory_allocations language plpgsql security definer set search_path='' as $$
declare v_item_id uuid;
begin
  select item_id into v_item_id from public.solar_inventory_allocations where id=p_allocation_id;
  if exists(select 1 from public.solar_inventory_items where id=v_item_id and serial_tracking) then raise exception 'SERIAL_SELECTION_REQUIRED'; end if;
  return public.move_solar_project_material_unserialized(p_allocation_id,p_action,p_quantity,p_work_order_id,p_reference,p_notes);
end; $$;

create or replace function public.create_solar_inventory_item(p_data jsonb)
returns public.solar_inventory_items language plpgsql security definer set search_path='' as $$
declare v_item public.solar_inventory_items;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_data->>'sku'),'') is null or nullif(trim(p_data->>'name'),'') is null then raise exception 'ITEM_IDENTITY_REQUIRED'; end if;
  insert into public.solar_inventory_items(sku,name,category,unit,default_unit_cost_before_vat_mxn,reorder_point,serial_tracking,notes,created_by)
  values(upper(trim(p_data->>'sku')),trim(p_data->>'name'),coalesce(nullif(p_data->>'category',''),'other'),coalesce(nullif(p_data->>'unit',''),'piece'),
    nullif(p_data->>'unitCost','')::numeric,coalesce(nullif(p_data->>'reorderPoint','')::numeric,0),coalesce((p_data->>'serialTracking')::boolean,false),nullif(trim(p_data->>'notes'),''),auth.uid())
  returning * into v_item;
  return v_item;
end; $$;

alter table public.solar_inventory_serials enable row level security;
alter table public.solar_inventory_serial_events enable row level security;
create policy "staff read permitted inventory serials" on public.solar_inventory_serials for select to authenticated using (
  public.is_solar_admin() or (project_id is not null and public.can_access_solar_project(project_id)) or (project_id is null and public.has_solar_capability('inventory.workspace'))
);
create policy "staff read permitted serial events" on public.solar_inventory_serial_events for select to authenticated using (
  public.is_solar_admin() or (project_id is not null and public.can_access_solar_project(project_id)) or (project_id is null and public.has_solar_capability('inventory.workspace'))
);

grant select on public.solar_inventory_serials,public.solar_inventory_serial_events to authenticated;
grant usage,select on sequence public.solar_inventory_serial_events_id_seq to authenticated;
revoke insert,update,delete on public.solar_inventory_serials,public.solar_inventory_serial_events from authenticated;
revoke all on function public.receive_solar_serialized_stock(uuid,uuid,text[],numeric,text,text) from public;
revoke all on function public.identify_solar_inventory_serials(uuid,uuid,text[],text,text) from public;
revoke all on function public.move_solar_project_serials(uuid,text,uuid[],uuid,text,text) from public;
revoke all on function public.install_solar_project_serials(uuid,uuid[],uuid,date,text) from public;
revoke all on function public.move_solar_project_material_unserialized(uuid,text,numeric,uuid,text,text) from public;
revoke all on function public.enforce_solar_inventory_serial_tracking() from public;
grant execute on function public.receive_solar_serialized_stock(uuid,uuid,text[],numeric,text,text) to authenticated;
grant execute on function public.identify_solar_inventory_serials(uuid,uuid,text[],text,text) to authenticated;
grant execute on function public.move_solar_project_serials(uuid,text,uuid[],uuid,text,text) to authenticated;
grant execute on function public.install_solar_project_serials(uuid,uuid[],uuid,date,text) to authenticated;

comment on table public.solar_inventory_serials is 'Current identity and lifecycle state of each serialized unit from warehouse through installation.';
comment on table public.solar_inventory_serial_events is 'Immutable unit-level chain of custody for serialized solar equipment.';

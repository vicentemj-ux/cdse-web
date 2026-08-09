-- Keep project material quantities writable only through audited transactional RPCs.

drop policy if exists "admins manage project material allocations" on public.solar_inventory_allocations;
revoke insert, update, delete on public.solar_inventory_allocations from authenticated;

comment on table public.solar_inventory_allocations is
  'Planned, reserved, issued and returned project materials. Clients have read-only access; mutations require audited inventory RPCs.';

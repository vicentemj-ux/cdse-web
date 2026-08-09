-- CDSE Solar — auditable project costs, customer refunds and commission clawbacks.
-- This is operational control only; it does not replace bookkeeping or CFDI records.

create table public.solar_project_cost_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  cost_stage text not null check (cost_stage in ('budget', 'actual')),
  category text not null check (category in (
    'modules', 'inverter', 'structure', 'electrical', 'labor', 'engineering',
    'interconnection', 'travel', 'subcontractor', 'warranty', 'other'
  )),
  description text not null check (char_length(trim(description)) between 2 and 180),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_cost_before_vat_mxn numeric(14, 2) not null check (unit_cost_before_vat_mxn >= 0),
  amount_before_vat_mxn numeric(14, 2) generated always as (
    round(quantity * unit_cost_before_vat_mxn, 2)
  ) stored,
  vat_rate numeric(5, 4) not null default 0.16 check (vat_rate between 0 and 1),
  vat_amount_mxn numeric(14, 2) generated always as (
    round(quantity * unit_cost_before_vat_mxn * vat_rate, 2)
  ) stored,
  total_mxn numeric(14, 2) generated always as (
    round(quantity * unit_cost_before_vat_mxn * (1 + vat_rate), 2)
  ) stored,
  status text not null default 'approved' check (status in ('draft', 'approved', 'committed', 'paid', 'void')),
  incurred_at date,
  supplier text,
  reference text,
  notes text,
  void_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'void' or (voided_by is not null and voided_at is not null and nullif(trim(void_reason), '') is not null))
);

create index solar_project_cost_entries_project_stage_idx
  on public.solar_project_cost_entries (project_id, cost_stage, status, incurred_at);

create table public.solar_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.solar_payments(id) on delete restrict,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  amount_mxn numeric(14, 2) not null check (amount_mxn > 0),
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'pending' or (decided_by is not null and decided_at is not null)),
  check (status <> 'rejected' or nullif(trim(decision_reason), '') is not null)
);

create index solar_payment_refunds_payment_status_idx
  on public.solar_payment_refunds (payment_id, status, created_at desc);
create index solar_payment_refunds_project_status_idx
  on public.solar_payment_refunds (project_id, status, created_at desc);

alter table public.solar_commissions
  add column if not exists reversed_amount_mxn numeric(14, 2) not null default 0 check (reversed_amount_mxn >= 0),
  add column if not exists recovered_amount_mxn numeric(14, 2) not null default 0 check (recovered_amount_mxn >= 0),
  add column if not exists net_commission_mxn numeric(14, 2) generated always as (
    greatest(round(base_before_vat_mxn * rate_percent / 100, 2) + adjustment_mxn - reversed_amount_mxn, 0)
  ) stored,
  add column if not exists clawback_balance_mxn numeric(14, 2) generated always as (
    greatest(reversed_amount_mxn - recovered_amount_mxn, 0)
  ) stored,
  add constraint solar_commissions_recovery_not_above_reversal
    check (recovered_amount_mxn <= reversed_amount_mxn),
  add constraint solar_commissions_reversal_not_above_payable
    check (reversed_amount_mxn <= payable_amount_mxn);

alter table public.solar_commission_events
  drop constraint if exists solar_commission_events_event_type_check;
alter table public.solar_commission_events
  add constraint solar_commission_events_event_type_check check (event_type in (
    'created', 'terms_updated', 'milestone_earned', 'milestone_reversed',
    'approved', 'paid', 'voided', 'recovery_recorded'
  ));

create trigger solar_project_cost_entries_set_updated_at
before update on public.solar_project_cost_entries
for each row execute function public.set_updated_at();
create trigger solar_payment_refunds_set_updated_at
before update on public.solar_payment_refunds
for each row execute function public.set_updated_at();

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
      v_project.id, 'budget', 'modules', coalesce(v_module.name, 'Panel solar'), v_panels,
      v_module.unit_cost_mxn, v_project.vat_rate, 'approved', v_project.created_by, v_project.created_by, now()
    );
  end if;
  if coalesce(v_inverter.unit_cost_mxn, 0) > 0 then
    insert into public.solar_project_cost_entries (
      project_id, cost_stage, category, description, quantity, unit_cost_before_vat_mxn,
      vat_rate, status, created_by, approved_by, approved_at
    ) values (
      v_project.id, 'budget', 'inverter', coalesce(v_inverter.name, 'Inversor'), v_inverters,
      v_inverter.unit_cost_mxn, v_project.vat_rate, 'approved', v_project.created_by, v_project.created_by, now()
    );
  end if;
end;
$$;

create or replace function public.seed_solar_project_cost_budget_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.seed_solar_project_cost_budget(new.id); return new; end; $$;

create trigger solar_projects_seed_cost_budget
after insert on public.solar_projects
for each row execute function public.seed_solar_project_cost_budget_trigger();

do $$ declare v_project_id uuid;
begin
  for v_project_id in select id from public.solar_projects loop
    perform public.seed_solar_project_cost_budget(v_project_id);
  end loop;
end $$;

create or replace function public.add_solar_project_cost(
  p_project_id uuid, p_cost_stage text, p_category text, p_description text,
  p_quantity numeric, p_unit_cost_before_vat_mxn numeric, p_vat_rate numeric,
  p_status text default 'approved', p_incurred_at date default null,
  p_supplier text default null, p_reference text default null, p_notes text default null
)
returns public.solar_project_cost_entries
language plpgsql security definer set search_path = '' as $$
declare v_cost public.solar_project_cost_entries;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_cost_stage not in ('budget', 'actual') then raise exception 'COST_STAGE_INVALID'; end if;
  if p_status not in ('draft', 'approved', 'committed', 'paid') then raise exception 'COST_STATUS_INVALID'; end if;
  if p_quantity <= 0 or p_unit_cost_before_vat_mxn < 0 then raise exception 'COST_AMOUNT_INVALID'; end if;
  insert into public.solar_project_cost_entries (
    project_id, cost_stage, category, description, quantity, unit_cost_before_vat_mxn,
    vat_rate, status, incurred_at, supplier, reference, notes, created_by, approved_by, approved_at
  ) values (
    p_project_id, p_cost_stage, p_category, trim(p_description), p_quantity,
    p_unit_cost_before_vat_mxn, p_vat_rate, p_status, p_incurred_at,
    nullif(trim(p_supplier), ''), nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid(),
    case when p_status in ('approved', 'committed', 'paid') then auth.uid() else null end,
    case when p_status in ('approved', 'committed', 'paid') then now() else null end
  ) returning * into v_cost;
  insert into public.solar_project_events(project_id, event_name, actor_user_id, metadata)
  values (p_project_id, 'project_cost_added', auth.uid(), jsonb_build_object('costId', v_cost.id, 'stage', v_cost.cost_stage, 'amountBeforeVatMxn', v_cost.amount_before_vat_mxn));
  return v_cost;
end; $$;

create or replace function public.void_solar_project_cost(p_cost_id uuid, p_reason text)
returns public.solar_project_cost_entries
language plpgsql security definer set search_path = '' as $$
declare v_cost public.solar_project_cost_entries;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'VOID_REASON_REQUIRED'; end if;
  update public.solar_project_cost_entries set status = 'void', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_cost_id and status <> 'void' returning * into v_cost;
  if v_cost.id is null then raise exception 'ACTIVE_COST_REQUIRED'; end if;
  insert into public.solar_project_events(project_id, event_name, actor_user_id, metadata)
  values (v_cost.project_id, 'project_cost_voided', auth.uid(), jsonb_build_object('costId', v_cost.id, 'reason', p_reason));
  return v_cost;
end; $$;

create or replace function public.request_solar_payment_refund(
  p_payment_id uuid, p_amount_mxn numeric, p_reason text, p_reference text default null
)
returns public.solar_payment_refunds
language plpgsql security definer set search_path = '' as $$
declare v_payment public.solar_payments; v_reserved numeric; v_refund public.solar_payment_refunds;
begin
  select * into v_payment from public.solar_payments where id = p_payment_id;
  if v_payment.id is null or not public.can_access_solar_project(v_payment.project_id) then raise exception 'PAYMENT_ACCESS_DENIED'; end if;
  if v_payment.status not in ('reconciled', 'refunded') then raise exception 'RECONCILED_PAYMENT_REQUIRED'; end if;
  if p_amount_mxn <= 0 or nullif(trim(p_reason), '') is null then raise exception 'REFUND_DATA_INVALID'; end if;
  select coalesce(sum(amount_mxn), 0) into v_reserved from public.solar_payment_refunds
  where payment_id = p_payment_id and status in ('pending', 'approved');
  if v_reserved + p_amount_mxn > v_payment.amount_mxn then raise exception 'REFUND_EXCEEDS_PAYMENT'; end if;
  insert into public.solar_payment_refunds(payment_id, project_id, amount_mxn, reason, reference, requested_by)
  values (p_payment_id, v_payment.project_id, round(p_amount_mxn, 2), trim(p_reason), nullif(trim(p_reference), ''), auth.uid())
  returning * into v_refund;
  insert into public.solar_project_events(project_id, event_name, actor_user_id, metadata)
  values (v_payment.project_id, 'payment_refund_requested', auth.uid(), jsonb_build_object('refundId', v_refund.id, 'paymentId', p_payment_id, 'amountMxn', v_refund.amount_mxn));
  return v_refund;
end; $$;

create or replace function public.decide_solar_payment_refund(
  p_refund_id uuid, p_decision text, p_decision_reason text default null, p_reference text default null
)
returns public.solar_payment_refunds
language plpgsql security definer set search_path = '' as $$
declare v_refund public.solar_payment_refunds; v_payment public.solar_payments; v_approved numeric;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'REFUND_DECISION_INVALID'; end if;
  if p_decision = 'rejected' and nullif(trim(p_decision_reason), '') is null then raise exception 'DECISION_REASON_REQUIRED'; end if;
  update public.solar_payment_refunds set status = p_decision, decided_by = auth.uid(), decided_at = now(),
    decision_reason = nullif(trim(p_decision_reason), ''), reference = coalesce(nullif(trim(p_reference), ''), reference)
  where id = p_refund_id and status = 'pending' returning * into v_refund;
  if v_refund.id is null then raise exception 'PENDING_REFUND_REQUIRED'; end if;
  select * into v_payment from public.solar_payments where id = v_refund.payment_id;
  if p_decision = 'approved' then
    select coalesce(sum(amount_mxn), 0) into v_approved from public.solar_payment_refunds where payment_id = v_payment.id and status = 'approved';
    if v_approved >= v_payment.amount_mxn then
      update public.solar_payments set status = 'refunded', refunded_by = auth.uid(), refunded_at = now(), refund_reason = v_refund.reason where id = v_payment.id;
    end if;
    if v_payment.schedule_id is not null then perform public.refresh_solar_payment_schedule(v_payment.schedule_id); end if;
  end if;
  insert into public.solar_project_events(project_id, event_name, actor_user_id, metadata)
  values (v_refund.project_id, 'payment_refund_' || p_decision, auth.uid(), jsonb_build_object('refundId', v_refund.id, 'amountMxn', v_refund.amount_mxn, 'reason', p_decision_reason));
  return v_refund;
end; $$;

create or replace function public.refresh_solar_payment_schedule(p_schedule_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_paid numeric; v_amount numeric; v_due date;
begin
  select amount_mxn, due_at into v_amount, v_due from public.solar_payment_schedules where id = p_schedule_id;
  select coalesce(sum(payment.amount_mxn), 0) - coalesce((
    select sum(refund.amount_mxn) from public.solar_payment_refunds refund
    join public.solar_payments refunded_payment on refunded_payment.id = refund.payment_id
    where refunded_payment.schedule_id = p_schedule_id and refund.status = 'approved'
  ), 0) into v_paid
  from public.solar_payments payment where payment.schedule_id = p_schedule_id and payment.status in ('reconciled', 'refunded');
  v_paid := greatest(v_paid, 0);
  update public.solar_payment_schedules set paid_amount_mxn = v_paid,
    status = case when v_paid >= v_amount then 'paid' when v_paid > 0 then 'partially_paid'
      when v_due is not null and v_due < current_date then 'overdue' else 'pending' end
  where id = p_schedule_id and status not in ('waived', 'cancelled');
end; $$;

create or replace function public.reverse_solar_commission_milestone(
  p_commission_id uuid, p_milestone_code text, p_reason text
)
returns public.solar_commissions
language plpgsql security definer set search_path = '' as $$
declare v_commission public.solar_commissions; v_milestone public.solar_commission_milestones; v_earned numeric; v_reversal numeric;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'REVERSAL_REASON_REQUIRED'; end if;
  select * into v_commission from public.solar_commissions where id = p_commission_id;
  select * into v_milestone from public.solar_commission_milestones
    where commission_id = p_commission_id and milestone_code = p_milestone_code and status = 'earned';
  if v_commission.id is null or v_milestone.id is null then raise exception 'EARNED_MILESTONE_REQUIRED'; end if;
  v_reversal := round(v_commission.payable_amount_mxn * v_milestone.weight_percent / 100, 2);
  update public.solar_commission_milestones set status = 'reversed', reversal_reason = trim(p_reason) where id = v_milestone.id;
  select coalesce(sum(weight_percent), 0) into v_earned from public.solar_commission_milestones where commission_id = p_commission_id and status = 'earned';
  update public.solar_commissions set reversed_amount_mxn = least(reversed_amount_mxn + v_reversal, payable_amount_mxn),
    earned_percent = least(v_earned, 100),
    status = case when status = 'paid' then 'paid' when v_earned >= 100 then 'earned' when v_earned > 0 then 'partially_earned' else 'estimated' end,
    approved_by = case when status = 'paid' then approved_by else null end,
    approved_at = case when status = 'paid' then approved_at else null end
  where id = p_commission_id returning * into v_commission;
  insert into public.solar_commission_events(commission_id, project_id, event_type, amount_mxn, reason, metadata, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'milestone_reversed', -v_reversal, trim(p_reason),
    jsonb_build_object('milestoneCode', p_milestone_code, 'earnedPercent', v_earned, 'clawbackBalanceMxn', v_commission.clawback_balance_mxn), auth.uid());
  return v_commission;
end; $$;

create or replace function public.record_solar_commission_recovery(
  p_commission_id uuid, p_amount_mxn numeric, p_reference text, p_reason text default null
)
returns public.solar_commissions
language plpgsql security definer set search_path = '' as $$
declare v_commission public.solar_commissions;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_commission from public.solar_commissions where id = p_commission_id;
  if v_commission.id is null or v_commission.status <> 'paid' or p_amount_mxn <= 0 or p_amount_mxn > v_commission.clawback_balance_mxn then raise exception 'RECOVERY_AMOUNT_INVALID'; end if;
  if nullif(trim(p_reference), '') is null then raise exception 'RECOVERY_REFERENCE_REQUIRED'; end if;
  update public.solar_commissions set recovered_amount_mxn = recovered_amount_mxn + round(p_amount_mxn, 2)
  where id = p_commission_id returning * into v_commission;
  insert into public.solar_commission_events(commission_id, project_id, event_type, amount_mxn, reason, metadata, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'recovery_recorded', p_amount_mxn, nullif(trim(p_reason), ''),
    jsonb_build_object('reference', trim(p_reference), 'remainingClawbackMxn', v_commission.clawback_balance_mxn), auth.uid());
  return v_commission;
end; $$;

create or replace function public.confirm_solar_commission_milestone(
  p_commission_id uuid, p_milestone_code text
)
returns public.solar_commissions
language plpgsql security definer set search_path = '' as $$
declare
  v_commission public.solar_commissions;
  v_milestone public.solar_commission_milestones;
  v_earned numeric;
  v_restored numeric := 0;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_commission from public.solar_commissions where id = p_commission_id;
  select * into v_milestone from public.solar_commission_milestones
    where commission_id = p_commission_id and milestone_code = p_milestone_code;
  if v_commission.id is null or v_commission.status in ('paid', 'void') then raise exception 'ACTIVE_COMMISSION_REQUIRED'; end if;
  if v_milestone.id is null or v_milestone.status = 'earned' then raise exception 'PENDING_MILESTONE_REQUIRED'; end if;
  if p_milestone_code = 'deposit_reconciled' and not exists (
    select 1 from public.solar_payments where project_id = v_commission.project_id and status in ('reconciled', 'refunded')
  ) then raise exception 'RECONCILED_PAYMENT_REQUIRED'; end if;
  if p_milestone_code = 'handover_completed' and not exists (
    select 1 from public.solar_project_documents where project_id = v_commission.project_id and document_code = 'handover_certificate' and status = 'approved'
  ) then raise exception 'APPROVED_HANDOVER_REQUIRED'; end if;
  if v_milestone.status = 'reversed' then
    v_restored := round(v_commission.payable_amount_mxn * v_milestone.weight_percent / 100, 2);
  end if;
  update public.solar_commission_milestones set status = 'earned', earned_at = now(), earned_by = auth.uid(), reversal_reason = null where id = v_milestone.id;
  select coalesce(sum(weight_percent), 0) into v_earned from public.solar_commission_milestones where commission_id = p_commission_id and status = 'earned';
  update public.solar_commissions set earned_percent = least(v_earned, 100), reversed_amount_mxn = greatest(reversed_amount_mxn - v_restored, 0),
    status = case when v_earned >= 100 then 'earned' else 'partially_earned' end
  where id = p_commission_id returning * into v_commission;
  insert into public.solar_commission_events(commission_id, project_id, event_type, amount_mxn, metadata, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'milestone_earned', round(v_commission.payable_amount_mxn * v_earned / 100, 2),
    jsonb_build_object('milestoneCode', p_milestone_code, 'earnedPercent', v_earned, 'restoredReversalMxn', v_restored), auth.uid());
  return v_commission;
end; $$;

alter table public.solar_project_cost_entries enable row level security;
alter table public.solar_payment_refunds enable row level security;

create policy "admins read project costs" on public.solar_project_cost_entries for select to authenticated
using ((select public.is_solar_admin()));
create policy "admins manage project costs" on public.solar_project_cost_entries for all to authenticated
using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));
create policy "members read project refunds" on public.solar_payment_refunds for select to authenticated
using ((select public.can_access_solar_project(project_id)));
create policy "members request project refunds" on public.solar_payment_refunds for insert to authenticated
with check ((select public.can_access_solar_project(project_id)) and requested_by = (select auth.uid()) and status = 'pending');
create policy "admins manage project refunds" on public.solar_payment_refunds for all to authenticated
using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));

grant select, insert, update on public.solar_project_cost_entries, public.solar_payment_refunds to authenticated;
revoke all on function public.seed_solar_project_cost_budget(uuid) from public;
revoke all on function public.add_solar_project_cost(uuid, text, text, text, numeric, numeric, numeric, text, date, text, text, text) from public;
revoke all on function public.void_solar_project_cost(uuid, text) from public;
revoke all on function public.request_solar_payment_refund(uuid, numeric, text, text) from public;
revoke all on function public.decide_solar_payment_refund(uuid, text, text, text) from public;
revoke all on function public.reverse_solar_commission_milestone(uuid, text, text) from public;
revoke all on function public.record_solar_commission_recovery(uuid, numeric, text, text) from public;
grant execute on function public.add_solar_project_cost(uuid, text, text, text, numeric, numeric, numeric, text, date, text, text, text) to authenticated;
grant execute on function public.void_solar_project_cost(uuid, text) to authenticated;
grant execute on function public.request_solar_payment_refund(uuid, numeric, text, text) to authenticated;
grant execute on function public.decide_solar_payment_refund(uuid, text, text, text) to authenticated;
grant execute on function public.reverse_solar_commission_milestone(uuid, text, text) to authenticated;
grant execute on function public.record_solar_commission_recovery(uuid, numeric, text, text) to authenticated;

comment on table public.solar_project_cost_entries is 'Budget and actual project costs before VAT for operational margin control; not an accounting ledger.';
comment on table public.solar_payment_refunds is 'Append-only customer refund requests and administrative decisions linked to original reconciled payments.';

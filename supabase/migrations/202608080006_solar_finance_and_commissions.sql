-- CDSE Solar — project collections and auditable seller commissions.
-- Customer collections are tracked with VAT; commissions remain based on the
-- accepted amount before VAT and are only paid after milestone + admin review.

create table public.solar_payment_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  payment_type text not null check (payment_type in (
    'deposit', 'financing_settlement', 'full_payment', 'progress', 'final', 'other'
  )),
  label text not null check (char_length(label) between 2 and 120),
  amount_mxn numeric(14, 2) not null check (amount_mxn >= 0),
  due_at date,
  status text not null default 'pending' check (status in (
    'pending', 'partially_paid', 'paid', 'overdue', 'waived', 'cancelled'
  )),
  paid_amount_mxn numeric(14, 2) not null default 0 check (paid_amount_mxn >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence)
);

create index solar_payment_schedules_project_status_idx
  on public.solar_payment_schedules (project_id, status, sequence);

create table public.solar_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  schedule_id uuid references public.solar_payment_schedules(id) on delete set null,
  amount_mxn numeric(14, 2) not null check (amount_mxn > 0),
  received_at timestamptz not null,
  payment_method text not null check (payment_method in (
    'transfer', 'cash', 'card', 'check', 'financing', 'other'
  )),
  reference text,
  notes text,
  status text not null default 'pending' check (status in (
    'pending', 'reconciled', 'rejected', 'refunded'
  )),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  reconciled_by uuid references auth.users(id) on delete set null,
  reconciled_at timestamptz,
  decision_reason text,
  refunded_by uuid references auth.users(id) on delete set null,
  refunded_at timestamptz,
  refund_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'reconciled' or (reconciled_by is not null and reconciled_at is not null)),
  check (status <> 'rejected' or nullif(trim(decision_reason), '') is not null),
  check (status <> 'refunded' or (refunded_by is not null and refunded_at is not null and nullif(trim(refund_reason), '') is not null))
);

create index solar_payments_project_status_idx
  on public.solar_payments (project_id, status, received_at desc);

create table public.solar_commission_milestones (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.solar_commissions(id) on delete cascade,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  milestone_code text not null check (milestone_code in (
    'deposit_reconciled', 'handover_completed'
  )),
  label text not null,
  weight_percent numeric(5, 2) not null check (weight_percent > 0 and weight_percent <= 100),
  status text not null default 'pending' check (status in ('pending', 'earned', 'reversed')),
  earned_at timestamptz,
  earned_by uuid references auth.users(id) on delete set null,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commission_id, milestone_code)
);

create table public.solar_commission_events (
  id bigint generated always as identity primary key,
  commission_id uuid not null references public.solar_commissions(id) on delete restrict,
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  event_type text not null check (event_type in (
    'created', 'terms_updated', 'milestone_earned', 'milestone_reversed',
    'approved', 'paid', 'voided'
  )),
  amount_mxn numeric(14, 2),
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index solar_commission_events_commission_created_idx
  on public.solar_commission_events (commission_id, created_at desc);

alter table public.solar_commissions
  add column if not exists self_approval_reason text,
  add column if not exists payroll_reference text;

create trigger solar_payment_schedules_set_updated_at
before update on public.solar_payment_schedules
for each row execute function public.set_updated_at();

create trigger solar_payments_set_updated_at
before update on public.solar_payments
for each row execute function public.set_updated_at();

create trigger solar_commission_milestones_set_updated_at
before update on public.solar_commission_milestones
for each row execute function public.set_updated_at();

create or replace function public.seed_solar_commission_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.solar_commission_milestones (
    commission_id, project_id, milestone_code, label, weight_percent
  ) values
    (new.id, new.project_id, 'deposit_reconciled', 'Anticipo conciliado y venta firme', 50),
    (new.id, new.project_id, 'handover_completed', 'Instalación y acta de entrega aprobada', 50)
  on conflict do nothing;

  insert into public.solar_commission_events (
    commission_id, project_id, event_type, amount_mxn, actor_user_id,
    metadata
  ) values (
    new.id, new.project_id, 'created', new.payable_amount_mxn, auth.uid(),
    jsonb_build_object('baseBeforeVatMxn', new.base_before_vat_mxn, 'ratePercent', new.rate_percent)
  );
  return new;
end;
$$;

create trigger solar_commissions_seed_milestones
after insert on public.solar_commissions
for each row execute function public.seed_solar_commission_milestones();

insert into public.solar_commission_milestones (
  commission_id, project_id, milestone_code, label, weight_percent
)
select commission.id, commission.project_id, seed.code, seed.label, 50
from public.solar_commissions commission
cross join (values
  ('deposit_reconciled', 'Anticipo conciliado y venta firme'),
  ('handover_completed', 'Instalación y acta de entrega aprobada')
) as seed(code, label)
on conflict do nothing;

create or replace function public.seed_solar_project_payment_schedule(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.solar_projects;
  v_financing jsonb;
  v_down numeric;
begin
  select * into v_project from public.solar_projects where id = p_project_id;
  if v_project.id is null or exists (
    select 1 from public.solar_payment_schedules where project_id = p_project_id
  ) then return; end if;

  v_financing := v_project.sold_scope_snapshot #> '{results,financing}';
  v_down := coalesce(nullif(v_financing->>'downPaymentMxn', '')::numeric, 0);

  if v_financing is not null and v_down > 0 and v_down < v_project.agreed_total_mxn then
    insert into public.solar_payment_schedules (
      project_id, sequence, payment_type, label, amount_mxn, due_at, created_by
    ) values
      (v_project.id, 1, 'deposit', 'Enganche del proyecto', v_down, v_project.accepted_at::date, v_project.created_by),
      (v_project.id, 2, 'financing_settlement', 'Liquidación por financiamiento', v_project.agreed_total_mxn - v_down, null, v_project.created_by);
  else
    insert into public.solar_payment_schedules (
      project_id, sequence, payment_type, label, amount_mxn, due_at, created_by
    ) values (
      v_project.id, 1, 'full_payment', 'Pago total del proyecto', v_project.agreed_total_mxn,
      v_project.accepted_at::date, v_project.created_by
    );
  end if;
end;
$$;

create or replace function public.seed_solar_project_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_solar_project_payment_schedule(new.id);
  return new;
end;
$$;

create trigger solar_projects_seed_finance
after insert on public.solar_projects
for each row execute function public.seed_solar_project_finance();

do $$
declare v_project_id uuid;
begin
  for v_project_id in select id from public.solar_projects loop
    perform public.seed_solar_project_payment_schedule(v_project_id);
  end loop;
end;
$$;

create or replace function public.refresh_solar_payment_schedule(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_paid numeric; v_amount numeric; v_due date;
begin
  select amount_mxn, due_at into v_amount, v_due
  from public.solar_payment_schedules where id = p_schedule_id;
  select coalesce(sum(amount_mxn), 0) into v_paid
  from public.solar_payments
  where schedule_id = p_schedule_id and status = 'reconciled';
  update public.solar_payment_schedules
  set paid_amount_mxn = v_paid,
      status = case
        when v_paid >= v_amount then 'paid'
        when v_paid > 0 then 'partially_paid'
        when v_due is not null and v_due < current_date then 'overdue'
        else 'pending'
      end
  where id = p_schedule_id and status not in ('waived', 'cancelled');
end;
$$;

create or replace function public.record_solar_payment(
  p_project_id uuid,
  p_schedule_id uuid,
  p_amount_mxn numeric,
  p_received_at timestamptz,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
)
returns public.solar_payments
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.solar_payments;
begin
  if not public.can_access_solar_project(p_project_id) then raise exception 'PROJECT_ACCESS_DENIED'; end if;
  if p_amount_mxn <= 0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;
  if p_schedule_id is not null and not exists (
    select 1 from public.solar_payment_schedules where id = p_schedule_id and project_id = p_project_id
  ) then raise exception 'PAYMENT_SCHEDULE_INVALID'; end if;

  insert into public.solar_payments (
    project_id, schedule_id, amount_mxn, received_at, payment_method,
    reference, notes, recorded_by
  ) values (
    p_project_id, p_schedule_id, round(p_amount_mxn, 2), p_received_at,
    p_payment_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid()
  ) returning * into v_payment;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (p_project_id, 'payment_recorded_pending_reconciliation', auth.uid(),
    jsonb_build_object('paymentId', v_payment.id, 'amountMxn', v_payment.amount_mxn));
  return v_payment;
end;
$$;

create or replace function public.decide_solar_payment(
  p_payment_id uuid,
  p_decision text,
  p_reason text default null
)
returns public.solar_payments
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.solar_payments;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_decision not in ('reconciled', 'rejected') then raise exception 'PAYMENT_DECISION_INVALID'; end if;
  if p_decision = 'rejected' and nullif(trim(p_reason), '') is null then raise exception 'REJECTION_REASON_REQUIRED'; end if;

  update public.solar_payments set
    status = p_decision,
    reconciled_by = case when p_decision = 'reconciled' then auth.uid() else null end,
    reconciled_at = case when p_decision = 'reconciled' then now() else null end,
    decision_reason = nullif(trim(p_reason), '')
  where id = p_payment_id and status = 'pending'
  returning * into v_payment;
  if v_payment.id is null then raise exception 'PENDING_PAYMENT_REQUIRED'; end if;

  if v_payment.schedule_id is not null then perform public.refresh_solar_payment_schedule(v_payment.schedule_id); end if;
  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (v_payment.project_id, 'payment_' || p_decision, auth.uid(),
    jsonb_build_object('paymentId', v_payment.id, 'amountMxn', v_payment.amount_mxn, 'reason', p_reason));
  return v_payment;
end;
$$;

create or replace function public.update_solar_commission_terms(
  p_commission_id uuid,
  p_rate_percent numeric,
  p_adjustment_mxn numeric default 0,
  p_reason text default null
)
returns public.solar_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare v_commission public.solar_commissions;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_rate_percent < 0 or p_rate_percent > 10 then raise exception 'COMMISSION_RATE_OUT_OF_RANGE'; end if;
  if p_adjustment_mxn <> 0 and nullif(trim(p_reason), '') is null then raise exception 'ADJUSTMENT_REASON_REQUIRED'; end if;

  update public.solar_commissions set
    rate_percent = p_rate_percent,
    adjustment_mxn = p_adjustment_mxn,
    adjustment_reason = case when p_adjustment_mxn = 0 then null else trim(p_reason) end,
    requires_review = p_rate_percent < 5 or p_rate_percent > 10,
    status = case when status in ('approved', 'paid', 'void') then status when earned_percent = 100 then 'earned' when earned_percent > 0 then 'partially_earned' else 'estimated' end
  where id = p_commission_id and status not in ('paid', 'void')
  returning * into v_commission;
  if v_commission.id is null then raise exception 'EDITABLE_COMMISSION_REQUIRED'; end if;

  insert into public.solar_commission_events (commission_id, project_id, event_type, amount_mxn, reason, metadata, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'terms_updated', v_commission.payable_amount_mxn, p_reason,
    jsonb_build_object('ratePercent', v_commission.rate_percent, 'adjustmentMxn', v_commission.adjustment_mxn), auth.uid());
  return v_commission;
end;
$$;

create or replace function public.confirm_solar_commission_milestone(
  p_commission_id uuid,
  p_milestone_code text
)
returns public.solar_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare v_commission public.solar_commissions; v_earned numeric;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_commission from public.solar_commissions where id = p_commission_id;
  if v_commission.id is null or v_commission.status in ('paid', 'void') then raise exception 'ACTIVE_COMMISSION_REQUIRED'; end if;

  if p_milestone_code = 'deposit_reconciled' and not exists (
    select 1 from public.solar_payments where project_id = v_commission.project_id and status = 'reconciled'
  ) then raise exception 'RECONCILED_PAYMENT_REQUIRED'; end if;
  if p_milestone_code = 'handover_completed' and not exists (
    select 1 from public.solar_project_documents
    where project_id = v_commission.project_id and document_code = 'handover_certificate' and status = 'approved'
  ) then raise exception 'APPROVED_HANDOVER_REQUIRED'; end if;

  update public.solar_commission_milestones set status = 'earned', earned_at = now(), earned_by = auth.uid(), reversal_reason = null
  where commission_id = p_commission_id and milestone_code = p_milestone_code and status <> 'earned';
  if not found then raise exception 'PENDING_MILESTONE_REQUIRED'; end if;

  select coalesce(sum(weight_percent), 0) into v_earned
  from public.solar_commission_milestones where commission_id = p_commission_id and status = 'earned';
  update public.solar_commissions set earned_percent = least(v_earned, 100), status = case when v_earned >= 100 then 'earned' else 'partially_earned' end
  where id = p_commission_id returning * into v_commission;

  insert into public.solar_commission_events (commission_id, project_id, event_type, amount_mxn, metadata, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'milestone_earned', round(v_commission.payable_amount_mxn * v_earned / 100, 2),
    jsonb_build_object('milestoneCode', p_milestone_code, 'earnedPercent', v_earned), auth.uid());
  return v_commission;
end;
$$;

create or replace function public.approve_solar_commission(
  p_commission_id uuid,
  p_self_approval_reason text default null
)
returns public.solar_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare v_commission public.solar_commissions;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_commission from public.solar_commissions where id = p_commission_id;
  if v_commission.id is null or v_commission.status <> 'earned' or v_commission.earned_percent <> 100 then raise exception 'FULLY_EARNED_COMMISSION_REQUIRED'; end if;
  if v_commission.rate_percent < 5 or v_commission.rate_percent > 10 or v_commission.requires_review then raise exception 'COMMISSION_POLICY_REVIEW_REQUIRED'; end if;
  if v_commission.seller_user_id = auth.uid() and nullif(trim(p_self_approval_reason), '') is null then raise exception 'SELF_APPROVAL_REASON_REQUIRED'; end if;

  update public.solar_commissions set status = 'approved', approved_by = auth.uid(), approved_at = now(),
    self_approval_reason = case when seller_user_id = auth.uid() then trim(p_self_approval_reason) else null end
  where id = p_commission_id returning * into v_commission;
  insert into public.solar_commission_events (commission_id, project_id, event_type, amount_mxn, reason, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'approved', v_commission.payable_amount_mxn, v_commission.self_approval_reason, auth.uid());
  return v_commission;
end;
$$;

create or replace function public.pay_solar_commission(
  p_commission_id uuid,
  p_payment_reference text,
  p_payroll_reference text default null
)
returns public.solar_commissions
language plpgsql
security definer
set search_path = ''
as $$
declare v_commission public.solar_commissions;
begin
  if not public.is_solar_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if nullif(trim(p_payment_reference), '') is null then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
  update public.solar_commissions set status = 'paid', paid_by = auth.uid(), paid_at = now(),
    payment_reference = trim(p_payment_reference), payroll_reference = nullif(trim(p_payroll_reference), '')
  where id = p_commission_id and status = 'approved'
  returning * into v_commission;
  if v_commission.id is null then raise exception 'APPROVED_COMMISSION_REQUIRED'; end if;
  insert into public.solar_commission_events (commission_id, project_id, event_type, amount_mxn, metadata, actor_user_id)
  values (v_commission.id, v_commission.project_id, 'paid', v_commission.payable_amount_mxn,
    jsonb_build_object('paymentReference', v_commission.payment_reference, 'payrollReference', v_commission.payroll_reference), auth.uid());
  return v_commission;
end;
$$;

alter table public.solar_payment_schedules enable row level security;
alter table public.solar_payments enable row level security;
alter table public.solar_commission_milestones enable row level security;
alter table public.solar_commission_events enable row level security;

create policy "members read payment schedules" on public.solar_payment_schedules for select to authenticated
using ((select public.can_access_solar_project(project_id)));
create policy "admins manage payment schedules" on public.solar_payment_schedules for all to authenticated
using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));

create policy "members read project payments" on public.solar_payments for select to authenticated
using ((select public.can_access_solar_project(project_id)));
create policy "members record pending payments" on public.solar_payments for insert to authenticated
with check ((select public.can_access_solar_project(project_id)) and recorded_by = (select auth.uid()) and status = 'pending');
create policy "admins manage payments" on public.solar_payments for all to authenticated
using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));

create policy "seller reads own commission milestones" on public.solar_commission_milestones for select to authenticated
using ((select public.is_solar_admin()) or exists (
  select 1 from public.solar_commissions commission where commission.id = commission_id and commission.seller_user_id = (select auth.uid())
));
create policy "admins manage commission milestones" on public.solar_commission_milestones for all to authenticated
using ((select public.is_solar_admin())) with check ((select public.is_solar_admin()));

create policy "seller reads own commission events" on public.solar_commission_events for select to authenticated
using ((select public.is_solar_admin()) or exists (
  select 1 from public.solar_commissions commission where commission.id = commission_id and commission.seller_user_id = (select auth.uid())
));
create policy "admins add commission events" on public.solar_commission_events for insert to authenticated
with check ((select public.is_solar_admin()));

grant select, insert, update, delete on public.solar_payment_schedules, public.solar_payments,
  public.solar_commission_milestones, public.solar_commission_events to authenticated;
grant usage, select on sequence public.solar_commission_events_id_seq to authenticated;

revoke all on function public.seed_solar_project_payment_schedule(uuid) from public;
revoke all on function public.refresh_solar_payment_schedule(uuid) from public;
revoke all on function public.record_solar_payment(uuid, uuid, numeric, timestamptz, text, text, text) from public;
revoke all on function public.decide_solar_payment(uuid, text, text) from public;
revoke all on function public.update_solar_commission_terms(uuid, numeric, numeric, text) from public;
revoke all on function public.confirm_solar_commission_milestone(uuid, text) from public;
revoke all on function public.approve_solar_commission(uuid, text) from public;
revoke all on function public.pay_solar_commission(uuid, text, text) from public;

grant execute on function public.record_solar_payment(uuid, uuid, numeric, timestamptz, text, text, text) to authenticated;
grant execute on function public.decide_solar_payment(uuid, text, text) to authenticated;
grant execute on function public.update_solar_commission_terms(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.confirm_solar_commission_milestone(uuid, text) to authenticated;
grant execute on function public.approve_solar_commission(uuid, text) to authenticated;
grant execute on function public.pay_solar_commission(uuid, text, text) to authenticated;

comment on table public.solar_payment_schedules is 'Expected customer collections, always tracked with VAT when applicable.';
comment on table public.solar_payments is 'Payment evidence pending or completed administrative reconciliation; not a CFDI substitute.';
comment on table public.solar_commission_events is 'Append-only audit history for seller commission calculation, approval and payment.';

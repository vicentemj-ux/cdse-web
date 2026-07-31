-- CDSE Solar — private sales portal, seller ownership, catalog pricing,
-- promotions, packages and commission tracking.

create type public.solar_staff_role as enum ('admin', 'seller');
create type public.solar_discount_type as enum ('percentage', 'fixed', 'per_panel');
create type public.solar_system_type as enum ('interconnection', 'hybrid', 'off_grid');

create table public.solar_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone_e164 text,
  role public.solar_staff_role not null default 'seller',
  active boolean not null default true,
  commission_rate numeric(5, 2) not null default 0
    check (commission_rate between 0 and 100),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create table public.solar_price_options (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.solar_modules(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  price_per_panel_mxn numeric(12, 2) not null check (price_per_panel_mxn > 0),
  min_panels integer not null default 1 check (min_panels > 0),
  max_panels integer check (max_panels is null or max_panels >= min_panels),
  price_includes_vat boolean not null default true,
  active boolean not null default true,
  valid_from timestamptz,
  valid_until timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create table public.solar_promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  module_id uuid references public.solar_modules(id) on delete cascade,
  discount_type public.solar_discount_type not null,
  discount_value numeric(12, 2) not null check (discount_value > 0),
  min_panels integer not null default 1 check (min_panels > 0),
  max_discount_mxn numeric(12, 2) check (max_discount_mxn > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (discount_type <> 'percentage' or discount_value <= 100)
);

create table public.solar_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  description text,
  panel_count integer not null check (panel_count > 0),
  module_id uuid not null references public.solar_modules(id) on delete restrict,
  price_mxn numeric(12, 2) not null check (price_mxn > 0),
  price_includes_vat boolean not null default true,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table public.solar_receipts
  add column customer_name text,
  add column service_number text,
  add column seller_user_id uuid references auth.users(id);

alter table public.solar_quotes
  alter column config_id drop not null,
  add column system_type public.solar_system_type not null default 'interconnection',
  add column seller_user_id uuid references auth.users(id),
  add column module_id uuid references public.solar_modules(id),
  add column price_option_id uuid references public.solar_price_options(id),
  add column promotion_id uuid references public.solar_promotions(id),
  add column package_id uuid references public.solar_packages(id),
  add column panel_count integer check (panel_count > 0),
  add column price_per_panel_mxn numeric(12, 2) check (price_per_panel_mxn > 0),
  add column subtotal_mxn numeric(14, 2) check (subtotal_mxn >= 0),
  add column discount_mxn numeric(14, 2) not null default 0 check (discount_mxn >= 0),
  add column commission_rate numeric(5, 2) check (commission_rate between 0 and 100),
  add column commission_amount_mxn numeric(14, 2) check (commission_amount_mxn >= 0),
  add column sold_at timestamptz;

create index solar_profiles_role_active_idx
  on public.solar_profiles (role, active);
create index solar_price_options_module_active_idx
  on public.solar_price_options (module_id, active);
create index solar_promotions_active_dates_idx
  on public.solar_promotions (active, starts_at, ends_at);
create index solar_quotes_seller_created_idx
  on public.solar_quotes (seller_user_id, created_at desc);
create index solar_receipts_seller_created_idx
  on public.solar_receipts (seller_user_id, created_at desc);

create trigger solar_profiles_set_updated_at
before update on public.solar_profiles
for each row execute function public.set_updated_at();

create trigger solar_price_options_set_updated_at
before update on public.solar_price_options
for each row execute function public.set_updated_at();

create trigger solar_promotions_set_updated_at
before update on public.solar_promotions
for each row execute function public.set_updated_at();

create trigger solar_packages_set_updated_at
before update on public.solar_packages
for each row execute function public.set_updated_at();

insert into public.solar_zones (
  slug, name, municipality, state, peak_sun_hours_per_day, performance_ratio, active
) values
  ('los-mochis', 'Los Mochis', 'Ahome', 'Sinaloa', 5.50, 0.80, true),
  ('topolobampo', 'Topolobampo', 'Ahome', 'Sinaloa', 5.50, 0.80, true),
  ('juan-jose-rios', 'Juan José Ríos', 'Juan José Ríos', 'Sinaloa', 5.45, 0.80, true),
  ('el-carrizo', 'El Carrizo', 'Ahome', 'Sinaloa', 5.55, 0.80, true)
on conflict (slug) do update set
  name = excluded.name,
  municipality = excluded.municipality,
  state = excluded.state,
  peak_sun_hours_per_day = excluded.peak_sun_hours_per_day,
  performance_ratio = excluded.performance_ratio,
  active = true;

create or replace function public.is_solar_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.solar_profiles
    where user_id = (select auth.uid())
      and role = 'admin'
      and active
  ) or exists (
    select 1
    from public.solar_admins
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.is_active_solar_seller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.solar_profiles
    where user_id = (select auth.uid())
      and role = 'seller'
      and active
  );
$$;

create or replace function public.bootstrap_solar_admin(p_full_name text)
returns public.solar_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.solar_profiles;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Prevent two first users from bootstrapping themselves as administrators
  -- at the same time.
  lock table public.solar_profiles in exclusive mode;

  if exists (select 1 from public.solar_profiles) then
    raise exception 'ADMIN_ALREADY_BOOTSTRAPPED';
  end if;

  insert into public.solar_profiles (user_id, full_name, role, active, created_by)
  values (v_uid, trim(p_full_name), 'admin', true, v_uid)
  returning * into v_profile;

  insert into public.solar_admins (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  return v_profile;
end;
$$;

revoke all on function public.bootstrap_solar_admin(text) from public;
grant execute on function public.bootstrap_solar_admin(text) to authenticated;

alter table public.solar_profiles enable row level security;
alter table public.solar_price_options enable row level security;
alter table public.solar_promotions enable row level security;
alter table public.solar_packages enable row level security;

create policy "staff read own profile"
on public.solar_profiles for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_solar_admin()));

create policy "admins manage staff profiles"
on public.solar_profiles for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "staff read active modules"
on public.solar_modules for select
to authenticated
using (active and ((select public.is_active_solar_seller()) or (select public.is_solar_admin())));

create policy "staff read active zones"
on public.solar_zones for select
to authenticated
using (active and ((select public.is_active_solar_seller()) or (select public.is_solar_admin())));

create policy "staff read active price options"
on public.solar_price_options for select
to authenticated
using (
  ((select public.is_active_solar_seller()) or (select public.is_solar_admin()))
  and active
  and (valid_from is null or valid_from <= now())
  and (valid_until is null or valid_until > now())
);

create policy "admins manage price options"
on public.solar_price_options for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "staff read active promotions"
on public.solar_promotions for select
to authenticated
using (
  ((select public.is_active_solar_seller()) or (select public.is_solar_admin()))
  and active
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

create policy "admins manage promotions"
on public.solar_promotions for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "staff read active packages"
on public.solar_packages for select
to authenticated
using (
  ((select public.is_active_solar_seller()) or (select public.is_solar_admin()))
  and active
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

create policy "admins manage packages"
on public.solar_packages for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "sellers create and read owned leads"
on public.solar_leads for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.is_active_solar_seller())
);

create policy "sellers insert owned leads"
on public.solar_leads for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and (select public.is_active_solar_seller())
);

create policy "sellers update owned leads"
on public.solar_leads for update
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.is_active_solar_seller())
)
with check (
  owner_user_id = (select auth.uid())
  and (select public.is_active_solar_seller())
);

create policy "sellers read owned receipts"
on public.solar_receipts for select
to authenticated
using (
  seller_user_id = (select auth.uid())
  and (select public.is_active_solar_seller())
);

create policy "sellers insert owned receipts"
on public.solar_receipts for insert
to authenticated
with check (
  seller_user_id = (select auth.uid())
  and exists (
    select 1 from public.solar_leads
    where id = lead_id and owner_user_id = (select auth.uid())
  )
);

create policy "sellers read owned consumption"
on public.solar_consumption_periods for select
to authenticated
using (
  exists (
    select 1 from public.solar_receipts
    where id = receipt_id and seller_user_id = (select auth.uid())
  )
);

create policy "sellers insert owned consumption"
on public.solar_consumption_periods for insert
to authenticated
with check (
  exists (
    select 1 from public.solar_receipts
    where id = receipt_id and seller_user_id = (select auth.uid())
  )
);

create policy "sellers read owned quotes"
on public.solar_quotes for select
to authenticated
using (
  seller_user_id = (select auth.uid())
  and (select public.is_active_solar_seller())
);

create policy "sellers read owned events"
on public.solar_quote_events for select
to authenticated
using (
  exists (
    select 1 from public.solar_quotes
    where id = quote_id and seller_user_id = (select auth.uid())
  )
);

create policy "sellers read notes on owned leads"
on public.solar_lead_notes for select
to authenticated
using (
  exists (
    select 1 from public.solar_leads
    where id = lead_id and owner_user_id = (select auth.uid())
  )
);

create policy "sellers add notes to owned leads"
on public.solar_lead_notes for insert
to authenticated
with check (
  author_user_id = (select auth.uid())
  and exists (
    select 1 from public.solar_leads
    where id = lead_id and owner_user_id = (select auth.uid())
  )
);

create or replace function public.seller_create_solar_quote(
  p_lead jsonb,
  p_receipt jsonb,
  p_periods jsonb,
  p_pricing jsonb
)
returns table (
  lead_id uuid,
  receipt_id uuid,
  quote_id uuid,
  folio text,
  panel_count integer,
  total_mxn numeric,
  commission_amount_mxn numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.solar_profiles;
  v_zone public.solar_zones;
  v_module public.solar_modules;
  v_price public.solar_price_options;
  v_promotion public.solar_promotions;
  v_lead_id uuid;
  v_receipt_id uuid;
  v_quote_id uuid;
  v_folio text;
  v_period jsonb;
  v_period_count integer;
  v_covered_months numeric;
  v_consumption numeric;
  v_annual_consumption numeric;
  v_generation_per_panel numeric;
  v_panel_count integer;
  v_subtotal numeric;
  v_discount numeric := 0;
  v_total numeric;
  v_commission numeric;
  v_coverage_target numeric := coalesce((p_pricing->>'coverageTarget')::numeric, 1);
begin
  select * into v_profile
  from public.solar_profiles
  where user_id = v_uid and role = 'seller' and active;

  if v_profile.user_id is null then
    raise exception 'ACTIVE_SELLER_REQUIRED';
  end if;

  if v_coverage_target < 0.5 or v_coverage_target > 1.2 then
    raise exception 'INVALID_COVERAGE_TARGET';
  end if;

  select * into v_zone
  from public.solar_zones
  where id = (p_pricing->>'zoneId')::uuid and active;

  select * into v_module
  from public.solar_modules
  where id = (p_pricing->>'moduleId')::uuid and active;

  select * into v_price
  from public.solar_price_options
  where id = (p_pricing->>'priceOptionId')::uuid
    and module_id = v_module.id
    and active
    and (valid_from is null or valid_from <= now())
    and (valid_until is null or valid_until > now());

  if v_zone.id is null or v_module.id is null or v_price.id is null then
    raise exception 'CATALOG_SELECTION_NOT_AVAILABLE';
  end if;

  if jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) < 1 then
    raise exception 'CONSUMPTION_PERIODS_REQUIRED';
  end if;

  select
    count(*),
    sum(coalesce((item->>'coveredMonths')::numeric, 0)),
    sum((item->>'kwh')::numeric)
  into v_period_count, v_covered_months, v_consumption
  from jsonb_array_elements(p_periods) item;

  if v_covered_months <= 0 or v_consumption <= 0 then
    raise exception 'INVALID_CONSUMPTION_HISTORY';
  end if;

  v_annual_consumption := v_consumption * (12 / v_covered_months);
  v_generation_per_panel :=
    (v_module.watts::numeric / 1000)
    * v_zone.peak_sun_hours_per_day
    * 365
    * v_zone.performance_ratio;
  v_panel_count := ceil(
    (v_annual_consumption * v_coverage_target) / v_generation_per_panel
  );

  if v_panel_count < v_price.min_panels
    or (v_price.max_panels is not null and v_panel_count > v_price.max_panels) then
    raise exception 'PRICE_OPTION_NOT_VALID_FOR_PANEL_COUNT';
  end if;

  if nullif(p_pricing->>'promotionId', '') is not null then
    select * into v_promotion
    from public.solar_promotions
    where id = (p_pricing->>'promotionId')::uuid
      and active
      and (module_id is null or module_id = v_module.id)
      and min_panels <= v_panel_count
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now());
  end if;

  v_subtotal := v_panel_count * v_price.price_per_panel_mxn;

  if v_promotion.id is not null then
    v_discount := case v_promotion.discount_type
      when 'percentage' then v_subtotal * (v_promotion.discount_value / 100)
      when 'fixed' then v_promotion.discount_value
      when 'per_panel' then v_panel_count * v_promotion.discount_value
    end;
    if v_promotion.max_discount_mxn is not null then
      v_discount := least(v_discount, v_promotion.max_discount_mxn);
    end if;
    v_discount := least(v_discount, v_subtotal);
  end if;

  v_total := v_subtotal - v_discount;
  -- The rate is snapshotted now, but the payable amount is only created when
  -- an administrator confirms the sale.
  v_commission := null;

  insert into public.solar_leads (
    name, phone_e164, email, municipality, postal_code,
    privacy_consent_at, privacy_notice_version, source, landing_path,
    status, owner_user_id, metadata
  ) values (
    trim(p_lead->>'name'),
    p_lead->>'phoneE164',
    nullif(lower(trim(p_lead->>'email')), ''),
    coalesce(nullif(trim(p_lead->>'municipality'), ''), v_zone.municipality),
    nullif(trim(p_lead->>'postalCode'), ''),
    coalesce((p_lead->>'privacyConsentAt')::timestamptz, now()),
    coalesce(nullif(p_lead->>'privacyNoticeVersion', ''), '2026-07'),
    coalesce(nullif(p_lead->>'source', ''), 'seller_portal'),
    '/solar/app',
    'validando',
    v_uid,
    jsonb_build_object('createdInSellerPortal', true)
  )
  returning id into v_lead_id;

  insert into public.solar_receipts (
    lead_id, storage_path, mime_type, service_number_last4, service_number,
    customer_name, tariff_code, billing_frequency, latest_bill_date,
    capture_method, property_type, roof_type, seller_user_id, metadata
  ) values (
    v_lead_id,
    nullif(p_receipt->>'storagePath', ''),
    nullif(p_receipt->>'mimeType', ''),
    right(nullif(p_receipt->>'serviceNumber', ''), 4),
    nullif(p_receipt->>'serviceNumber', ''),
    nullif(trim(p_receipt->>'customerName'), ''),
    upper(p_receipt->>'tariffCode'),
    p_receipt->>'billingFrequency',
    nullif(p_receipt->>'latestBillDate', '')::date,
    coalesce(nullif(p_receipt->>'captureMethod', ''), 'receipt_upload'),
    coalesce(nullif(p_receipt->>'propertyType', ''), 'other'),
    coalesce(nullif(p_receipt->>'roofType', ''), 'unknown'),
    v_uid,
    coalesce(p_receipt->'metadata', '{}'::jsonb)
  )
  returning id into v_receipt_id;

  for v_period in select value from jsonb_array_elements(p_periods)
  loop
    insert into public.solar_consumption_periods (
      receipt_id, sequence, period_start, period_end, covered_days,
      covered_months, kwh, amount_mxn
    ) values (
      v_receipt_id,
      coalesce((v_period->>'sequence')::smallint, 1),
      nullif(v_period->>'periodStart', '')::date,
      nullif(v_period->>'periodEnd', '')::date,
      nullif(v_period->>'coveredDays', '')::smallint,
      nullif(v_period->>'coveredMonths', '')::numeric,
      (v_period->>'kwh')::numeric,
      coalesce((v_period->>'amountMxn')::numeric, 0)
    );
  end loop;

  insert into public.solar_quotes (
    lead_id, receipt_id, zone_id, config_id, status, confidence,
    calculation_version, configuration_snapshot, input_snapshot, result_snapshot,
    total_mxn, requires_engineering_review, created_by, seller_user_id,
    module_id, price_option_id, promotion_id, panel_count,
    price_per_panel_mxn, subtotal_mxn, discount_mxn,
    commission_rate, commission_amount_mxn
  ) values (
    v_lead_id,
    v_receipt_id,
    v_zone.id,
    null,
    'validada',
    case when v_period_count >= 6 then 'alta'::public.solar_quote_confidence
         else 'media'::public.solar_quote_confidence end,
    'seller-portal-v1',
    jsonb_build_object(
      'zone', to_jsonb(v_zone),
      'module', to_jsonb(v_module),
      'priceOption', to_jsonb(v_price),
      'promotion', case when v_promotion.id is null then null else to_jsonb(v_promotion) end
    ),
    jsonb_build_object(
      'annualConsumptionKwh', round(v_annual_consumption, 3),
      'coverageTarget', v_coverage_target,
      'tariffCode', p_receipt->>'tariffCode'
    ),
    jsonb_build_object(
      'panelCount', v_panel_count,
      'systemDcKw', round((v_panel_count * v_module.watts::numeric) / 1000, 3),
      'annualGenerationKwh', round(v_panel_count * v_generation_per_panel, 3),
      'estimatedCoverage', round(
        (v_panel_count * v_generation_per_panel) / v_annual_consumption,
        4
      )
    ),
    v_total,
    upper(p_receipt->>'tariffCode') in ('GDMTO', 'GDMTH'),
    v_uid,
    v_uid,
    v_module.id,
    v_price.id,
    v_promotion.id,
    v_panel_count,
    v_price.price_per_panel_mxn,
    v_subtotal,
    v_discount,
    v_profile.commission_rate,
    null
  )
  returning id, public.solar_quotes.folio into v_quote_id, v_folio;

  insert into public.solar_quote_events (
    quote_id, lead_id, event_name, actor_user_id, metadata
  ) values (
    v_quote_id, v_lead_id, 'seller_quote_created', v_uid,
    jsonb_build_object('totalMxn', v_total, 'panelCount', v_panel_count)
  );

  return query select
    v_lead_id, v_receipt_id, v_quote_id, v_folio, v_panel_count,
    v_total, v_commission;
end;
$$;

revoke all on function public.seller_create_solar_quote(jsonb, jsonb, jsonb, jsonb)
from public;
grant execute on function public.seller_create_solar_quote(jsonb, jsonb, jsonb, jsonb)
to authenticated;

create or replace function public.set_solar_quote_status(
  p_quote_id uuid,
  p_status public.solar_quote_status,
  p_lost_reason text default null
)
returns public.solar_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_quote public.solar_quotes;
  v_is_admin boolean := public.is_solar_admin();
begin
  select * into v_quote
  from public.solar_quotes
  where id = p_quote_id;

  if v_quote.id is null then
    raise exception 'QUOTE_NOT_FOUND';
  end if;

  if not v_is_admin
    and (v_quote.seller_user_id <> v_uid or not public.is_active_solar_seller()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_status in ('aceptada', 'rechazada') and not v_is_admin then
    raise exception 'ADMIN_REQUIRED_FOR_FINAL_STATUS';
  end if;

  if p_status = 'rechazada' and nullif(trim(p_lost_reason), '') is null then
    raise exception 'LOST_REASON_REQUIRED';
  end if;

  update public.solar_quotes
  set
    status = p_status,
    sold_at = case
      when p_status = 'aceptada' then coalesce(sold_at, now())
      else null
    end,
    commission_amount_mxn = case
      when p_status = 'aceptada'
        then round(coalesce(total_mxn, 0) * (coalesce(commission_rate, 0) / 100), 2)
      else null
    end
  where id = p_quote_id
  returning * into v_quote;

  update public.solar_leads
  set
    status = case
      when p_status = 'aceptada' then 'ganado'::public.solar_lead_status
      when p_status = 'rechazada' then 'perdido'::public.solar_lead_status
      when p_status = 'enviada' then 'propuesta_enviada'::public.solar_lead_status
      else status
    end,
    lost_reason = case when p_status = 'rechazada' then nullif(trim(p_lost_reason), '') else lost_reason end
  where id = v_quote.lead_id;

  insert into public.solar_quote_events (
    quote_id, lead_id, event_name, actor_user_id, metadata
  ) values (
    v_quote.id, v_quote.lead_id, 'quote_status_changed', v_uid,
    jsonb_build_object('status', p_status, 'lostReason', p_lost_reason)
  );

  return v_quote;
end;
$$;

revoke all on function public.set_solar_quote_status(uuid, public.solar_quote_status, text)
from public;
grant execute on function public.set_solar_quote_status(uuid, public.solar_quote_status, text)
to authenticated;

grant select, insert, update, delete on
  public.solar_profiles,
  public.solar_price_options,
  public.solar_promotions,
  public.solar_packages
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'solar-receipts',
  'solar-receipts',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "staff upload receipts to own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'solar-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and ((select public.is_active_solar_seller()) or (select public.is_solar_admin()))
);

create policy "staff read own receipt files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'solar-receipts'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_solar_admin())
  )
);

comment on table public.solar_profiles is
  'Private portal users. Seller commission is snapshotted into each quote.';
comment on table public.solar_price_options is
  'Admin-controlled installed price per panel and applicable quantity range.';
comment on function public.seller_create_solar_quote(jsonb, jsonb, jsonb, jsonb) is
  'Calculates pricing server-side and atomically assigns the lead, receipt and quote to the authenticated seller.';

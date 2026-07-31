-- CDSE Solar — core schema for leads, receipts and reproducible quotes.
-- Designed for Supabase Postgres. Public traffic must enter through a validated
-- Edge Function; the browser receives no direct table insert/read privileges.

create extension if not exists pgcrypto;

create type public.solar_lead_status as enum (
  'nuevo',
  'contactado',
  'validando',
  'propuesta_enviada',
  'ganado',
  'perdido'
);

create type public.solar_quote_status as enum (
  'borrador',
  'preliminar',
  'validada',
  'enviada',
  'aceptada',
  'rechazada',
  'vencida'
);

create type public.solar_quote_confidence as enum (
  'baja',
  'media',
  'alta',
  'validada'
);

create table public.solar_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.solar_zones (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  municipality text not null,
  state text not null default 'Sinaloa',
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  peak_sun_hours_per_day numeric(5, 2) not null
    check (peak_sun_hours_per_day > 0 and peak_sun_hours_per_day < 24),
  performance_ratio numeric(5, 4) not null
    check (performance_ratio > 0 and performance_ratio <= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_modules (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  brand text not null,
  model text not null,
  watts integer not null check (watts > 0),
  width_mm integer check (width_mm > 0),
  height_mm integer check (height_mm > 0),
  product_warranty_years numeric(4, 1)
    check (product_warranty_years >= 0),
  performance_warranty_years numeric(4, 1)
    check (performance_warranty_years >= 0),
  unit_cost_mxn numeric(12, 2)
    check (unit_cost_mxn >= 0),
  installed_price_mxn numeric(12, 2)
    check (installed_price_mxn > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_inverters (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  brand text not null,
  model text not null,
  inverter_type text not null
    check (inverter_type in ('string', 'microinverter', 'hybrid', 'other')),
  ac_capacity_kw numeric(10, 3) not null check (ac_capacity_kw > 0),
  phases smallint check (phases in (1, 2, 3)),
  unit_cost_mxn numeric(12, 2)
    check (unit_cost_mxn >= 0),
  warranty_years numeric(4, 1) check (warranty_years >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_calculation_configs (
  id uuid primary key default gen_random_uuid(),
  version integer generated always as identity unique,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  coverage_target numeric(5, 4) not null
    check (coverage_target > 0 and coverage_target <= 1),
  price_mode text not null
    check (price_mode in ('per_watt', 'per_panel', 'line_items')),
  price_per_watt_mxn numeric(12, 4)
    check (price_per_watt_mxn > 0),
  price_includes_vat boolean not null default false,
  vat_rate numeric(5, 4) not null default 0.16
    check (vat_rate >= 0 and vat_rate <= 1),
  savings_realization_factor numeric(5, 4) not null
    check (savings_realization_factor > 0 and savings_realization_factor <= 1),
  non_offsettable_annual_charges_mxn numeric(12, 2) not null default 0
    check (non_offsettable_annual_charges_mxn >= 0),
  tariff_escalation_rate numeric(5, 4) not null
    check (tariff_escalation_rate >= 0 and tariff_escalation_rate <= 1),
  annual_panel_degradation_rate numeric(5, 4) not null
    check (annual_panel_degradation_rate >= 0 and annual_panel_degradation_rate <= 1),
  projection_years smallint not null default 10
    check (projection_years between 1 and 30),
  module_id uuid not null references public.solar_modules(id),
  default_inverter_id uuid references public.solar_inverters(id),
  cost_template jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cost_template) = 'array'),
  environmental_factors jsonb not null default '{}'::jsonb
    check (jsonb_typeof(environmental_factors) = 'object'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check (
    (price_mode = 'per_watt' and price_per_watt_mxn is not null)
    or price_mode in ('per_panel', 'line_items')
  )
);

create unique index one_published_solar_calculation_config
  on public.solar_calculation_configs ((status))
  where status = 'published';

create table public.solar_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  phone_e164 text not null,
  email text,
  municipality text not null,
  postal_code text,
  contact_preference text not null default 'whatsapp'
    check (contact_preference in ('whatsapp', 'phone', 'email')),
  privacy_consent_at timestamptz not null,
  privacy_notice_version text not null,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_path text,
  referrer text,
  status public.solar_lead_status not null default 'nuevo',
  owner_user_id uuid references auth.users(id),
  lost_reason text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index solar_leads_status_created_idx
  on public.solar_leads (status, created_at desc);

create index solar_leads_phone_idx
  on public.solar_leads (phone_e164);

create table public.solar_receipts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.solar_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  storage_path text,
  mime_type text,
  service_number_last4 text check (
    service_number_last4 is null or service_number_last4 ~ '^[0-9]{4}$'
  ),
  tariff_code text not null,
  billing_frequency text not null
    check (billing_frequency in ('monthly', 'bimonthly', 'other')),
  latest_bill_date date,
  capture_method text not null
    check (capture_method in ('receipt_upload', 'manual_receipt', 'payment_estimate')),
  property_type text
    check (property_type in ('home', 'business', 'industrial', 'other')),
  roof_type text
    check (roof_type in ('concrete', 'metal', 'tile', 'ground', 'unknown', 'other')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  check (
    (storage_path is null and mime_type is null)
    or (storage_path is not null and mime_type is not null)
  )
);

create table public.solar_consumption_periods (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.solar_receipts(id) on delete cascade,
  sequence smallint not null check (sequence > 0),
  period_start date,
  period_end date,
  covered_days smallint check (covered_days > 0),
  covered_months numeric(4, 2) check (covered_months > 0),
  kwh numeric(12, 3) not null check (kwh > 0),
  amount_mxn numeric(12, 2) not null check (amount_mxn >= 0),
  demand_kw numeric(12, 3) check (demand_kw >= 0),
  base_kwh numeric(12, 3) check (base_kwh >= 0),
  intermediate_kwh numeric(12, 3) check (intermediate_kwh >= 0),
  peak_kwh numeric(12, 3) check (peak_kwh >= 0),
  unique (receipt_id, sequence),
  check (
    (covered_days is not null and covered_months is null)
    or (covered_days is null and covered_months is not null)
  ),
  check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  )
);

create sequence public.solar_quote_folio_seq start 1;

create table public.solar_quotes (
  id uuid primary key default gen_random_uuid(),
  folio_number bigint not null unique default nextval('public.solar_quote_folio_seq'),
  folio text generated always as (
    'CDSE-S-' || lpad(folio_number::text, 6, '0')
  ) stored unique,
  lead_id uuid not null references public.solar_leads(id) on delete restrict,
  receipt_id uuid not null references public.solar_receipts(id) on delete restrict,
  zone_id uuid not null references public.solar_zones(id) on delete restrict,
  config_id uuid not null references public.solar_calculation_configs(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  status public.solar_quote_status not null default 'preliminar',
  confidence public.solar_quote_confidence not null,
  calculation_version text not null,
  configuration_snapshot jsonb not null
    check (jsonb_typeof(configuration_snapshot) = 'object'),
  input_snapshot jsonb not null
    check (jsonb_typeof(input_snapshot) = 'object'),
  result_snapshot jsonb not null
    check (jsonb_typeof(result_snapshot) = 'object'),
  total_mxn numeric(14, 2) check (total_mxn >= 0),
  pdf_storage_path text,
  requires_engineering_review boolean not null default true,
  created_by uuid references auth.users(id)
);

create index solar_quotes_lead_created_idx
  on public.solar_quotes (lead_id, created_at desc);

create index solar_quotes_status_created_idx
  on public.solar_quotes (status, created_at desc);

create table public.solar_quote_events (
  id bigint generated always as identity primary key,
  quote_id uuid references public.solar_quotes(id) on delete cascade,
  lead_id uuid not null references public.solar_leads(id) on delete cascade,
  event_name text not null,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);

create index solar_quote_events_lead_created_idx
  on public.solar_quote_events (lead_id, created_at desc);

create table public.solar_lead_notes (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.solar_leads(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  author_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger solar_zones_set_updated_at
before update on public.solar_zones
for each row execute function public.set_updated_at();

create trigger solar_modules_set_updated_at
before update on public.solar_modules
for each row execute function public.set_updated_at();

create trigger solar_inverters_set_updated_at
before update on public.solar_inverters
for each row execute function public.set_updated_at();

create trigger solar_leads_set_updated_at
before update on public.solar_leads
for each row execute function public.set_updated_at();

create trigger solar_quotes_set_updated_at
before update on public.solar_quotes
for each row execute function public.set_updated_at();

create or replace function public.is_solar_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.solar_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_solar_admin() from public;
grant execute on function public.is_solar_admin() to authenticated;

alter table public.solar_admins enable row level security;
alter table public.solar_zones enable row level security;
alter table public.solar_modules enable row level security;
alter table public.solar_inverters enable row level security;
alter table public.solar_calculation_configs enable row level security;
alter table public.solar_leads enable row level security;
alter table public.solar_receipts enable row level security;
alter table public.solar_consumption_periods enable row level security;
alter table public.solar_quotes enable row level security;
alter table public.solar_quote_events enable row level security;
alter table public.solar_lead_notes enable row level security;

-- Public visitors may only read non-sensitive, active service zones. Product
-- costs and calculation configuration are returned by a sanitized Edge Function.
create policy "public can read active solar zones"
on public.solar_zones for select
to anon, authenticated
using (active);

-- Administrative access. Edge Functions using service_role bypass RLS and are
-- responsible for validating public submissions, rate limiting and anti-spam.
create policy "admins manage solar admins"
on public.solar_admins for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar zones"
on public.solar_zones for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar modules"
on public.solar_modules for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar inverters"
on public.solar_inverters for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar configs"
on public.solar_calculation_configs for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar leads"
on public.solar_leads for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar receipts"
on public.solar_receipts for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar consumption"
on public.solar_consumption_periods for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar quotes"
on public.solar_quotes for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar quote events"
on public.solar_quote_events for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "admins manage solar lead notes"
on public.solar_lead_notes for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

revoke all on
  public.solar_admins,
  public.solar_zones,
  public.solar_modules,
  public.solar_inverters,
  public.solar_calculation_configs,
  public.solar_leads,
  public.solar_receipts,
  public.solar_consumption_periods,
  public.solar_quotes,
  public.solar_quote_events,
  public.solar_lead_notes
from anon;

grant select on public.solar_zones to anon;

grant select, insert, update, delete on
  public.solar_admins,
  public.solar_zones,
  public.solar_modules,
  public.solar_inverters,
  public.solar_calculation_configs,
  public.solar_leads,
  public.solar_receipts,
  public.solar_consumption_periods,
  public.solar_quotes,
  public.solar_quote_events,
  public.solar_lead_notes
to authenticated;

grant usage, select on sequence public.solar_quote_folio_seq to authenticated;

comment on table public.solar_quotes is
  'Immutable input/config/result snapshots make every preliminary quote reproducible.';

comment on column public.solar_quotes.folio is
  'Human-friendly unique folio generated atomically by Postgres.';

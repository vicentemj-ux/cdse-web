-- Commercial package offers, configurable financing and a wider Los Mochis service area.

alter table public.solar_zones
  add column if not exists distance_from_los_mochis_km numeric(7, 2)
    check (distance_from_los_mochis_km is null or distance_from_los_mochis_km >= 0);

create table if not exists public.solar_financing_options (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  description text,
  min_panels integer not null default 8 check (min_panels > 0),
  down_payment_percent numeric(5, 2) not null default 50
    check (down_payment_percent >= 0 and down_payment_percent <= 100),
  installments integer not null default 12 check (installments > 0),
  interest_rate numeric(5, 2) not null default 0 check (interest_rate >= 0 and interest_rate <= 100),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.solar_quotes
  add column if not exists financing_option_id uuid references public.solar_financing_options(id),
  add column if not exists financing_down_payment_percent numeric(5, 2),
  add column if not exists financing_down_payment_mxn numeric(14, 2),
  add column if not exists financing_amount_mxn numeric(14, 2),
  add column if not exists financing_installments integer,
  add column if not exists financing_interest_rate numeric(5, 2);

create index if not exists solar_financing_options_active_idx
  on public.solar_financing_options (active, min_panels);

alter table public.solar_financing_options enable row level security;

create policy "staff read active financing options"
on public.solar_financing_options for select
to authenticated
using (
  active and ((select public.is_active_solar_seller()) or (select public.is_solar_admin()))
);

create policy "admins manage financing options"
on public.solar_financing_options for all
to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create trigger solar_financing_options_set_updated_at
before update on public.solar_financing_options
for each row execute function public.set_updated_at();

insert into public.solar_zones (
  slug, name, municipality, state, peak_sun_hours_per_day, performance_ratio,
  distance_from_los_mochis_km, active
) values
  ('los-mochis', 'Los Mochis', 'Ahome', 'Sinaloa', 5.50, 0.80, 0, true),
  ('san-miguel-zapotitlan', 'San Miguel Zapotitlán', 'Ahome', 'Sinaloa', 5.50, 0.80, 18, true),
  ('villa-de-ahome', 'Villa de Ahome', 'Ahome', 'Sinaloa', 5.50, 0.80, 25, true),
  ('topolobampo', 'Topolobampo', 'Ahome', 'Sinaloa', 5.50, 0.80, 25, true),
  ('higuera-de-zaragoza', 'Higuera de Zaragoza', 'Ahome', 'Sinaloa', 5.50, 0.80, 38, true),
  ('juan-jose-rios', 'Juan José Ríos', 'Guasave', 'Sinaloa', 5.45, 0.80, 45, true),
  ('el-carrizo', 'El Carrizo', 'Ahome', 'Sinaloa', 5.55, 0.80, 66, true)
on conflict (slug) do update set
  name = excluded.name,
  municipality = excluded.municipality,
  state = excluded.state,
  peak_sun_hours_per_day = excluded.peak_sun_hours_per_day,
  performance_ratio = excluded.performance_ratio,
  distance_from_los_mochis_km = excluded.distance_from_los_mochis_km,
  active = true;

insert into public.solar_packages (
  name, description, panel_count, module_id, price_mxn, price_includes_vat, active
)
select
  format('Paquete base %s paneles - %s W', panel_count, module.watts),
  case panel_count
    when 4 then 'Sistema mínimo recomendado para instalación residencial o negocio pequeño.'
    when 8 then 'Sistema estándar con opción de financiamiento sin intereses.'
  end,
  panel_count,
  module.id,
  case panel_count when 4 then 36000 when 8 then 72000 end,
  true,
  true
from public.solar_modules as module
cross join (values (4), (8)) as counts(panel_count)
where module.active
  and not exists (
    select 1 from public.solar_packages package
    where package.name = format('Paquete base %s paneles - %s W', counts.panel_count, module.watts)
  );

insert into public.solar_financing_options (
  name, description, min_panels, down_payment_percent, installments, interest_rate, active
) values (
  'Crédito 12 meses sin intereses',
  'Aplica para proyectos desde 8 paneles. Enganche configurable por el administrador.',
  8,
  50,
  12,
  0,
  true
)
on conflict (name) do update set
  description = excluded.description,
  min_panels = excluded.min_panels,
  down_payment_percent = excluded.down_payment_percent,
  installments = excluded.installments,
  interest_rate = excluded.interest_rate,
  active = true;

create or replace function public.apply_solar_quote_options(
  p_quote_id uuid,
  p_package_id uuid default null,
  p_financing_option_id uuid default null
)
returns table (
  quote_id uuid,
  total_mxn numeric,
  subtotal_mxn numeric,
  discount_mxn numeric,
  package_id uuid,
  package_name text,
  financing_option_id uuid,
  financing_name text,
  down_payment_percent numeric,
  down_payment_mxn numeric,
  financing_amount_mxn numeric,
  installments integer,
  interest_rate numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.solar_quotes;
  v_package public.solar_packages;
  v_financing public.solar_financing_options;
  v_total numeric;
  v_subtotal numeric;
  v_discount numeric := 0;
  v_down numeric := null;
  v_financed numeric := null;
begin
  select * into v_quote
  from public.solar_quotes
  where id = p_quote_id;

  if v_quote.id is null then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_quote.seller_user_id <> (select auth.uid())
    and not (select public.is_solar_admin()) then
    raise exception 'QUOTE_ACCESS_DENIED';
  end if;

  v_subtotal := v_quote.subtotal_mxn;
  v_total := v_quote.total_mxn;

  if p_package_id is not null then
    select * into v_package
    from public.solar_packages
    where id = p_package_id
      and active
      and module_id = v_quote.module_id
      and panel_count >= v_quote.panel_count
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now());
    if v_package.id is null then
      raise exception 'PACKAGE_NOT_AVAILABLE';
    end if;
    v_subtotal := v_package.price_mxn;
    v_total := v_package.price_mxn;
  end if;

  if p_financing_option_id is not null then
    select * into v_financing
    from public.solar_financing_options
    where id = p_financing_option_id and active;
    if v_financing.id is null or v_quote.panel_count < v_financing.min_panels then
      raise exception 'FINANCING_NOT_AVAILABLE';
    end if;
    v_down := round(v_total * v_financing.down_payment_percent / 100, 2);
    v_financed := v_total - v_down;
  end if;

  update public.solar_quotes
  set package_id = nullif(p_package_id, null),
      financing_option_id = nullif(p_financing_option_id, null),
      subtotal_mxn = v_subtotal,
      total_mxn = v_total,
      discount_mxn = v_discount,
      financing_down_payment_percent = v_financing.down_payment_percent,
      financing_down_payment_mxn = v_down,
      financing_amount_mxn = v_financed,
      financing_installments = v_financing.installments,
      financing_interest_rate = v_financing.interest_rate,
      result_snapshot = coalesce(result_snapshot, '{}'::jsonb)
        || jsonb_build_object(
          'package', case when v_package.id is null then null else jsonb_build_object(
            'id', v_package.id, 'name', v_package.name, 'panelCount', v_package.panel_count,
            'priceMxn', v_package.price_mxn
          ) end,
          'financing', case when v_financing.id is null then null else jsonb_build_object(
            'id', v_financing.id, 'name', v_financing.name, 'downPaymentPercent', v_financing.down_payment_percent,
            'downPaymentMxn', v_down, 'financingAmountMxn', v_financed,
            'installments', v_financing.installments, 'interestRate', v_financing.interest_rate
          ) end
        )
  where id = v_quote.id;

  return query select
    v_quote.id, v_total, v_subtotal, v_discount,
    nullif(p_package_id, null), v_package.name,
    nullif(p_financing_option_id, null), v_financing.name,
    v_financing.down_payment_percent, v_down, v_financed,
    v_financing.installments, v_financing.interest_rate;
end;
$$;

revoke all on function public.apply_solar_quote_options(uuid, uuid, uuid) from public;
grant execute on function public.apply_solar_quote_options(uuid, uuid, uuid) to authenticated;

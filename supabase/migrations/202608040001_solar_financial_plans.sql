-- Configurable commercial terms: each financing option can carry its own
-- installed price per panel so the seller selects one coherent offer.

alter table public.solar_financing_options
  add column if not exists price_per_panel_mxn numeric(12, 2)
    check (price_per_panel_mxn is null or price_per_panel_mxn > 0);

insert into public.solar_financing_options (
  name, description, min_panels, price_per_panel_mxn,
  down_payment_percent, installments, interest_rate, active
) values
  ('Plan 24 meses · $12,000 por panel', '20% de enganche y 24 mensualidades sin intereses.', 1, 12000, 20, 24, 0, true),
  ('Plan 12 meses · $10,000 por panel', '40% de enganche y 12 mensualidades sin intereses.', 1, 10000, 40, 12, 0, true),
  ('Plan 12 meses · $9,500 por panel', '50% de enganche y 12 mensualidades sin intereses.', 1, 9500, 50, 12, 0, true),
  ('Pago de contado · $8,500 por panel', 'Pago completo del proyecto en una sola exhibición.', 1, 8500, 100, 1, 0, true)
on conflict (name) do update set
  description = excluded.description,
  min_panels = excluded.min_panels,
  price_per_panel_mxn = excluded.price_per_panel_mxn,
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
  quote_id uuid, total_mxn numeric, subtotal_mxn numeric, discount_mxn numeric,
  package_id uuid, package_name text, financing_option_id uuid, financing_name text,
  down_payment_percent numeric, down_payment_mxn numeric, financing_amount_mxn numeric,
  installments integer, interest_rate numeric
)
language plpgsql security definer set search_path = ''
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
  select * into v_quote from public.solar_quotes where id = p_quote_id;
  if v_quote.id is null then raise exception 'QUOTE_NOT_FOUND'; end if;
  if v_quote.seller_user_id <> (select auth.uid()) and not (select public.is_solar_admin()) then
    raise exception 'QUOTE_ACCESS_DENIED';
  end if;

  v_subtotal := v_quote.subtotal_mxn;
  v_total := v_quote.total_mxn;

  if p_package_id is not null then
    select * into v_package from public.solar_packages
    where id = p_package_id and active and module_id = v_quote.module_id
      and panel_count >= v_quote.panel_count
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now());
    if v_package.id is null then raise exception 'PACKAGE_NOT_AVAILABLE'; end if;
    v_subtotal := v_package.price_mxn;
    v_total := v_package.price_mxn;
  end if;

  if p_financing_option_id is not null then
    select * into v_financing from public.solar_financing_options
    where id = p_financing_option_id and active;
    if v_financing.id is null or v_quote.panel_count < v_financing.min_panels then
      raise exception 'FINANCING_NOT_AVAILABLE';
    end if;
    if v_financing.price_per_panel_mxn is not null then
      v_subtotal := v_quote.panel_count * v_financing.price_per_panel_mxn;
      v_total := v_subtotal;
    end if;
    v_down := round(v_total * v_financing.down_payment_percent / 100, 2);
    v_financed := v_total - v_down;
  end if;

  update public.solar_quotes
  set package_id = nullif(p_package_id, null), financing_option_id = nullif(p_financing_option_id, null),
      price_per_panel_mxn = case when v_financing.price_per_panel_mxn is null then price_per_panel_mxn else v_financing.price_per_panel_mxn end,
      subtotal_mxn = v_subtotal, total_mxn = v_total, discount_mxn = v_discount,
      financing_down_payment_percent = v_financing.down_payment_percent,
      financing_down_payment_mxn = v_down, financing_amount_mxn = v_financed,
      financing_installments = v_financing.installments, financing_interest_rate = v_financing.interest_rate,
      result_snapshot = coalesce(result_snapshot, '{}'::jsonb) || jsonb_build_object(
        'package', case when v_package.id is null then null else jsonb_build_object('id', v_package.id, 'name', v_package.name, 'panelCount', v_package.panel_count, 'priceMxn', v_package.price_mxn) end,
        'financing', case when v_financing.id is null then null else jsonb_build_object('id', v_financing.id, 'name', v_financing.name, 'pricePerPanelMxn', v_financing.price_per_panel_mxn, 'downPaymentPercent', v_financing.down_payment_percent, 'downPaymentMxn', v_down, 'financingAmountMxn', v_financed, 'installments', v_financing.installments, 'interestRate', v_financing.interest_rate) end
      )
  where id = v_quote.id;

  return query select v_quote.id, v_total, v_subtotal, v_discount,
    nullif(p_package_id, null), v_package.name, nullif(p_financing_option_id, null), v_financing.name,
    v_financing.down_payment_percent, v_down, v_financed, v_financing.installments, v_financing.interest_rate;
end;
$$;

revoke all on function public.apply_solar_quote_options(uuid, uuid, uuid) from public;
grant execute on function public.apply_solar_quote_options(uuid, uuid, uuid) to authenticated;

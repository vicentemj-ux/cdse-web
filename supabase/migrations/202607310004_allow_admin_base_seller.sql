-- Allow the primary administrator to create quotes as the base seller.
create or replace function public.seller_create_solar_quote(
  p_lead jsonb, p_receipt jsonb, p_periods jsonb, p_pricing jsonb
)
returns table (lead_id uuid, receipt_id uuid, quote_id uuid, folio text, panel_count integer, total_mxn numeric, commission_amount_mxn numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.solar_profiles;
  v_zone public.solar_zones;
  v_module public.solar_modules;
  v_price public.solar_price_options;
  v_promotion public.solar_promotions;
  v_lead_id uuid; v_receipt_id uuid; v_quote_id uuid; v_folio text;
  v_period jsonb; v_period_count integer; v_covered_months numeric; v_consumption numeric;
  v_annual_consumption numeric; v_generation_per_panel numeric; v_panel_count integer;
  v_subtotal numeric; v_discount numeric := 0; v_total numeric; v_commission numeric;
  v_coverage_target numeric := coalesce((p_pricing->>'coverageTarget')::numeric, 1);
begin
  select * into v_profile from public.solar_profiles
  where user_id = v_uid and active and (role = 'seller' or (role = 'admin' and public.is_solar_admin()));
  if v_profile.user_id is null then raise exception 'ACTIVE_SELLER_REQUIRED'; end if;
  if v_coverage_target < 0.5 or v_coverage_target > 1.2 then raise exception 'INVALID_COVERAGE_TARGET'; end if;

  select * into v_zone from public.solar_zones where id = (p_pricing->>'zoneId')::uuid and active;
  select * into v_module from public.solar_modules where id = (p_pricing->>'moduleId')::uuid and active;
  select * into v_price from public.solar_price_options
  where id = (p_pricing->>'priceOptionId')::uuid and module_id = v_module.id and active
    and (valid_from is null or valid_from <= now()) and (valid_until is null or valid_until > now());
  if v_zone.id is null or v_module.id is null or v_price.id is null then raise exception 'CATALOG_SELECTION_NOT_AVAILABLE'; end if;
  if jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) < 1 then raise exception 'CONSUMPTION_PERIODS_REQUIRED'; end if;

  select count(*), sum(coalesce((item->>'coveredMonths')::numeric, 0)), sum((item->>'kwh')::numeric)
  into v_period_count, v_covered_months, v_consumption from jsonb_array_elements(p_periods) item;
  if v_covered_months <= 0 or v_consumption <= 0 then raise exception 'INVALID_CONSUMPTION_HISTORY'; end if;
  v_annual_consumption := v_consumption * (12 / v_covered_months);
  v_generation_per_panel := (v_module.watts::numeric / 1000) * v_zone.peak_sun_hours_per_day * 365 * v_zone.performance_ratio;
  v_panel_count := ceil((v_annual_consumption * v_coverage_target) / v_generation_per_panel);
  if v_panel_count < v_price.min_panels or (v_price.max_panels is not null and v_panel_count > v_price.max_panels) then raise exception 'PRICE_OPTION_NOT_VALID_FOR_PANEL_COUNT'; end if;

  if nullif(p_pricing->>'promotionId', '') is not null then
    select * into v_promotion from public.solar_promotions
    where id = (p_pricing->>'promotionId')::uuid and active and (module_id is null or module_id = v_module.id)
      and min_panels <= v_panel_count and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now());
  end if;
  v_subtotal := v_panel_count * v_price.price_per_panel_mxn;
  if v_promotion.id is not null then
    v_discount := case v_promotion.discount_type when 'percentage' then v_subtotal * (v_promotion.discount_value / 100) when 'fixed' then v_promotion.discount_value when 'per_panel' then v_panel_count * v_promotion.discount_value end;
    if v_promotion.max_discount_mxn is not null then v_discount := least(v_discount, v_promotion.max_discount_mxn); end if;
    v_discount := least(v_discount, v_subtotal);
  end if;
  v_total := v_subtotal - v_discount; v_commission := null;

  insert into public.solar_leads (name, phone_e164, email, municipality, postal_code, privacy_consent_at, privacy_notice_version, source, landing_path, status, owner_user_id, metadata)
  values (trim(p_lead->>'name'), p_lead->>'phoneE164', nullif(lower(trim(p_lead->>'email')), ''), coalesce(nullif(trim(p_lead->>'municipality'), ''), v_zone.municipality), nullif(trim(p_lead->>'postalCode'), ''), coalesce((p_lead->>'privacyConsentAt')::timestamptz, now()), coalesce(nullif(p_lead->>'privacyNoticeVersion', ''), '2026-07'), coalesce(nullif(p_lead->>'source', ''), 'seller_portal'), '/solar/app', 'validando', v_uid, jsonb_build_object('createdInSellerPortal', true)) returning id into v_lead_id;
  insert into public.solar_receipts (lead_id, storage_path, mime_type, service_number_last4, service_number, customer_name, tariff_code, billing_frequency, latest_bill_date, capture_method, property_type, roof_type, seller_user_id, metadata)
  values (v_lead_id, nullif(p_receipt->>'storagePath', ''), nullif(p_receipt->>'mimeType', ''), right(nullif(p_receipt->>'serviceNumber', ''), 4), nullif(p_receipt->>'serviceNumber', ''), nullif(trim(p_receipt->>'customerName'), ''), upper(p_receipt->>'tariffCode'), p_receipt->>'billingFrequency', nullif(p_receipt->>'latestBillDate', '')::date, coalesce(nullif(p_receipt->>'captureMethod', ''), 'receipt_upload'), coalesce(nullif(p_receipt->>'propertyType', ''), 'other'), coalesce(nullif(p_receipt->>'roofType', ''), 'unknown'), v_uid, coalesce(p_receipt->'metadata', '{}'::jsonb)) returning id into v_receipt_id;
  for v_period in select value from jsonb_array_elements(p_periods) loop
    insert into public.solar_consumption_periods (receipt_id, sequence, period_start, period_end, covered_days, covered_months, kwh, amount_mxn)
    values (v_receipt_id, coalesce((v_period->>'sequence')::smallint, 1), nullif(v_period->>'periodStart', '')::date, nullif(v_period->>'periodEnd', '')::date, nullif(v_period->>'coveredDays', '')::smallint, nullif(v_period->>'coveredMonths', '')::numeric, (v_period->>'kwh')::numeric, coalesce((v_period->>'amountMxn')::numeric, 0));
  end loop;
  insert into public.solar_quotes (lead_id, receipt_id, zone_id, config_id, status, confidence, calculation_version, configuration_snapshot, input_snapshot, result_snapshot, total_mxn, requires_engineering_review, created_by, seller_user_id, module_id, price_option_id, promotion_id, panel_count, price_per_panel_mxn, subtotal_mxn, discount_mxn, commission_rate, commission_amount_mxn)
  values (v_lead_id, v_receipt_id, v_zone.id, null, 'validada', case when v_period_count >= 6 then 'alta'::public.solar_quote_confidence else 'media'::public.solar_quote_confidence end, 'seller-portal-v1', jsonb_build_object('zone', to_jsonb(v_zone), 'module', to_jsonb(v_module), 'priceOption', to_jsonb(v_price), 'promotion', case when v_promotion.id is null then null else to_jsonb(v_promotion) end), jsonb_build_object('annualConsumptionKwh', round(v_annual_consumption, 3), 'coverageTarget', v_coverage_target, 'tariffCode', p_receipt->>'tariffCode'), jsonb_build_object('panelCount', v_panel_count, 'systemDcKw', round((v_panel_count * v_module.watts::numeric) / 1000, 3), 'annualGenerationKwh', round(v_panel_count * v_generation_per_panel, 3), 'estimatedCoverage', round((v_panel_count * v_generation_per_panel) / v_annual_consumption, 4)), v_total, upper(p_receipt->>'tariffCode') in ('GDMTO', 'GDMTH'), v_uid, v_uid, v_module.id, v_price.id, v_promotion.id, v_panel_count, v_price.price_per_panel_mxn, v_subtotal, v_discount, v_profile.commission_rate, null)
  returning id, public.solar_quotes.folio into v_quote_id, v_folio;
  insert into public.solar_quote_events (quote_id, lead_id, event_name, actor_user_id, metadata) values (v_quote_id, v_lead_id, 'seller_quote_created', v_uid, jsonb_build_object('totalMxn', v_total, 'panelCount', v_panel_count));
  return query select v_lead_id, v_receipt_id, v_quote_id, v_folio, v_panel_count, v_total, v_commission;
end;
$$;

revoke all on function public.seller_create_solar_quote(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.seller_create_solar_quote(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Atomic persistence boundary used exclusively by the create-solar-quote Edge
-- Function. Calculation and validation happen before this RPC; constraints here
-- remain the final integrity guard.

create or replace function public.create_solar_quote_record(
  p_lead jsonb,
  p_receipt jsonb,
  p_periods jsonb,
  p_quote jsonb
)
returns table (
  lead_id uuid,
  receipt_id uuid,
  quote_id uuid,
  folio text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_receipt_id uuid;
  v_quote_id uuid;
  v_folio text;
begin
  if jsonb_typeof(p_lead) <> 'object'
    or jsonb_typeof(p_receipt) <> 'object'
    or jsonb_typeof(p_quote) <> 'object'
    or jsonb_typeof(p_periods) <> 'array'
    or jsonb_array_length(p_periods) < 1
    or jsonb_array_length(p_periods) > 12
  then
    raise exception 'Invalid solar quote payload';
  end if;

  insert into public.solar_leads (
    name,
    phone_e164,
    email,
    municipality,
    postal_code,
    contact_preference,
    privacy_consent_at,
    privacy_notice_version,
    source,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    landing_path,
    referrer,
    metadata
  )
  values (
    p_lead->>'name',
    p_lead->>'phone_e164',
    nullif(p_lead->>'email', ''),
    p_lead->>'municipality',
    nullif(p_lead->>'postal_code', ''),
    coalesce(nullif(p_lead->>'contact_preference', ''), 'whatsapp'),
    (p_lead->>'privacy_consent_at')::timestamptz,
    p_lead->>'privacy_notice_version',
    nullif(p_lead->>'source', ''),
    nullif(p_lead->>'utm_source', ''),
    nullif(p_lead->>'utm_medium', ''),
    nullif(p_lead->>'utm_campaign', ''),
    nullif(p_lead->>'utm_content', ''),
    nullif(p_lead->>'utm_term', ''),
    nullif(p_lead->>'landing_path', ''),
    nullif(p_lead->>'referrer', ''),
    coalesce(p_lead->'metadata', '{}'::jsonb)
  )
  returning id into v_lead_id;

  insert into public.solar_receipts (
    lead_id,
    storage_path,
    mime_type,
    service_number_last4,
    tariff_code,
    billing_frequency,
    latest_bill_date,
    capture_method,
    property_type,
    roof_type,
    metadata
  )
  values (
    v_lead_id,
    nullif(p_receipt->>'storage_path', ''),
    nullif(p_receipt->>'mime_type', ''),
    nullif(p_receipt->>'service_number_last4', ''),
    p_receipt->>'tariff_code',
    p_receipt->>'billing_frequency',
    nullif(p_receipt->>'latest_bill_date', '')::date,
    p_receipt->>'capture_method',
    nullif(p_receipt->>'property_type', ''),
    nullif(p_receipt->>'roof_type', ''),
    coalesce(p_receipt->'metadata', '{}'::jsonb)
  )
  returning id into v_receipt_id;

  insert into public.solar_consumption_periods (
    receipt_id,
    sequence,
    period_start,
    period_end,
    covered_days,
    covered_months,
    kwh,
    amount_mxn,
    demand_kw,
    base_kwh,
    intermediate_kwh,
    peak_kwh
  )
  select
    v_receipt_id,
    period.sequence,
    period.period_start,
    period.period_end,
    period.covered_days,
    period.covered_months,
    period.kwh,
    period.amount_mxn,
    period.demand_kw,
    period.base_kwh,
    period.intermediate_kwh,
    period.peak_kwh
  from jsonb_to_recordset(p_periods) as period (
    sequence smallint,
    period_start date,
    period_end date,
    covered_days smallint,
    covered_months numeric,
    kwh numeric,
    amount_mxn numeric,
    demand_kw numeric,
    base_kwh numeric,
    intermediate_kwh numeric,
    peak_kwh numeric
  );

  insert into public.solar_quotes (
    lead_id,
    receipt_id,
    zone_id,
    config_id,
    expires_at,
    status,
    confidence,
    calculation_version,
    configuration_snapshot,
    input_snapshot,
    result_snapshot,
    total_mxn,
    pdf_storage_path,
    requires_engineering_review
  )
  values (
    v_lead_id,
    v_receipt_id,
    (p_quote->>'zone_id')::uuid,
    (p_quote->>'config_id')::uuid,
    nullif(p_quote->>'expires_at', '')::timestamptz,
    coalesce(
      nullif(p_quote->>'status', '')::public.solar_quote_status,
      'preliminar'::public.solar_quote_status
    ),
    (p_quote->>'confidence')::public.solar_quote_confidence,
    p_quote->>'calculation_version',
    p_quote->'configuration_snapshot',
    p_quote->'input_snapshot',
    p_quote->'result_snapshot',
    nullif(p_quote->>'total_mxn', '')::numeric,
    nullif(p_quote->>'pdf_storage_path', ''),
    coalesce((p_quote->>'requires_engineering_review')::boolean, true)
  )
  returning id, solar_quotes.folio into v_quote_id, v_folio;

  insert into public.solar_quote_events (
    quote_id,
    lead_id,
    event_name,
    metadata
  )
  values (
    v_quote_id,
    v_lead_id,
    'solar_quote_calculated',
    jsonb_build_object(
      'source', coalesce(p_lead->>'source', 'website'),
      'confidence', p_quote->>'confidence'
    )
  );

  return query select v_lead_id, v_receipt_id, v_quote_id, v_folio;
end;
$$;

revoke all on function public.create_solar_quote_record(jsonb, jsonb, jsonb, jsonb)
from public, anon, authenticated;

grant execute on function public.create_solar_quote_record(jsonb, jsonb, jsonb, jsonb)
to service_role;

comment on function public.create_solar_quote_record(jsonb, jsonb, jsonb, jsonb) is
  'Atomically persists a validated solar lead, receipt, periods, quote and initial event. Service role only.';

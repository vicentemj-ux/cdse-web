-- Initial operational catalog for the public solar calculator.
-- The installed price is an editable reference derived from the three supplied
-- competitor proposals. CDSE must validate it before treating it as a firm offer.

insert into public.solar_modules (
  sku,
  brand,
  model,
  watts,
  installed_price_mxn,
  product_warranty_years,
  performance_warranty_years,
  active
) values
  ('CDSE-MONO-550', 'CDSE Selección', 'Monofacial 550 W', 550, 9500, 12, 25, true),
  ('CDSE-MONO-590', 'CDSE Selección', 'Monofacial 590 W', 590, 9500, 12, 25, true),
  ('CDSE-MONO-630', 'CDSE Selección', 'Monofacial 630 W', 630, 9500, 12, 25, true)
on conflict (sku) do update set
  brand = excluded.brand,
  model = excluded.model,
  watts = excluded.watts,
  installed_price_mxn = excluded.installed_price_mxn,
  product_warranty_years = excluded.product_warranty_years,
  performance_warranty_years = excluded.performance_warranty_years,
  active = true;

insert into public.solar_price_options (
  module_id,
  name,
  price_per_panel_mxn,
  min_panels,
  price_includes_vat,
  active
)
select
  module.id,
  'Referencia inicial instalada',
  module.installed_price_mxn,
  1,
  true,
  true
from public.solar_modules as module
where module.sku in ('CDSE-MONO-550', 'CDSE-MONO-590', 'CDSE-MONO-630')
  and not exists (
    select 1
    from public.solar_price_options as price
    where price.module_id = module.id
      and price.name = 'Referencia inicial instalada'
  );

insert into public.solar_calculation_configs (
  name,
  status,
  coverage_target,
  price_mode,
  price_includes_vat,
  vat_rate,
  savings_realization_factor,
  non_offsettable_annual_charges_mxn,
  tariff_escalation_rate,
  annual_panel_degradation_rate,
  projection_years,
  module_id,
  environmental_factors,
  published_at
)
select
  'CDSE Solar - referencia inicial 2026',
  'published',
  1,
  'per_panel',
  true,
  0.16,
  0.95,
  300,
  0.05,
  0.005,
  25,
  module.id,
  jsonb_build_object(
    'pricing_note', 'Referencia editable; validar precio CDSE antes de propuesta firme',
    'source', 'Tres propuestas de competencia entregadas por CDSE'
  ),
  now()
from public.solar_modules as module
where module.sku = 'CDSE-MONO-590'
  and not exists (
    select 1
    from public.solar_calculation_configs
    where status = 'published'
  );

-- Replace commercial family ranges with selectable Growatt models.
-- CDSE keeps a conservative commercial sizing policy of at most 120% DC/AC;
-- final string, voltage and current validation remains part of engineering.

update public.solar_inverters
set active = false
where sku in ('GROWATT-MIC1000-3.3KW', 'GROWATT-MIN2500-6KW');

insert into public.solar_inverters (
  sku, brand, model, inverter_type, ac_capacity_kw, phases, warranty_years, active
) values
  ('GROWATT-MIC-1000TL-X', 'GROWATT', 'MIC 1000TL-X', 'string', 1.0, 1, 10, true),
  ('GROWATT-MIC-1500TL-X', 'GROWATT', 'MIC 1500TL-X', 'string', 1.5, 1, 10, true),
  ('GROWATT-MIC-2000TL-X', 'GROWATT', 'MIC 2000TL-X', 'string', 2.0, 1, 10, true),
  ('GROWATT-MIC-2500TL-X', 'GROWATT', 'MIC 2500TL-X', 'string', 2.5, 1, 10, true),
  ('GROWATT-MIC-3000TL-X', 'GROWATT', 'MIC 3000TL-X', 'string', 3.0, 1, 10, true),
  ('GROWATT-MIC-3300TL-X', 'GROWATT', 'MIC 3300TL-X', 'string', 3.3, 1, 10, true),
  ('GROWATT-MIN-2500TL-X', 'GROWATT', 'MIN 2500TL-X', 'string', 2.5, 1, 10, true),
  ('GROWATT-MIN-3000TL-X', 'GROWATT', 'MIN 3000TL-X', 'string', 3.0, 1, 10, true),
  ('GROWATT-MIN-3600TL-X', 'GROWATT', 'MIN 3600TL-X', 'string', 3.6, 1, 10, true),
  ('GROWATT-MIN-4200TL-X', 'GROWATT', 'MIN 4200TL-X', 'string', 4.2, 1, 10, true),
  ('GROWATT-MIN-4600TL-X', 'GROWATT', 'MIN 4600TL-X', 'string', 4.6, 1, 10, true),
  ('GROWATT-MIN-5000TL-X', 'GROWATT', 'MIN 5000TL-X', 'string', 5.0, 1, 10, true),
  ('GROWATT-MIN-6000TL-X', 'GROWATT', 'MIN 6000TL-X', 'string', 6.0, 1, 10, true)
on conflict (sku) do update set
  brand = excluded.brand,
  model = excluded.model,
  inverter_type = excluded.inverter_type,
  ac_capacity_kw = excluded.ac_capacity_kw,
  phases = excluded.phases,
  warranty_years = excluded.warranty_years,
  active = true;

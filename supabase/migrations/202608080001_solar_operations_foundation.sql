-- CDSE Solar — operational project foundation.
-- Turns an accepted quote into a traceable project with dossier, tasks,
-- audit trail and a commission ledger based on the amount before VAT.

create sequence if not exists public.solar_project_folio_seq start 1;

create table public.solar_projects (
  id uuid primary key default gen_random_uuid(),
  folio_number bigint not null unique default nextval('public.solar_project_folio_seq'),
  folio text generated always as (
    'CDSE-P-' || lpad(folio_number::text, 6, '0')
  ) stored unique,
  quote_id uuid not null unique references public.solar_quotes(id) on delete restrict,
  lead_id uuid not null references public.solar_leads(id) on delete restrict,
  receipt_id uuid references public.solar_receipts(id) on delete restrict,
  seller_user_id uuid references auth.users(id) on delete set null,
  customer_name text not null check (char_length(customer_name) between 2 and 160),
  service_number text,
  status text not null default 'sold_pending_validation' check (status in (
    'sold_pending_validation',
    'site_survey_scheduled',
    'engineering',
    'documents_pending',
    'ready_for_submission',
    'submitted_to_cfe',
    'cfe_observation',
    'approved_for_installation',
    'installation_scheduled',
    'installation_in_progress',
    'installed_pending_interconnection',
    'meter_change_pending',
    'commissioning',
    'operational',
    'on_hold',
    'cancelled'
  )),
  health text not null default 'on_track' check (health in (
    'on_track', 'at_risk', 'blocked', 'overdue'
  )),
  blocked_reason text,
  next_action text,
  site_address jsonb not null default '{}'::jsonb
    check (jsonb_typeof(site_address) = 'object'),
  sold_scope_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sold_scope_snapshot) = 'object'),
  agreed_total_mxn numeric(14, 2) not null check (agreed_total_mxn >= 0),
  price_includes_vat boolean not null default true,
  vat_rate numeric(5, 4) not null default 0.16 check (vat_rate between 0 and 1),
  amount_before_vat_mxn numeric(14, 2) not null check (amount_before_vat_mxn >= 0),
  vat_amount_mxn numeric(14, 2) not null check (vat_amount_mxn >= 0),
  accepted_at timestamptz,
  target_site_survey_at timestamptz,
  target_installation_at timestamptz,
  cfe_tracking_folio text,
  cfe_submitted_at timestamptz,
  meter_changed_at timestamptz,
  commissioned_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    abs((amount_before_vat_mxn + vat_amount_mxn) - agreed_total_mxn) <= 0.02
  )
);

create index solar_projects_status_updated_idx
  on public.solar_projects (status, updated_at desc);
create index solar_projects_seller_updated_idx
  on public.solar_projects (seller_user_id, updated_at desc);
create index solar_projects_cfe_folio_idx
  on public.solar_projects (cfe_tracking_folio)
  where cfe_tracking_folio is not null;

create table public.solar_project_members (
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_role text not null check (project_role in (
    'seller', 'operations', 'engineering', 'installer', 'finance', 'viewer'
  )),
  active boolean not null default true,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id, project_role)
);

create table public.solar_document_requirements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null check (char_length(name) between 3 and 160),
  description text,
  stage text not null check (stage in (
    'commercial', 'site_survey', 'engineering', 'cfe', 'installation', 'handover'
  )),
  requirement_scope text not null check (requirement_scope in (
    'regulatory', 'conditional', 'internal'
  )),
  required_by_default boolean not null default true,
  contains_sensitive_data boolean not null default false,
  retention_policy text,
  regulatory_reference text,
  sort_order integer not null default 100 check (sort_order >= 0),
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.solar_project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  requirement_id uuid references public.solar_document_requirements(id) on delete restrict,
  document_code text not null check (document_code ~ '^[a-z0-9_]+$'),
  title text not null check (char_length(title) between 2 and 200),
  status text not null default 'missing' check (status in (
    'missing', 'requested', 'uploaded', 'approved', 'rejected', 'not_applicable', 'expired'
  )),
  version integer not null default 1 check (version > 0),
  storage_path text unique,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  document_date date,
  expires_at date,
  notes text,
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, document_code, version),
  check (
    (storage_path is null and mime_type is null)
    or (storage_path is not null and mime_type is not null)
  ),
  check (status <> 'rejected' or nullif(trim(rejection_reason), '') is not null),
  check (status not in ('uploaded', 'approved') or storage_path is not null)
);

create index solar_project_documents_project_status_idx
  on public.solar_project_documents (project_id, status, document_code);

create table public.solar_project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  item_code text not null check (item_code ~ '^[a-z0-9_]+$'),
  title text not null check (char_length(title) between 2 and 200),
  stage text not null check (stage in (
    'commercial', 'site_survey', 'engineering', 'cfe', 'installation', 'handover'
  )),
  requirement_scope text not null check (requirement_scope in (
    'regulatory', 'conditional', 'internal'
  )),
  required boolean not null default true,
  status text not null default 'pending' check (status in (
    'pending', 'in_progress', 'complete', 'blocked', 'not_applicable'
  )),
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  evidence_document_id uuid references public.solar_project_documents(id) on delete set null,
  notes text,
  sort_order integer not null default 100 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, item_code),
  check (status <> 'complete' or completed_at is not null)
);

create index solar_project_checklist_project_stage_idx
  on public.solar_project_checklist_items (project_id, stage, status, sort_order);

create table public.solar_project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  task_type text not null check (task_type in (
    'follow_up', 'site_survey', 'customer_document', 'engineering_review',
    'cfe_submission', 'cfe_follow_up', 'installation', 'inspection',
    'meter_change', 'commissioning', 'collection', 'warranty', 'other'
  )),
  title text not null check (char_length(title) between 2 and 200),
  description text,
  status text not null default 'pending' check (status in (
    'pending', 'in_progress', 'completed', 'cancelled', 'blocked'
  )),
  priority text not null default 'normal' check (priority in (
    'low', 'normal', 'high', 'urgent'
  )),
  assigned_to uuid references auth.users(id) on delete set null,
  starts_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  location text,
  waiting_on text check (waiting_on is null or waiting_on in (
    'customer', 'cfe', 'supplier', 'cdse', 'other'
  )),
  reminder_offsets_minutes integer[] not null default array[1440, 120],
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at is null or starts_at is null or due_at >= starts_at),
  check (status <> 'completed' or completed_at is not null)
);

create index solar_project_tasks_assignee_due_idx
  on public.solar_project_tasks (assigned_to, status, due_at);
create index solar_project_tasks_project_due_idx
  on public.solar_project_tasks (project_id, status, due_at);

create table public.solar_commissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.solar_projects(id) on delete restrict,
  seller_user_id uuid not null references auth.users(id) on delete restrict,
  policy_version text not null default 'cdse-operations-v1',
  base_before_vat_mxn numeric(14, 2) not null check (base_before_vat_mxn >= 0),
  rate_percent numeric(5, 2) not null default 0 check (rate_percent between 0 and 10),
  adjustment_mxn numeric(14, 2) not null default 0,
  calculated_amount_mxn numeric(14, 2) generated always as (
    round(base_before_vat_mxn * rate_percent / 100, 2)
  ) stored,
  payable_amount_mxn numeric(14, 2) generated always as (
    greatest(round(base_before_vat_mxn * rate_percent / 100, 2) + adjustment_mxn, 0)
  ) stored,
  status text not null default 'estimated' check (status in (
    'estimated', 'partially_earned', 'earned', 'approved', 'paid', 'void'
  )),
  earned_percent numeric(5, 2) not null default 0 check (earned_percent between 0 and 100),
  requires_review boolean not null default true,
  adjustment_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, seller_user_id),
  check (adjustment_mxn = 0 or nullif(trim(adjustment_reason), '') is not null),
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'paid' or (approved_at is not null and paid_at is not null))
);

create index solar_commissions_seller_status_idx
  on public.solar_commissions (seller_user_id, status, updated_at desc);

create table public.solar_project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  event_name text not null check (char_length(event_name) between 2 and 100),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index solar_project_events_project_created_idx
  on public.solar_project_events (project_id, created_at desc);

create trigger solar_projects_set_updated_at
before update on public.solar_projects
for each row execute function public.set_updated_at();

create trigger solar_document_requirements_set_updated_at
before update on public.solar_document_requirements
for each row execute function public.set_updated_at();

create trigger solar_project_documents_set_updated_at
before update on public.solar_project_documents
for each row execute function public.set_updated_at();

create trigger solar_project_checklist_set_updated_at
before update on public.solar_project_checklist_items
for each row execute function public.set_updated_at();

create trigger solar_project_tasks_set_updated_at
before update on public.solar_project_tasks
for each row execute function public.set_updated_at();

create trigger solar_commissions_set_updated_at
before update on public.solar_commissions
for each row execute function public.set_updated_at();

insert into public.solar_document_requirements (
  code, name, description, stage, requirement_scope, required_by_default,
  contains_sensitive_data, retention_policy, regulatory_reference, sort_order
) values
  ('accepted_quote', 'Cotización aceptada', 'Versión comercial aceptada por el cliente.', 'commercial', 'internal', true, false, 'contractual', null, 10),
  ('validated_cfe_bill', 'Recibo CFE validado', 'Recibo fuente del diagnóstico y datos del servicio.', 'commercial', 'regulatory', true, true, 'project_plus_legal_term', 'Manual de Interconexión 5.1.1(f), cuando aplique', 20),
  ('customer_acceptance', 'Aceptación o contrato CDSE', 'Evidencia de aceptación de alcance, precio y condiciones.', 'commercial', 'internal', true, true, 'contractual', null, 30),
  ('representative_authorization', 'Autorización de representación', 'Carta poder o documento equivalente cuando CDSE o un tercero gestione por el solicitante.', 'commercial', 'conditional', false, true, 'project_plus_legal_term', 'Acreditación de representación, según solicitante/procedimiento', 40),
  ('site_survey_report', 'Levantamiento técnico', 'Datos y evidencia del sitio, tablero, acometida, techo y ruta.', 'site_survey', 'internal', true, false, 'asset_lifetime', null, 100),
  ('location_sketch', 'Croquis de ubicación', 'Ubicación geográfica de la central eléctrica.', 'cfe', 'regulatory', true, false, 'asset_lifetime', 'Manual de Interconexión 5.1.1(b)', 200),
  ('single_line_diagram', 'Diagrama unifilar', 'Diagrama aprobado y controlado por versión.', 'engineering', 'regulatory', true, false, 'asset_lifetime', 'Manual de Interconexión 5.1.1(c)', 210),
  ('module_datasheet', 'Ficha técnica del módulo', 'Ficha de la tecnología de generación utilizada.', 'engineering', 'regulatory', true, false, 'asset_lifetime', 'Manual de Interconexión 5.1.1(d)', 220),
  ('inverter_datasheet', 'Ficha técnica del inversor', 'Ficha del inversor seleccionado en el diseño final.', 'engineering', 'regulatory', true, false, 'asset_lifetime', 'Manual de Interconexión 5.1.1(e)', 230),
  ('inverter_certificate', 'Certificado del inversor', 'Certificado aplicable al modelo instalado.', 'engineering', 'regulatory', true, false, 'asset_lifetime', 'Manual de Interconexión 5.1.1(e)', 240),
  ('interconnection_application', 'Solicitud de interconexión', 'Solicitud y anexos vigentes.', 'cfe', 'regulatory', true, true, 'project_plus_legal_term', 'Manual de Interconexión, Anexo 2', 300),
  ('cfe_acknowledgement', 'Acuse y folio CFE', 'Evidencia de recepción y número de seguimiento.', 'cfe', 'regulatory', true, true, 'project_plus_legal_term', null, 310),
  ('installation_evidence', 'Evidencia de instalación y pruebas', 'Fotografías, controles de calidad y resultados de prueba.', 'installation', 'internal', true, false, 'asset_lifetime', null, 400),
  ('bidirectional_meter_evidence', 'Evidencia de medidor bidireccional', 'Fotografía y datos del equipo de medición instalado.', 'handover', 'regulatory', true, true, 'asset_lifetime', 'Sistema de medición para Generación Distribuida', 500),
  ('handover_certificate', 'Acta de entrega y puesta en marcha', 'Aceptación, monitoreo, manuales y garantías entregadas.', 'handover', 'internal', true, true, 'contractual', null, 510)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  stage = excluded.stage,
  requirement_scope = excluded.requirement_scope,
  required_by_default = excluded.required_by_default,
  contains_sensitive_data = excluded.contains_sensitive_data,
  retention_policy = excluded.retention_policy,
  regulatory_reference = excluded.regulatory_reference,
  sort_order = excluded.sort_order,
  active = true;

create or replace function public.can_access_solar_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.is_solar_admin())
    or exists (
      select 1
      from public.solar_projects project
      where project.id = p_project_id
        and project.seller_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.solar_project_members member
      where member.project_id = p_project_id
        and member.user_id = (select auth.uid())
        and member.active
    );
$$;

revoke all on function public.can_access_solar_project(uuid) from public;
grant execute on function public.can_access_solar_project(uuid) to authenticated;

create or replace function public.provision_solar_project_for_quote(p_quote_id uuid)
returns public.solar_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.solar_quotes;
  v_project public.solar_projects;
  v_customer_name text;
  v_service_number text;
  v_price_includes_vat boolean := true;
  v_vat_rate numeric := 0.16;
  v_before_vat numeric;
  v_vat numeric;
  v_commission_rate numeric := 0;
  v_commission_review boolean := true;
begin
  select * into v_project
  from public.solar_projects
  where quote_id = p_quote_id;

  if v_project.id is not null then
    return v_project;
  end if;

  select * into v_quote
  from public.solar_quotes
  where id = p_quote_id;

  if v_quote.id is null then
    raise exception 'QUOTE_NOT_FOUND';
  end if;

  if v_quote.status <> 'aceptada' then
    raise exception 'ACCEPTED_QUOTE_REQUIRED';
  end if;

  select
    coalesce(nullif(trim(receipt.customer_name), ''), lead.name),
    receipt.service_number
  into v_customer_name, v_service_number
  from public.solar_leads lead
  left join public.solar_receipts receipt on receipt.id = v_quote.receipt_id
  where lead.id = v_quote.lead_id;

  select coalesce(price.price_includes_vat, package.price_includes_vat, true)
  into v_price_includes_vat
  from public.solar_quotes quote
  left join public.solar_price_options price on price.id = quote.price_option_id
  left join public.solar_packages package on package.id = quote.package_id
  where quote.id = p_quote_id;

  if v_price_includes_vat then
    v_before_vat := round(coalesce(v_quote.total_mxn, 0) / (1 + v_vat_rate), 2);
    v_vat := round(coalesce(v_quote.total_mxn, 0) - v_before_vat, 2);
  else
    v_before_vat := round(coalesce(v_quote.total_mxn, 0), 2);
    v_vat := 0;
  end if;

  if v_quote.commission_rate between 0 and 10 then
    v_commission_rate := v_quote.commission_rate;
    v_commission_review := v_commission_rate < 5;
  end if;

  insert into public.solar_projects (
    quote_id, lead_id, receipt_id, seller_user_id, customer_name, service_number,
    sold_scope_snapshot, agreed_total_mxn, price_includes_vat, vat_rate,
    amount_before_vat_mxn, vat_amount_mxn, accepted_at, created_by,
    next_action
  ) values (
    v_quote.id, v_quote.lead_id, v_quote.receipt_id, v_quote.seller_user_id,
    v_customer_name, v_service_number,
    jsonb_build_object(
      'quoteFolio', v_quote.folio,
      'configuration', v_quote.configuration_snapshot,
      'inputs', v_quote.input_snapshot,
      'results', v_quote.result_snapshot,
      'panelCount', v_quote.panel_count,
      'moduleId', v_quote.module_id,
      'inverterId', v_quote.inverter_id,
      'inverterQuantity', v_quote.inverter_quantity,
      'systemType', v_quote.system_type
    ),
    coalesce(v_quote.total_mxn, 0), v_price_includes_vat, v_vat_rate,
    v_before_vat, v_vat, coalesce(v_quote.sold_at, now()),
    coalesce(v_quote.created_by, v_quote.seller_user_id),
    'Validar entrega comercial y programar levantamiento técnico'
  )
  returning * into v_project;

  if v_quote.seller_user_id is not null then
    insert into public.solar_project_members (
      project_id, user_id, project_role, assigned_by
    ) values (
      v_project.id, v_quote.seller_user_id, 'seller', v_project.created_by
    ) on conflict do nothing;

    insert into public.solar_commissions (
      project_id, seller_user_id, base_before_vat_mxn, rate_percent,
      requires_review
    ) values (
      v_project.id, v_quote.seller_user_id, v_before_vat,
      coalesce(v_commission_rate, 0), v_commission_review
    );
  end if;

  insert into public.solar_project_documents (
    project_id, requirement_id, document_code, title, status
  )
  select
    v_project.id, requirement.id, requirement.code, requirement.name,
    case when requirement.required_by_default then 'missing' else 'not_applicable' end
  from public.solar_document_requirements requirement
  where requirement.active;

  insert into public.solar_project_checklist_items (
    project_id, item_code, title, stage, requirement_scope, required,
    status, assigned_to, sort_order
  )
  select
    v_project.id, requirement.code, requirement.name, requirement.stage,
    requirement.requirement_scope, requirement.required_by_default,
    case when requirement.required_by_default then 'pending' else 'not_applicable' end,
    case when requirement.stage = 'commercial' then v_quote.seller_user_id else null end,
    requirement.sort_order
  from public.solar_document_requirements requirement
  where requirement.active;

  insert into public.solar_project_tasks (
    project_id, task_type, title, priority, assigned_to, due_at, created_by
  ) values
    (
      v_project.id, 'follow_up', 'Completar entrega comercial del proyecto',
      'high', v_quote.seller_user_id, now() + interval '1 day', v_project.created_by
    ),
    (
      v_project.id, 'site_survey', 'Programar levantamiento técnico',
      'high', v_quote.seller_user_id, now() + interval '2 days', v_project.created_by
    );

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    v_project.id, 'project_created_from_accepted_quote', v_project.created_by,
    jsonb_build_object(
      'quoteId', v_quote.id,
      'quoteFolio', v_quote.folio,
      'commissionBaseBeforeVatMxn', v_before_vat,
      'commissionRatePercent', v_commission_rate,
      'commissionRequiresReview', v_commission_review
    )
  );

  return v_project;
end;
$$;

revoke all on function public.provision_solar_project_for_quote(uuid) from public;

create or replace function public.create_solar_project_from_quote(p_quote_id uuid)
returns public.solar_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.solar_quotes;
begin
  select * into v_quote
  from public.solar_quotes
  where id = p_quote_id;

  if v_quote.id is null then
    raise exception 'QUOTE_NOT_FOUND';
  end if;

  if not (select public.is_solar_admin()) and (
    v_quote.seller_user_id is distinct from (select auth.uid())
    or not (select public.is_active_solar_seller())
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return public.provision_solar_project_for_quote(p_quote_id);
end;
$$;

revoke all on function public.create_solar_project_from_quote(uuid) from public;
grant execute on function public.create_solar_project_from_quote(uuid) to authenticated;

create or replace function public.create_project_when_quote_is_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'aceptada'
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.provision_solar_project_for_quote(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.create_project_when_quote_is_accepted() from public;

create trigger solar_quotes_create_operational_project
after insert or update of status on public.solar_quotes
for each row execute function public.create_project_when_quote_is_accepted();

do $$
declare
  v_quote_id uuid;
begin
  for v_quote_id in
    select quote.id
    from public.solar_quotes quote
    where quote.status = 'aceptada'
      and not exists (
        select 1 from public.solar_projects project where project.quote_id = quote.id
      )
  loop
    perform public.provision_solar_project_for_quote(v_quote_id);
  end loop;
end;
$$;

alter table public.solar_projects enable row level security;
alter table public.solar_project_members enable row level security;
alter table public.solar_document_requirements enable row level security;
alter table public.solar_project_documents enable row level security;
alter table public.solar_project_checklist_items enable row level security;
alter table public.solar_project_tasks enable row level security;
alter table public.solar_commissions enable row level security;
alter table public.solar_project_events enable row level security;

create policy "project members read projects"
on public.solar_projects for select to authenticated
using ((select public.can_access_solar_project(id)));

create policy "admins manage projects"
on public.solar_projects for all to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "members read project memberships"
on public.solar_project_members for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "admins manage project memberships"
on public.solar_project_members for all to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "staff read document requirements"
on public.solar_document_requirements for select to authenticated
using (
  (select public.is_solar_admin())
  or (select public.is_active_solar_seller())
);

create policy "admins manage document requirements"
on public.solar_document_requirements for all to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "members read project documents"
on public.solar_project_documents for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "members add project documents"
on public.solar_project_documents for insert to authenticated
with check ((select public.can_access_solar_project(project_id)));

create policy "members update project documents"
on public.solar_project_documents for update to authenticated
using ((select public.can_access_solar_project(project_id)))
with check ((select public.can_access_solar_project(project_id)));

create policy "admins delete project documents"
on public.solar_project_documents for delete to authenticated
using ((select public.is_solar_admin()));

create policy "members read project checklist"
on public.solar_project_checklist_items for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "members update project checklist"
on public.solar_project_checklist_items for update to authenticated
using ((select public.can_access_solar_project(project_id)))
with check ((select public.can_access_solar_project(project_id)));

create policy "admins manage project checklist"
on public.solar_project_checklist_items for all to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "members read project tasks"
on public.solar_project_tasks for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "members add project tasks"
on public.solar_project_tasks for insert to authenticated
with check ((select public.can_access_solar_project(project_id)));

create policy "members update project tasks"
on public.solar_project_tasks for update to authenticated
using ((select public.can_access_solar_project(project_id)))
with check ((select public.can_access_solar_project(project_id)));

create policy "admins delete project tasks"
on public.solar_project_tasks for delete to authenticated
using ((select public.is_solar_admin()));

create policy "seller reads own commissions"
on public.solar_commissions for select to authenticated
using (
  seller_user_id = (select auth.uid())
  or (select public.is_solar_admin())
);

create policy "admins manage commissions"
on public.solar_commissions for all to authenticated
using ((select public.is_solar_admin()))
with check ((select public.is_solar_admin()));

create policy "members read project events"
on public.solar_project_events for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "members add project events"
on public.solar_project_events for insert to authenticated
with check ((select public.can_access_solar_project(project_id)));

grant select, insert, update, delete on
  public.solar_projects,
  public.solar_project_members,
  public.solar_document_requirements,
  public.solar_project_documents,
  public.solar_project_checklist_items,
  public.solar_project_tasks,
  public.solar_commissions,
  public.solar_project_events
to authenticated;

grant usage, select on sequence public.solar_project_folio_seq to authenticated;
grant usage, select on sequence public.solar_project_events_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'solar-projects',
  'solar-projects',
  false,
  15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "project members read project files"
on storage.objects for select to authenticated
using (
  bucket_id = 'solar-projects'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (select public.can_access_solar_project(((storage.foldername(name))[1])::uuid))
);

create policy "project members upload project files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'solar-projects'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (select public.can_access_solar_project(((storage.foldername(name))[1])::uuid))
);

create policy "project members update project files"
on storage.objects for update to authenticated
using (
  bucket_id = 'solar-projects'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (select public.can_access_solar_project(((storage.foldername(name))[1])::uuid))
)
with check (
  bucket_id = 'solar-projects'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (select public.can_access_solar_project(((storage.foldername(name))[1])::uuid))
);

create policy "admins delete project files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'solar-projects'
  and (select public.is_solar_admin())
);

comment on table public.solar_projects is
  'Operational record created from an accepted quote; preserves contractual and technical snapshots.';
comment on table public.solar_document_requirements is
  'Versionable dossier catalog separating regulatory, conditional and CDSE internal requirements.';
comment on table public.solar_commissions is
  'Commission ledger based on project amount before VAT. Approval and payment are separate states.';

-- Audit private dossier downloads and locally generated operational resources.

create or replace function public.log_solar_project_access(
  p_project_id uuid,
  p_action text,
  p_document_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.can_access_solar_project(p_project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_action not in (
    'document_opened',
    'site_survey_report_generated',
    'authorization_template_generated',
    'dossier_index_generated',
    'dossier_exported'
  ) then
    raise exception 'INVALID_ACCESS_ACTION';
  end if;

  if p_document_id is not null and not exists (
    select 1
    from public.solar_project_documents document
    where document.id = p_document_id
      and document.project_id = p_project_id
  ) then
    raise exception 'DOCUMENT_PROJECT_MISMATCH';
  end if;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    p_project_id,
    p_action,
    (select auth.uid()),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('documentId', p_document_id)
  );
end;
$$;

revoke all on function public.log_solar_project_access(uuid, text, uuid, jsonb) from public;
grant execute on function public.log_solar_project_access(uuid, text, uuid, jsonb) to authenticated;

comment on function public.log_solar_project_access(uuid, text, uuid, jsonb) is
  'Audits private project document access, generated resources and full dossier exports.';

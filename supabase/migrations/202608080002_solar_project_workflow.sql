-- CDSE Solar — controlled dossier and agenda workflow.
-- Replaces broad member writes with audited RPCs for document registration,
-- review, applicability, project stage and task completion.

drop policy if exists "members add project documents" on public.solar_project_documents;
drop policy if exists "members update project documents" on public.solar_project_documents;
drop policy if exists "members add project tasks" on public.solar_project_tasks;
drop policy if exists "members update project tasks" on public.solar_project_tasks;

create table public.solar_project_document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.solar_project_documents(id) on delete cascade,
  project_id uuid not null references public.solar_projects(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  )),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 15728640),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index solar_project_document_files_document_idx
  on public.solar_project_document_files (document_id, created_at);

alter table public.solar_project_document_files enable row level security;

create policy "members read project document files"
on public.solar_project_document_files for select to authenticated
using ((select public.can_access_solar_project(project_id)));

create policy "admins delete project document files"
on public.solar_project_document_files for delete to authenticated
using ((select public.is_solar_admin()));

grant select, delete on public.solar_project_document_files to authenticated;

create or replace function public.register_solar_project_document_upload(
  p_document_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_original_name text default 'archivo'
)
returns public.solar_project_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.solar_project_documents;
  v_result public.solar_project_documents;
  v_version integer;
begin
  select * into v_document
  from public.solar_project_documents
  where id = p_document_id;

  if v_document.id is null then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if not (select public.can_access_solar_project(v_document.project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_storage_path is null
    or p_storage_path !~ ('^' || v_document.project_id::text || '/') then
    raise exception 'INVALID_STORAGE_PATH';
  end if;

  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'UNSUPPORTED_DOCUMENT_TYPE';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 15728640 then
    raise exception 'INVALID_FILE_SIZE';
  end if;

  if v_document.status = 'not_applicable' then
    raise exception 'DOCUMENT_NOT_APPLICABLE';
  end if;

  if v_document.storage_path is null and v_document.status <> 'approved' then
    update public.solar_project_documents
    set
      status = 'uploaded',
      storage_path = p_storage_path,
      mime_type = p_mime_type,
      file_size_bytes = p_file_size_bytes,
      uploaded_by = (select auth.uid()),
      reviewed_by = null,
      reviewed_at = null,
      rejection_reason = null
    where id = v_document.id
    returning * into v_result;
  elsif v_document.status = 'uploaded' then
    v_result := v_document;
  else
    select coalesce(max(version), 0) + 1 into v_version
    from public.solar_project_documents
    where project_id = v_document.project_id
      and document_code = v_document.document_code;

    insert into public.solar_project_documents (
      project_id, requirement_id, document_code, title, status, version,
      storage_path, mime_type, file_size_bytes, uploaded_by
    ) values (
      v_document.project_id, v_document.requirement_id, v_document.document_code,
      v_document.title, 'uploaded', v_version, p_storage_path, p_mime_type,
      p_file_size_bytes, (select auth.uid())
    ) returning * into v_result;
  end if;

  insert into public.solar_project_document_files (
    document_id, project_id, storage_path, original_name, mime_type,
    file_size_bytes, uploaded_by
  ) values (
    v_result.id, v_result.project_id, p_storage_path,
    left(coalesce(nullif(trim(p_original_name), ''), 'archivo'), 255),
    p_mime_type, p_file_size_bytes, (select auth.uid())
  );

  update public.solar_project_checklist_items
  set
    status = 'in_progress',
    evidence_document_id = v_result.id,
    completed_at = null,
    completed_by = null
  where project_id = v_document.project_id
    and item_code = v_document.document_code;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    v_document.project_id, 'project_document_uploaded', (select auth.uid()),
    jsonb_build_object(
      'documentId', v_result.id,
      'documentCode', v_result.document_code,
      'version', v_result.version,
      'mimeType', p_mime_type,
      'fileSizeBytes', p_file_size_bytes
    )
  );

  return v_result;
end;
$$;

revoke all on function public.register_solar_project_document_upload(uuid, text, text, bigint, text) from public;
grant execute on function public.register_solar_project_document_upload(uuid, text, text, bigint, text) to authenticated;

create or replace function public.review_solar_project_document(
  p_document_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns public.solar_project_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.solar_project_documents;
  v_scope text;
begin
  if not (select public.is_solar_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_decision not in ('approved', 'rejected', 'not_applicable') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;

  select document.*
  into v_document
  from public.solar_project_documents document
  where document.id = p_document_id;

  select requirement.requirement_scope into v_scope
  from public.solar_document_requirements requirement
  where requirement.id = v_document.requirement_id;

  if v_document.id is null then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if p_decision = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  if p_decision in ('approved', 'rejected') and v_document.storage_path is null then
    raise exception 'UPLOADED_DOCUMENT_REQUIRED';
  end if;

  if p_decision = 'not_applicable' and v_scope <> 'conditional' then
    raise exception 'ONLY_CONDITIONAL_DOCUMENTS_CAN_BE_NOT_APPLICABLE';
  end if;

  update public.solar_project_documents
  set
    status = p_decision,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    rejection_reason = case
      when p_decision = 'rejected' then trim(p_rejection_reason)
      else null
    end
  where id = v_document.id
  returning * into v_document;

  update public.solar_project_checklist_items
  set
    required = case when p_decision = 'not_applicable' then false else required end,
    status = case
      when p_decision = 'approved' then 'complete'
      when p_decision = 'not_applicable' then 'not_applicable'
      else 'blocked'
    end,
    completed_at = case when p_decision = 'approved' then now() else null end,
    completed_by = case when p_decision = 'approved' then (select auth.uid()) else null end,
    evidence_document_id = v_document.id,
    notes = case
      when p_decision = 'rejected' then trim(p_rejection_reason)
      else notes
    end
  where project_id = v_document.project_id
    and item_code = v_document.document_code;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    v_document.project_id, 'project_document_reviewed', (select auth.uid()),
    jsonb_build_object(
      'documentId', v_document.id,
      'documentCode', v_document.document_code,
      'decision', p_decision,
      'reason', p_rejection_reason
    )
  );

  return v_document;
end;
$$;

revoke all on function public.review_solar_project_document(uuid, text, text) from public;
grant execute on function public.review_solar_project_document(uuid, text, text) to authenticated;

create or replace function public.set_solar_document_applicability(
  p_document_id uuid,
  p_applies boolean
)
returns public.solar_project_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.solar_project_documents;
  v_scope text;
begin
  if not (select public.is_solar_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select document.*
  into v_document
  from public.solar_project_documents document
  where document.id = p_document_id;

  select requirement.requirement_scope into v_scope
  from public.solar_document_requirements requirement
  where requirement.id = v_document.requirement_id;

  if v_document.id is null then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if v_scope <> 'conditional' then
    raise exception 'ONLY_CONDITIONAL_DOCUMENTS_CAN_CHANGE_APPLICABILITY';
  end if;

  update public.solar_project_documents
  set
    status = case
      when p_applies and storage_path is not null then 'uploaded'
      when p_applies then 'missing'
      else 'not_applicable'
    end,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    rejection_reason = null
  where id = v_document.id
  returning * into v_document;

  update public.solar_project_checklist_items
  set
    required = p_applies,
    status = case
      when not p_applies then 'not_applicable'
      when v_document.storage_path is not null then 'in_progress'
      else 'pending'
    end,
    completed_at = null,
    completed_by = null
  where project_id = v_document.project_id
    and item_code = v_document.document_code;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    v_document.project_id, 'project_document_applicability_changed', (select auth.uid()),
    jsonb_build_object(
      'documentId', v_document.id,
      'documentCode', v_document.document_code,
      'applies', p_applies
    )
  );

  return v_document;
end;
$$;

revoke all on function public.set_solar_document_applicability(uuid, boolean) from public;
grant execute on function public.set_solar_document_applicability(uuid, boolean) to authenticated;

create or replace function public.create_solar_project_task(
  p_project_id uuid,
  p_title text,
  p_task_type text default 'other',
  p_due_at timestamptz default null,
  p_assigned_to uuid default null,
  p_priority text default 'normal',
  p_description text default null
)
returns public.solar_project_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.solar_project_tasks;
  v_assignee uuid := coalesce(p_assigned_to, (select auth.uid()));
begin
  if not (select public.can_access_solar_project(p_project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 200 then
    raise exception 'INVALID_TASK_TITLE';
  end if;

  if p_task_type not in (
    'follow_up', 'site_survey', 'customer_document', 'engineering_review',
    'cfe_submission', 'cfe_follow_up', 'installation', 'inspection',
    'meter_change', 'commissioning', 'collection', 'warranty', 'other'
  ) then
    raise exception 'INVALID_TASK_TYPE';
  end if;

  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'INVALID_TASK_PRIORITY';
  end if;

  if v_assignee is distinct from (select auth.uid())
    and not (select public.is_solar_admin())
    and not exists (
      select 1 from public.solar_project_members member
      where member.project_id = p_project_id
        and member.user_id = v_assignee
        and member.active
    ) then
    raise exception 'INVALID_TASK_ASSIGNEE';
  end if;

  insert into public.solar_project_tasks (
    project_id, task_type, title, description, priority, assigned_to,
    due_at, created_by
  ) values (
    p_project_id, p_task_type, trim(p_title), nullif(trim(p_description), ''),
    p_priority, v_assignee, p_due_at, (select auth.uid())
  ) returning * into v_task;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    p_project_id, 'project_task_created', (select auth.uid()),
    jsonb_build_object(
      'taskId', v_task.id,
      'taskType', v_task.task_type,
      'assignedTo', v_task.assigned_to,
      'dueAt', v_task.due_at
    )
  );

  return v_task;
end;
$$;

revoke all on function public.create_solar_project_task(uuid, text, text, timestamptz, uuid, text, text) from public;
grant execute on function public.create_solar_project_task(uuid, text, text, timestamptz, uuid, text, text) to authenticated;

create or replace function public.complete_solar_project_task(p_task_id uuid)
returns public.solar_project_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.solar_project_tasks;
begin
  select * into v_task
  from public.solar_project_tasks
  where id = p_task_id;

  if v_task.id is null then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if not (select public.can_access_solar_project(v_task.project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if v_task.assigned_to is distinct from (select auth.uid())
    and not (select public.is_solar_admin()) then
    raise exception 'TASK_ASSIGNEE_OR_ADMIN_REQUIRED';
  end if;

  update public.solar_project_tasks
  set status = 'completed', completed_at = now()
  where id = v_task.id
  returning * into v_task;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    v_task.project_id, 'project_task_completed', (select auth.uid()),
    jsonb_build_object('taskId', v_task.id, 'taskType', v_task.task_type)
  );

  return v_task;
end;
$$;

revoke all on function public.complete_solar_project_task(uuid) from public;
grant execute on function public.complete_solar_project_task(uuid) to authenticated;

create or replace function public.update_solar_project_operations(
  p_project_id uuid,
  p_status text,
  p_health text,
  p_next_action text,
  p_blocked_reason text default null,
  p_cfe_tracking_folio text default null,
  p_target_site_survey_at timestamptz default null,
  p_target_installation_at timestamptz default null
)
returns public.solar_projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.solar_projects;
  v_old_status text;
begin
  if not (select public.is_solar_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_status not in (
    'sold_pending_validation', 'site_survey_scheduled', 'engineering',
    'documents_pending', 'ready_for_submission', 'submitted_to_cfe',
    'cfe_observation', 'approved_for_installation', 'installation_scheduled',
    'installation_in_progress', 'installed_pending_interconnection',
    'meter_change_pending', 'commissioning', 'operational', 'on_hold', 'cancelled'
  ) then
    raise exception 'INVALID_PROJECT_STATUS';
  end if;

  if p_health not in ('on_track', 'at_risk', 'blocked', 'overdue') then
    raise exception 'INVALID_PROJECT_HEALTH';
  end if;

  if p_health = 'blocked' and nullif(trim(p_blocked_reason), '') is null then
    raise exception 'BLOCKED_REASON_REQUIRED';
  end if;

  select status into v_old_status
  from public.solar_projects
  where id = p_project_id;

  if v_old_status is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  update public.solar_projects
  set
    status = p_status,
    health = p_health,
    next_action = nullif(trim(p_next_action), ''),
    blocked_reason = case when p_health = 'blocked' then trim(p_blocked_reason) else null end,
    cfe_tracking_folio = nullif(trim(p_cfe_tracking_folio), ''),
    cfe_submitted_at = case
      when p_status = 'submitted_to_cfe' then coalesce(cfe_submitted_at, now())
      else cfe_submitted_at
    end,
    target_site_survey_at = p_target_site_survey_at,
    target_installation_at = p_target_installation_at,
    meter_changed_at = case
      when p_status in ('commissioning', 'operational') then coalesce(meter_changed_at, now())
      else meter_changed_at
    end,
    commissioned_at = case
      when p_status = 'operational' then coalesce(commissioned_at, now())
      else commissioned_at
    end
  where id = p_project_id
  returning * into v_project;

  insert into public.solar_project_events (
    project_id, event_name, actor_user_id, metadata
  ) values (
    p_project_id, 'project_operations_updated', (select auth.uid()),
    jsonb_build_object(
      'previousStatus', v_old_status,
      'status', p_status,
      'health', p_health,
      'nextAction', p_next_action,
      'cfeTrackingFolio', p_cfe_tracking_folio
    )
  );

  return v_project;
end;
$$;

revoke all on function public.update_solar_project_operations(uuid, text, text, text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.update_solar_project_operations(uuid, text, text, text, text, text, timestamptz, timestamptz) to authenticated;

comment on function public.register_solar_project_document_upload(uuid, text, text, bigint, text) is
  'Registers an already-uploaded private project file, versions replacements and advances its checklist item.';
comment on function public.review_solar_project_document(uuid, text, text) is
  'Admin-only document review that synchronizes the operational checklist and audit trail.';

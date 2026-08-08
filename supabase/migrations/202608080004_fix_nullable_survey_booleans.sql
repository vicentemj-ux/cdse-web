-- Allow draft surveys to keep binary inspection fields unanswered.

create or replace function public.save_solar_site_survey(
  p_project_id uuid,
  p_survey jsonb,
  p_submit boolean default false
)
returns public.solar_site_surveys
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survey public.solar_site_surveys;
  v_version integer;
begin
  if not (select public.can_access_solar_project(p_project_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_survey
  from public.solar_site_surveys
  where project_id = p_project_id
    and status in ('draft', 'rejected')
  order by version desc
  limit 1;

  if v_survey.id is null then
    select coalesce(max(version), 0) + 1 into v_version
    from public.solar_site_surveys
    where project_id = p_project_id;

    insert into public.solar_site_surveys (project_id, version, created_by)
    values (p_project_id, v_version, (select auth.uid()))
    returning * into v_survey;
  end if;

  update public.solar_site_surveys
  set
    visited_at = nullif(p_survey->>'visitedAt', '')::timestamptz,
    technician_user_id = coalesce(nullif(p_survey->>'technicianUserId', '')::uuid, (select auth.uid())),
    latitude = nullif(p_survey->>'latitude', '')::numeric,
    longitude = nullif(p_survey->>'longitude', '')::numeric,
    roof_type = nullif(p_survey->>'roofType', ''),
    roof_condition = nullif(p_survey->>'roofCondition', ''),
    usable_area_m2 = nullif(p_survey->>'usableAreaM2', '')::numeric,
    orientation_degrees = nullif(p_survey->>'orientationDegrees', '')::numeric,
    tilt_degrees = nullif(p_survey->>'tiltDegrees', '')::numeric,
    shading_level = nullif(p_survey->>'shadingLevel', ''),
    electrical_service = nullif(p_survey->>'electricalService', ''),
    service_voltage = nullif(p_survey->>'serviceVoltage', '')::integer,
    main_breaker_amps = nullif(p_survey->>'mainBreakerAmps', '')::numeric,
    panelboard_condition = nullif(p_survey->>'panelboardCondition', ''),
    grounding_available = case when nullif(p_survey->>'groundingAvailable', '') is not null then (p_survey->>'groundingAvailable')::boolean else null end,
    meter_accessible = case when nullif(p_survey->>'meterAccessible', '') is not null then (p_survey->>'meterAccessible')::boolean else null end,
    route_length_m = nullif(p_survey->>'routeLengthM', '')::numeric,
    structure_notes = nullif(trim(p_survey->>'structureNotes'), ''),
    electrical_notes = nullif(trim(p_survey->>'electricalNotes'), ''),
    safety_notes = nullif(trim(p_survey->>'safetyNotes'), ''),
    general_notes = nullif(trim(p_survey->>'generalNotes'), ''),
    status = case when p_submit then 'submitted' else 'draft' end,
    submitted_by = case when p_submit then (select auth.uid()) else null end,
    submitted_at = case when p_submit then now() else null end,
    reviewed_by = null,
    reviewed_at = null,
    rejection_reason = null
  where id = v_survey.id
  returning * into v_survey;

  if p_submit and (
    v_survey.visited_at is null
    or v_survey.roof_type is null
    or v_survey.roof_condition is null
    or v_survey.usable_area_m2 is null
    or v_survey.shading_level is null
    or v_survey.electrical_service is null
    or v_survey.service_voltage is null
    or v_survey.main_breaker_amps is null
    or v_survey.panelboard_condition is null
    or v_survey.grounding_available is null
    or v_survey.meter_accessible is null
    or v_survey.route_length_m is null
  ) then
    raise exception 'INCOMPLETE_SITE_SURVEY';
  end if;

  insert into public.solar_project_events (project_id, event_name, actor_user_id, metadata)
  values (
    p_project_id,
    case when p_submit then 'site_survey_submitted' else 'site_survey_saved' end,
    (select auth.uid()),
    jsonb_build_object('surveyId', v_survey.id, 'version', v_survey.version)
  );

  return v_survey;
end;
$$;

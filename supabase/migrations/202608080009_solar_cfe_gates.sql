-- Separate pre-submission readiness from post-submission closure evidence.

create or replace function public.get_solar_project_readiness(p_project_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_survey_approved boolean; v_engineering_approved boolean; v_missing_documents jsonb; v_missing_count integer;
begin
  if not (select public.can_access_solar_project(p_project_id)) then raise exception 'NOT_AUTHORIZED'; end if;
  select exists(select 1 from public.solar_site_surveys where project_id=p_project_id and status='approved') into v_survey_approved;
  select exists(select 1 from public.solar_engineering_revisions where project_id=p_project_id and status='approved') into v_engineering_approved;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('code',checklist.item_code,'title',checklist.title,'stage',checklist.stage,'status',checklist.status) order by checklist.sort_order),'[]'::jsonb)
  into v_missing_count,v_missing_documents
  from public.solar_project_checklist_items checklist
  where checklist.project_id=p_project_id and checklist.required
    and checklist.stage in ('commercial','site_survey','engineering','cfe')
    and checklist.item_code not in ('cfe_acknowledgement','cfe_response','interconnection_contract','compensation_contract')
    and checklist.status<>'complete';
  return jsonb_build_object('siteSurveyApproved',v_survey_approved,'engineeringApproved',v_engineering_approved,'missingDocumentCount',v_missing_count,'missingDocuments',v_missing_documents,'readyForCfe',v_survey_approved and v_engineering_approved and v_missing_count=0);
end;
$$;

create or replace function public.validate_solar_cfe_case_gates()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_readiness jsonb; v_missing_close integer;
begin
  if new.status not in ('draft','cancelled') and (tg_op='INSERT' or old.status='draft') then
    v_readiness := public.get_solar_project_readiness(new.project_id);
    if not coalesce((v_readiness->>'readyForCfe')::boolean,false) then raise exception 'PROJECT_NOT_READY_FOR_CFE'; end if;
  end if;
  if new.status in ('interconnected','closed') then
    select count(*) into v_missing_close from public.solar_project_checklist_items
    where project_id=new.project_id
      and item_code in ('cfe_response','interconnection_contract','compensation_contract','bidirectional_meter_evidence')
      and status<>'complete';
    if v_missing_close>0 then raise exception 'CFE_CLOSURE_DOCUMENTS_REQUIRED'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_solar_cfe_case_gates on public.solar_cfe_cases;
create trigger validate_solar_cfe_case_gates before insert or update on public.solar_cfe_cases
for each row execute function public.validate_solar_cfe_case_gates();


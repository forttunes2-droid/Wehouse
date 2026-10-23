create or replace function private.notify_experience_evidence_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare activity public.experience_activities; event_id uuid; recipient text; host_state text; subject text; status text; event_key text;
begin
 if tg_table_name='experience_activities' then
  if new.credential_revision=old.credential_revision then return new;end if;
  activity:=new;subject:=new.id::text;status:='required';event_key:=new.credential_revision::text;
 else
  if new.status=old.status then return new;end if;
  if new.status not in ('submitted','approved','correction_required','rejected','abandoned') then return new;end if;
  select * into activity from public.experience_activities where id=new.activity_id;
  subject:=new.id::text;status:=new.status;event_key:=new.status||':'||coalesce(new.reviewed_at,new.submitted_at,new.created_at)::text;
 end if;
 select state into host_state from public.profiles where user_id=activity.host_user_id;
 perform private.resolve_subject_activity('experience_evidence',subject,null,null);
 if private.experience_evidence_current(activity.id) then
  perform private.resolve_subject_activity('experience_evidence',activity.id::text,null,null);
 end if;
 if status='abandoned' then return new;end if;
 event_id:=private.upsert_activity_event('experience_evidence:'||subject||':'||event_key,
  'experience.evidence.'||status,'experience_evidence',subject,public.current_profile_user_id(),
  case status when 'required' then 'Experience evidence requirements updated' when 'submitted' then 'Experience evidence submitted' when 'approved' then 'Experience evidence approved' else 'Experience evidence needs attention' end,
  'Open the activity to see its document requirements and review notes.',
  case when status='submitted' then 'experience_review' else 'experience_application' end,
  jsonb_build_object('context_id',activity.id),now());
 if status='submitted' then
  for recipient in select distinct w.user_id from public.workspace_role_assignments w where w.workspace_role='creator' and w.status='active' and w.revoked_at is null and w.user_id<>activity.host_user_id and public.user_has_active_workspace(w.user_id,'creator') loop
   perform private.add_activity_audience(event_id,recipient,'creator','services',host_state,true);
  end loop;
 else
  perform private.add_activity_audience(event_id,activity.host_user_id,'worker','services',host_state,status in ('required','correction_required','rejected') and not private.experience_evidence_current(activity.id));
 end if;
 return new;
end $$;
revoke all on function private.notify_experience_evidence_activity() from public,anon,authenticated;

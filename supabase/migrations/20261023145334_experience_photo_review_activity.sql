create function private.notify_experience_photo_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare activity public.experience_activities; event_id uuid; host_state text;
begin
 if new.revision=old.revision then return new;end if;
 perform private.resolve_subject_activity('experience_photo',new.id::text,null,null);
 if new.status not in ('approved','rejected') then return new;end if;
 select * into activity from public.experience_activities where id=new.activity_id;
 select state into host_state from public.profiles where user_id=activity.host_user_id;
 event_id:=private.upsert_activity_event('experience_photo_review:'||new.id::text||':'||new.revision::text,
  'experience.photo.'||new.status,'experience_photo',new.id::text,new.reviewed_by,
  case when new.status='approved' then 'Experience photo approved' else 'Experience photo needs replacement' end,
  case when new.status='approved' then 'Photo approval does not publish the activity. Open the application to see the review.' else 'Open the review note. Withdraw the application before replacing the photo or resubmitting it against revised details.' end,
  'experience_application',jsonb_build_object('context_id',activity.id),now());
 perform private.add_activity_audience(event_id,activity.host_user_id,'worker','services',host_state,new.status='rejected');
 return new;
end $$;
revoke all on function private.notify_experience_photo_review() from public,anon,authenticated;
create trigger experience_photo_review_activity after update on public.experience_activity_photos for each row execute function private.notify_experience_photo_review();

create function private.resolve_closed_experience_photos() returns trigger
language plpgsql security definer set search_path='' as $$
declare photo_id uuid;
begin
 if new.status is distinct from old.status and new.status in ('declined','archived') then
  for photo_id in select id from public.experience_activity_photos where activity_id=new.id loop
   perform private.resolve_subject_activity('experience_photo',photo_id::text,null,null);
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.resolve_closed_experience_photos() from public,anon,authenticated;
create trigger experience_photo_closed_activity after update of status on public.experience_activities for each row execute function private.resolve_closed_experience_photos();

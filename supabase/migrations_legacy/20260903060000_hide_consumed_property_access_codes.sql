create or replace function public.clear_consumed_property_access_code()
returns trigger
language plpgsql
security invoker
set search_path = 'pg_catalog','public'
as $$
begin
  if new.access_evidence_status in ('submitted','verified')
     or new.access_evidence_video_path is not null
     or new.published_at is not null then
    new.access_challenge_code := null;
    new.access_challenge_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_consumed_property_access_code on public.inspection_requests;
create trigger clear_consumed_property_access_code
before insert or update of access_evidence_status,access_evidence_video_path,published_at
on public.inspection_requests
for each row execute function public.clear_consumed_property_access_code();

revoke all on function public.clear_consumed_property_access_code() from public,anon,authenticated;

update public.inspection_requests
set access_challenge_code=null,
    access_challenge_expires_at=null,
    updated_at=now()
where access_challenge_code is not null
  and (
    access_evidence_status in ('submitted','verified')
    or access_evidence_video_path is not null
    or completed_at is not null
    or draft_listing_id is not null
    or draft_hotel_id is not null
    or published_at is not null
  );

create or replace function public.get_property_access_review_details(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare
  v_actor public.profiles;
  v_request public.inspection_requests;
  v_code text;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text
    and role in ('creator','admin') and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Authorized property reviewer required'; end if;
  select * into v_request from public.inspection_requests where id=p_request_id;
  if v_request.id is null then raise exception 'Property request not found'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_request.property_state,v_request.property_city) then raise exception 'Property is outside your assigned area'; end if;
  select c.code into v_code
  from public.property_access_challenges c
  where c.request_id=v_request.id and c.status='consumed'
  order by c.consumed_at desc nulls last
  limit 1;
  return jsonb_build_object(
    'status',v_request.access_evidence_status,
    'video_path',v_request.access_evidence_video_path,
    'submitted_at',v_request.access_evidence_submitted_at,
    'code',v_code
  );
end $$;
revoke all on function public.get_property_access_review_details(uuid) from public,anon;
grant execute on function public.get_property_access_review_details(uuid) to authenticated;

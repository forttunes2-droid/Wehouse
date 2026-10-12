-- Hotel-chat reports resolve the other party on the server and require access to that conversation.
create or replace function public.hotel_chat_report_target(p_conversation_id uuid)
returns table(user_id text, display_name text) language sql stable security definer set search_path to 'pg_catalog','public' as $$
  select p.user_id, coalesce(nullif(p.full_name,''),'this person')
  from public.hotel_booking_conversations c join public.hotels h on h.id=c.hotel_id
  join public.profiles a on a.auth_id=(select auth.uid())::text
  join public.profiles p on p.user_id=case when c.guest_user_id=a.user_id then h.owner_id else c.guest_user_id end
  where c.id=p_conversation_id and public.can_access_hotel_booking_conversation(c.id) limit 1 $$;
revoke all on function public.hotel_chat_report_target(uuid) from public, anon;
grant execute on function public.hotel_chat_report_target(uuid) to authenticated;
create or replace function public.report_content(p_subject_type text,p_subject_user_id text,p_reason text,p_details text default null,p_subject_ref text default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare a public.profiles; s public.profiles; v_id uuid; lo text; hi text;
begin
  select * into a from public.profiles p where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false) limit 1;
  if a.user_id is null then raise exception 'Sign in to report'; end if;
  select * into s from public.profiles p where p.user_id=p_subject_user_id and not coalesce(p.deleted,false) limit 1;
  if s.user_id is null or s.user_id=a.user_id then raise exception 'Invalid report'; end if;
  if p_reason is null or p_reason not in ('spam','harassment','scam','unsafe','inappropriate','other') then raise exception 'Choose a report reason'; end if;
  if p_subject_type='roommate_chat' and not exists(select 1 from public.conversations c where c.conversation_type='roommate'
     and a.user_id in(c.participant_a,c.participant_b) and s.user_id in(c.participant_a,c.participant_b)) then
    raise exception 'You can only report people you have a roommate conversation with'; end if;
  if p_subject_type='worker_chat' and not exists(select 1 from public.booking_conversations c
     where a.user_id in(c.user_id,c.worker_id) and s.user_id in(c.user_id,c.worker_id)) then
    raise exception 'You can only report people you have a worker conversation with'; end if;
  if p_subject_type='hotel_chat' and not exists(select 1 from public.hotel_booking_conversations c join public.hotels h on h.id=c.hotel_id
     where c.id::text=p_subject_ref and public.can_access_hotel_booking_conversation(c.id)
       and s.user_id=case when c.guest_user_id=a.user_id then h.owner_id else c.guest_user_id end) then
    raise exception 'You can only report the other side of your own hotel conversation'; end if;
  if p_subject_type='companion_chat' then
    lo:=least(a.user_id,s.user_id); hi:=greatest(a.user_id,s.user_id);
    if not exists(select 1 from public.companions c where c.user_low=lo and c.user_high=hi) then
      raise exception 'You can only report your own Companions'; end if;
  end if;
  insert into public.content_reports(reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key)
  values(a.user_id,s.user_id,p_subject_type,left(p_subject_ref,200),p_reason,nullif(left(btrim(coalesce(p_details,'')),1000),''),public.wehouse_state_key(s.state))
  returning id into v_id;
  return v_id;
end $$;


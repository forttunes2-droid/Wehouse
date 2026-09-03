create or replace function public.get_my_received_roommate_interests()
returns table(interest_id uuid,sender_user_id text,match_score integer,sent_at timestamptz,username text,full_name text,avatar_url text,city text,state text,school text,bio text)
language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare v_actor public.profiles;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role<>'user' or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Active regular user required'; end if;
  return query
  select incoming.id,incoming.searcher_id,incoming.match_score,incoming.updated_at,sender.username,sender.full_name,sender.avatar_url,sender.city,sender.state,coalesce(sender_prefs.school_name,sender.school),sender.bio
  from public.roommate_search_results incoming
  join public.profiles sender on sender.user_id=incoming.searcher_id
  left join public.roommate_preferences sender_prefs on sender_prefs.user_id=sender.user_id
  left join public.roommate_search_results response on response.searcher_id=v_actor.user_id and response.matched_user_id=incoming.searcher_id
  where incoming.matched_user_id=v_actor.user_id and incoming.status='accepted'
    and coalesce(response.status,'new') not in ('accepted','declined')
    and not coalesce(sender.deleted,false) and not coalesce(sender.suspended,false) and not coalesce(sender.banned,false)
    and coalesce(sender.privacy_profile_visible,true)
    and not exists(select 1 from public.conversations c where c.conversation_type='roommate' and c.status='active' and ((c.participant_a=v_actor.user_id and c.participant_b=incoming.searcher_id) or (c.participant_b=v_actor.user_id and c.participant_a=incoming.searcher_id)))
  order by incoming.updated_at desc;
end $function$;
revoke all on function public.get_my_received_roommate_interests() from public,anon;
grant execute on function public.get_my_received_roommate_interests() to authenticated,service_role;

create or replace function public.respond_to_my_roommate_interest(p_interest_id uuid,p_response text)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare v_actor public.profiles;v_interest public.roommate_search_results;v_conv uuid;
begin
  if p_response not in ('accepted','declined') then raise exception 'Response must be accepted or declined'; end if;
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role<>'user' or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Active regular user required'; end if;
  select * into v_interest from public.roommate_search_results where id=p_interest_id and matched_user_id=v_actor.user_id and status='accepted' for update;
  if v_interest is null then raise exception 'Roommate interest not found'; end if;
  insert into public.roommate_search_results(searcher_id,matched_user_id,match_score,status,created_at,updated_at)
  values(v_actor.user_id,v_interest.searcher_id,v_interest.match_score,p_response,now(),now())
  on conflict(searcher_id,matched_user_id) do update set status=excluded.status,updated_at=now();
  update public.notifications set read=true where recipient_id=v_actor.user_id and type='roommate_interest' and related_id=v_interest.id::text;
  if p_response='accepted' then
    select c.id into v_conv from public.conversations c where c.conversation_type='roommate' and ((c.participant_a=v_actor.user_id and c.participant_b=v_interest.searcher_id) or (c.participant_b=v_actor.user_id and c.participant_a=v_interest.searcher_id)) limit 1;
    if v_conv is null then insert into public.conversations(participant_a,participant_b,status,conversation_type,subject,created_at,last_message_at,unread_a,unread_b) values(v_actor.user_id,v_interest.searcher_id,'active','roommate','Roommate Match',now(),now(),0,0) returning id into v_conv; end if;
    insert into public.notifications(recipient_id,type,title,message,related_id,read)
    select v_interest.searcher_id,'roommate_match','Roommate interest accepted',coalesce(nullif(v_actor.full_name,''),nullif(v_actor.username,''),'Your match')||' accepted your interest. You can now chat.',v_conv::text,false
    where not exists(select 1 from public.notifications n where n.recipient_id=v_interest.searcher_id and n.type='roommate_match' and n.related_id=v_conv::text);
  end if;
  return v_conv;
end $function$;
revoke all on function public.respond_to_my_roommate_interest(uuid,text) from public,anon;
grant execute on function public.respond_to_my_roommate_interest(uuid,text) to authenticated,service_role;

create or replace function public.update_my_roommate_match_status(p_match_id uuid,p_status text)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare v_actor public.profiles;v_match public.roommate_search_results;v_reverse public.roommate_search_results;v_conv uuid;v_status text;
begin
  if p_status not in ('new','viewed','accepted','declined') then raise exception 'Invalid match status'; end if;
  v_status:=case when p_status='declined' then 'viewed' else p_status end;
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role<>'user' or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Active regular user required'; end if;
  select * into v_match from public.roommate_search_results where id=p_match_id and searcher_id=v_actor.user_id for update;
  if v_match is null then raise exception 'Match not found'; end if;
  update public.roommate_search_results set status=v_status,updated_at=now() where id=p_match_id;
  if v_status='accepted' then
    if v_match.status is distinct from 'accepted' then
      insert into public.notifications(recipient_id,type,title,message,related_id,read)
      select v_match.matched_user_id,'roommate_interest','New roommate interest',coalesce(nullif(v_actor.full_name,''),nullif(v_actor.username,''),'Someone')||' is interested in being roommates with you.',v_match.id::text,false
      where not exists(select 1 from public.notifications n where n.recipient_id=v_match.matched_user_id and n.type='roommate_interest' and n.related_id=v_match.id::text and not n.read);
    end if;
    select * into v_reverse from public.roommate_search_results where searcher_id=v_match.matched_user_id and matched_user_id=v_actor.user_id and status='accepted' limit 1;
    if v_reverse is not null then
      select c.id into v_conv from public.conversations c where c.conversation_type='roommate' and ((c.participant_a=v_actor.user_id and c.participant_b=v_match.matched_user_id) or (c.participant_b=v_actor.user_id and c.participant_a=v_match.matched_user_id)) limit 1;
      if v_conv is null then insert into public.conversations(participant_a,participant_b,status,conversation_type,subject,created_at,last_message_at,unread_a,unread_b) values(v_actor.user_id,v_match.matched_user_id,'active','roommate','Roommate Match',now(),now(),0,0) returning id into v_conv; end if;
      update public.notifications set read=true where recipient_id=v_match.matched_user_id and type='roommate_interest' and related_id=v_match.id::text;
      insert into public.notifications(recipient_id,type,title,message,related_id,read)
      select v_match.matched_user_id,'roommate_match','You have a roommate match','You both expressed interest. Open Messages to start chatting.',v_conv::text,false
      where not exists(select 1 from public.notifications n where n.recipient_id=v_match.matched_user_id and n.type='roommate_match' and n.related_id=v_conv::text);
    end if;
  end if;
  return v_conv;
end $function$;
revoke all on function public.update_my_roommate_match_status(uuid,text) from public,anon;
grant execute on function public.update_my_roommate_match_status(uuid,text) to authenticated,service_role;

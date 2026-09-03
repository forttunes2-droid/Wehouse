-- Keep Creator-managed services canonical across Worker profiles, jobs and reviews.
do $$
declare v_service_id uuid; v_service_name text;
begin
  select id,name into v_service_id,v_service_name
  from public.service_subcategories
  where lower(name) in ('electricial service','electrical service')
  order by (lower(name)='electricial service') desc
  limit 1;

  if v_service_id is not null then
    update public.worker_bookings
    set service_subcategory_id=v_service_id,service_type=v_service_name,updated_at=now()
    where lower(coalesce(service_type,'')) in ('electrician','electricial service','electrical service')
       or service_subcategory_id=v_service_id;

    update public.profiles p
    set worker_skills=(
      select coalesce(jsonb_agg(case when lower(skill) in ('electrician','electricial service','electrical service') then v_service_name else skill end),'[]'::jsonb)
      from jsonb_array_elements_text(coalesce(p.worker_skills,'[]'::jsonb)) skill
    ),updated_at=now()
    where exists(
      select 1 from jsonb_array_elements_text(coalesce(p.worker_skills,'[]'::jsonb)) skill
      where lower(skill) in ('electrician','electricial service','electrical service')
    );
  end if;
end $$;

-- A mutual roommate match grants eligibility, but an empty thread is not an Inbox chat.
create or replace function public.get_user_conversations(p_user_id text)
returns setof public.conversations
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare a public.profiles;
begin
  a:=public._current_comm_actor();
  if a is null then raise exception 'Authentication required'; end if;
  if p_user_id is distinct from a.user_id then raise exception 'User identity mismatch'; end if;
  return query
    select c.* from public.conversations c
    where (c.participant_a=a.user_id or c.participant_b=a.user_id)
      and public._can_access_conversation(c.id)
      and public._conversation_route_allowed(c.id,a.user_id)
      and exists(select 1 from public.messages m where m.conversation_id=c.id)
      and ((c.participant_a=a.user_id and (c.hidden_at_a is null or c.last_message_at>c.hidden_at_a))
        or (c.participant_b=a.user_id and (c.hidden_at_b is null or c.last_message_at>c.hidden_at_b)))
    order by c.last_message_at desc nulls last,c.created_at desc;
end $$;
revoke all on function public.get_user_conversations(text) from public,anon;
grant execute on function public.get_user_conversations(text) to authenticated,service_role;

-- Public reviews prove a completed job without publishing the customer's full identity.
create or replace function public.get_public_worker_reviews(p_worker_id text,p_limit integer default 20)
returns table(id uuid,rating smallint,comment text,created_at timestamptz,reviewer_name text,service_name text)
language sql stable security definer set search_path='pg_catalog','public' as $$
  select r.id,r.rating,r.comment,r.created_at,
    case when r.user_id=(select actor.user_id from public.profiles actor where actor.auth_id=(select auth.uid())::text limit 1)
      then 'Your review' else 'Verified customer' end,
    coalesce(s.name,b.service_type,'Service job')
  from public.worker_booking_reviews r
  join public.worker_bookings b on b.id=r.booking_id
  left join public.service_subcategories s on s.id=b.service_subcategory_id
  where r.worker_id=p_worker_id and b.status='approved_released'
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit,20),1),50)
$$;
revoke all on function public.get_public_worker_reviews(text,integer) from public,anon;
grant execute on function public.get_public_worker_reviews(text,integer) to authenticated,service_role;

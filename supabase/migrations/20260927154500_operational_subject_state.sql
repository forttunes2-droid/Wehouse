-- Keep a conversation as an audit record when its listing is removed, while
-- resolving its navigation against the current record rather than a stale URL.
create or replace function public.get_operational_subject_state(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text;
  v_thread public.partner_support_conversations;
  v_subject text;
  v_exists boolean;
begin
  select user_id into v_actor from public.profiles
  where auth_id=(select auth.uid())::text and deleted_at is null
    and not coalesce(deleted,false) and not coalesce(suspended,false)
    and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Authentication required'; end if;
  select * into v_thread from public.partner_support_conversations where id=p_conversation_id;
  if v_thread.id is null or v_thread.partner_id=v_actor
     or not public.current_actor_can_access_operational_conversation(p_conversation_id,false) then
    raise exception 'Operational team access required';
  end if;
  v_subject:=coalesce(nullif(v_thread.context_id,''),v_thread.context_snapshot->>'source_id');
  if v_thread.context_type='property_listing' then
    select exists(select 1 from public.listings l
      where (l.id::text=v_subject or l.listing_id=v_subject) and l.deleted_at is null)
    into v_exists;
    return jsonb_build_object('kind','property','state',case when v_exists then 'active' else 'removed' end);
  end if;
  if v_thread.context_type in ('hotel_property','hotel_operations') then
    select exists(select 1 from public.hotels h where h.hotel_id::text=v_subject)
    into v_exists;
    return jsonb_build_object('kind','property','state',case when v_exists then 'active' else 'removed' end);
  end if;
  return jsonb_build_object('kind','other','state','unknown');
end;
$$;
revoke all on function public.get_operational_subject_state(uuid) from public,anon;
grant execute on function public.get_operational_subject_state(uuid) to authenticated,service_role;

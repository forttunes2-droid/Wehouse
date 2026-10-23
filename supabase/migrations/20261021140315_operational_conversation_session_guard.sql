-- Reuse current Auth and trusted-device authority for all operational conversation access.
create or replace function public.current_actor_can_access_operational_conversation(
  p_conversation_id uuid,
  p_require_assignment boolean default false
)
returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_conversation public.partner_support_conversations;
  v_case public.operational_cases;
  v_domain text;
  v_state text;
  v_lga text;
  v_assigned_user_id text;
begin
  if not public._property_document_session_active() then return false;end if;
  select * into v_actor
  from public.profiles
  where auth_id=(select auth.uid())::text
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_actor.user_id is null then return false; end if;

  select * into v_conversation
  from public.partner_support_conversations
  where id=p_conversation_id;
  if v_conversation.id is null then return false; end if;

  if v_actor.user_id=v_conversation.partner_id then
    return not p_require_assignment;
  end if;

  if v_conversation.operational_case_id is not null then
    select * into v_case
    from public.operational_cases
    where operational_case_id=v_conversation.operational_case_id;
  end if;

  v_domain:=coalesce(
    v_case.owning_domain,
    public.canonical_operational_domain(v_conversation.channel_kind)
  );

  select
    coalesce(nullif(btrim(v_case.state_scope),''),nullif(btrim(p.state),'')),
    coalesce(nullif(btrim(p.local_government),''),nullif(btrim(p.city),''))
  into v_state,v_lga
  from public.profiles p
  where p.user_id=v_conversation.partner_id;

  v_assigned_user_id:=coalesce(
    v_case.assigned_user_id,
    v_conversation.assigned_staff_id,
    v_conversation.assigned_field_officer_id
  );

  if p_require_assignment and v_assigned_user_id is distinct from v_actor.user_id then
    return false;
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'creator') then
    return true;
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'admin') then
    return public.current_actor_in_scope(v_state,v_lga);
  end if;

  if public.user_has_active_workspace(v_actor.user_id,'staff') then
    return v_domain is not null
      and public.user_has_active_workspace(v_actor.user_id,v_domain)
      and public.current_actor_in_scope(v_state,v_lga);
  end if;

  return false;
end
$$;

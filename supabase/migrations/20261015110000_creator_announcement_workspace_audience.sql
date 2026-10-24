-- Keep Creator recipient previews and announcement delivery on the same
-- server-side account/workspace and destination rules.
begin;

create or replace function public._creator_announcement_recipient_matches(
  p_user_id text,
  p_target_roles text[],
  p_scope_state text default null,
  p_scope_lga text default null,
  p_recipient_ids text[] default null
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id=p_user_id
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
      and (
        (p_recipient_ids is not null and p.user_id=any(p_recipient_ids))
        or (
          p_recipient_ids is null
          and (
            (
              'user'=any(coalesce(p_target_roles,'{}'::text[]))
              and p.role='user'
              and not public.user_has_active_workspace(p.user_id,'worker')
              and not public.user_has_active_workspace(p.user_id,'property_partner')
              and not public.user_has_active_workspace(p.user_id,'staff')
              and not public.user_has_active_workspace(p.user_id,'admin')
              and not public.user_has_active_workspace(p.user_id,'creator')
              and (p_scope_state is null or lower(btrim(coalesce(p.state,'')))=lower(btrim(p_scope_state)))
              and (p_scope_lga is null or lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(p_scope_lga)))
            )
            or (
              'worker'=any(coalesce(p_target_roles,'{}'::text[]))
              and public.user_has_active_workspace(p.user_id,'worker')
              and (p_scope_state is null or lower(btrim(coalesce(p.state,'')))=lower(btrim(p_scope_state)))
              and (p_scope_lga is null or lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(p_scope_lga)))
            )
            or (
              'property_partner'=any(coalesce(p_target_roles,'{}'::text[]))
              and public.user_has_active_workspace(p.user_id,'property_partner')
              and (p_scope_state is null or lower(btrim(coalesce(p.state,'')))=lower(btrim(p_scope_state)))
              and (p_scope_lga is null or lower(btrim(coalesce(nullif(p.local_government,''),p.city,'')))=lower(btrim(p_scope_lga)))
            )
            or (
              'staff'=any(coalesce(p_target_roles,'{}'::text[]))
              and public.user_has_active_workspace(p.user_id,'staff')
              and exists (
                select 1 from public.workspace_role_assignments a
                where a.user_id=p.user_id and a.workspace_role='staff'
                  and a.status='active' and a.revoked_at is null
                  and (p_scope_state is null or a.scope_type='global' or lower(btrim(coalesce(a.scope_state,'')))=lower(btrim(p_scope_state)))
                  and (p_scope_lga is null or a.scope_type in ('global','state') or lower(btrim(coalesce(a.scope_lga,'')))=lower(btrim(p_scope_lga)))
              )
            )
            or (
              'admin'=any(coalesce(p_target_roles,'{}'::text[]))
              and public.user_has_active_workspace(p.user_id,'admin')
              and exists (
                select 1 from public.workspace_role_assignments a
                where a.user_id=p.user_id and a.workspace_role='admin'
                  and a.status='active' and a.revoked_at is null
                  and (p_scope_state is null or a.scope_type='global' or lower(btrim(coalesce(a.scope_state,'')))=lower(btrim(p_scope_state)))
                  and (p_scope_lga is null or a.scope_type in ('global','state') or lower(btrim(coalesce(a.scope_lga,'')))=lower(btrim(p_scope_lga)))
              )
            )
          )
        )
      )
  );
$$;

revoke all on function public._creator_announcement_recipient_matches(text,text[],text,text,text[]) from public,anon,authenticated;
grant execute on function public._creator_announcement_recipient_matches(text,text[],text,text,text[]) to service_role;

create or replace function public.creator_count_announcement_recipients(
  p_target_roles text[],
  p_scope_state text default null,
  p_scope_lga text default null,
  p_recipient_ids text[] default null
)
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_roles text[];
  v_state text:=nullif(btrim(coalesce(p_scope_state,'')),'');
  v_lga text:=nullif(btrim(coalesce(p_scope_lga,'')),'');
  v_count bigint;
begin
  if v_actor is null or not public.current_actor_has_workspace('creator',null) then
    raise exception 'Creator workspace required';
  end if;
  if v_lga is not null and v_state is null then raise exception 'State is required when targeting a local area'; end if;
  select coalesce(array_agg(distinct role_name),'{}'::text[])
    into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) role_name
  where role_name in ('user','worker','staff','property_partner','admin');
  if p_recipient_ids is null and cardinality(v_roles)=0 then return 0; end if;
  select count(*) into v_count
  from public.profiles p
  where p.user_id<>v_actor
    and public._creator_announcement_recipient_matches(p.user_id,v_roles,v_state,v_lga,p_recipient_ids);
  return v_count;
end
$$;

create or replace function public.creator_send_announcement(
  p_title text,
  p_content text,
  p_target_roles text[],
  p_recipient_ids text[] default null,
  p_scope_state text default null,
  p_scope_lga text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_id integer;
  v_count integer;
  v_roles text[];
  v_state text:=nullif(btrim(coalesce(p_scope_state,'')),'');
  v_lga text:=nullif(btrim(coalesce(p_scope_lga,'')),'');
begin
  select * into v_actor from public.profiles where user_id=public.current_profile_user_id() limit 1;
  if v_actor.user_id is null or not public.current_actor_has_workspace('creator',null) then raise exception 'Creator workspace required'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'Announcement title is required'; end if;
  if nullif(btrim(coalesce(p_content,'')),'') is null then raise exception 'Announcement content is required'; end if;
  if v_lga is not null and v_state is null then raise exception 'State is required when targeting a local area'; end if;
  select coalesce(array_agg(distinct role_name),'{}'::text[])
    into v_roles
  from unnest(coalesce(p_target_roles,'{}'::text[])) role_name
  where role_name in ('user','worker','staff','property_partner','admin');
  if p_recipient_ids is null and cardinality(v_roles)=0 then raise exception 'Select at least one recipient type'; end if;
  if p_recipient_ids is not null and cardinality(p_recipient_ids)=0 then raise exception 'Select at least one recipient'; end if;

  insert into public.announcements(
    title,content,sender_id,sender_name,sender_role,target_type,target_state,target_lga,
    recipient_count,read_count,created_at
  ) values (
    btrim(p_title),btrim(p_content),v_actor.user_id,
    coalesce(nullif(v_actor.full_name,''),nullif(v_actor.username,''),'WeHouse'),'creator',
    case when p_recipient_ids is null then 'all_users' else 'specific_user' end,
    v_state,v_lga,0,0,now()
  ) returning id into v_id;

  insert into public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
  select v_id,p.user_id,false,now()
  from public.profiles p
  where p.user_id<>v_actor.user_id
    and public._creator_announcement_recipient_matches(p.user_id,v_roles,v_state,v_lga,p_recipient_ids);
  get diagnostics v_count=row_count;
  if v_count=0 then
    delete from public.announcements where id=v_id;
    raise exception 'No accounts match the selected recipients';
  end if;
  update public.announcements set recipient_count=v_count where id=v_id;
  return jsonb_build_object('id',v_id,'recipient_count',v_count);
end
$$;

revoke all on function public.creator_count_announcement_recipients(text[],text,text,text[]) from public,anon;
grant execute on function public.creator_count_announcement_recipients(text[],text,text,text[]) to authenticated,service_role;
revoke all on function public.creator_send_announcement(text,text,text[],text[],text,text) from public,anon;
grant execute on function public.creator_send_announcement(text,text,text[],text[],text,text) to authenticated,service_role;

commit;

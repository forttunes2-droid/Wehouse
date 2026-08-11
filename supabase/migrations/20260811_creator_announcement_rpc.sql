create or replace function public.creator_send_announcement(p_content text,p_target_roles text[],p_recipient_ids text[] default null,p_scope_state text default null,p_scope_lga text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.profiles;v_id integer;v_count integer;v_roles text[];
begin
 select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor.user_id is null or v_actor.role<>'creator' then raise exception 'Creator account required'; end if;
 if nullif(btrim(coalesce(p_content,'')),'') is null then raise exception 'Announcement content is required'; end if;
 select coalesce(array_agg(distinct r),'{}'::text[]) into v_roles from unnest(coalesce(p_target_roles,'{}'::text[])) r where r in ('user','worker','staff','property_partner','admin');
 if coalesce(array_length(v_roles,1),0)=0 then raise exception 'Select at least one recipient type'; end if;
 insert into public.announcements(title,content,sender_id,sender_role,target_type,scope,recipient_count,read_count,created_at)
 values('Announcement',btrim(p_content),v_actor.user_id,'creator',case when p_recipient_ids is null then 'all_users' else 'specific_user' end,case when nullif(p_scope_state,'') is not null and nullif(p_scope_lga,'') is not null then p_scope_state||' / '||p_scope_lga else null end,0,0,now()) returning id into v_id;
 insert into public.announcement_recipients(announcement_id,user_id,read_status,delivered_at)
 select v_id,p.user_id,false,now() from public.profiles p where p.user_id<>v_actor.user_id and p.role=any(v_roles) and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false and coalesce(p.banned,false)=false and (p_recipient_ids is null or p.user_id=any(p_recipient_ids)) and (nullif(p_scope_state,'') is null or p.state=p_scope_state) and (nullif(p_scope_lga,'') is null or coalesce(nullif(p.local_government,''),nullif(p.city,''),nullif(p.assigned_lga,''))=p_scope_lga);
 get diagnostics v_count=row_count;
 if v_count=0 then delete from public.announcements where id=v_id; raise exception 'No users match the selected recipients'; end if;
 update public.announcements set recipient_count=v_count where id=v_id;
 return jsonb_build_object('id',v_id,'recipient_count',v_count);
end $$;
revoke all on function public.creator_send_announcement(text,text[],text[],text,text) from public,anon;
grant execute on function public.creator_send_announcement(text,text[],text[],text,text) to authenticated;

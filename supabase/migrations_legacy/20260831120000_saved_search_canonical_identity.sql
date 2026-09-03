drop policy if exists saved_searches_owner_select on public.saved_searches;
drop policy if exists saved_searches_owner_insert on public.saved_searches;
drop policy if exists saved_searches_owner_update on public.saved_searches;
drop policy if exists saved_searches_owner_delete on public.saved_searches;
create policy saved_searches_owner_select on public.saved_searches for select to authenticated using(user_id=public.current_profile_user_id());
create policy saved_searches_owner_insert on public.saved_searches for insert to authenticated with check(user_id=public.current_profile_user_id());
create policy saved_searches_owner_update on public.saved_searches for update to authenticated using(user_id=public.current_profile_user_id()) with check(user_id=public.current_profile_user_id());
create policy saved_searches_owner_delete on public.saved_searches for delete to authenticated using(user_id=public.current_profile_user_id());

create or replace function public.save_my_property_search(p_name text,p_search_kind text,p_criteria jsonb)
returns uuid language plpgsql security invoker set search_path=public
as $$
declare actor text := public.current_profile_user_id(); result uuid;
begin
  if actor is null then raise exception 'Authenticated profile required'; end if;
  if p_search_kind not in ('homes','hotels') then raise exception 'Unsupported saved search'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Saved search name is required'; end if;
  insert into public.saved_searches(user_id,name,search_kind,criteria)
  values(actor,btrim(p_name),p_search_kind,coalesce(p_criteria,'{}'::jsonb))
  on conflict(user_id,name,search_kind) do update
    set criteria=excluded.criteria,notifications_enabled=true,updated_at=now()
  returning id into result;
  return result;
end;
$$;

revoke all on function public.save_my_property_search(text,text,jsonb) from public,anon;
grant execute on function public.save_my_property_search(text,text,jsonb) to authenticated,service_role;

create or replace function public.notify_matching_saved_home_searches()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.deleted_at is not null or new.status<>'available' or new.availability_status<>'available' then return new; end if;
  if tg_op='UPDATE' and old.status='available' and old.availability_status='available' then return new; end if;
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key)
  select s.user_id,'saved_search_match','A new home matches your search',new.title,new.id::text,
    'listing',new.id::text,'detail',jsonb_build_object('listing_id',new.id),
    concat('saved-search:',s.id,':listing:',new.id)
  from public.saved_searches s
  where s.search_kind='homes' and s.notifications_enabled
    and (coalesce(s.criteria->>'state','')='' or lower(s.criteria->>'state')=lower(coalesce(new.state,'')))
    and (coalesce(s.criteria->>'city','')='' or lower(s.criteria->>'city')=lower(coalesce(new.city,'')))
    and coalesce((s.criteria->>'min_price')::numeric,0)<=new.price
    and (nullif(s.criteria->>'max_price','') is null or new.price<=(s.criteria->>'max_price')::numeric)
    and (nullif(s.criteria->>'bedrooms','') is null or new.bedrooms>=(s.criteria->>'bedrooms')::integer)
    and (coalesce(s.criteria->>'sub_type','')='' or s.criteria->>'sub_type'=coalesce(new.sub_type,''))
  on conflict(recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$$;

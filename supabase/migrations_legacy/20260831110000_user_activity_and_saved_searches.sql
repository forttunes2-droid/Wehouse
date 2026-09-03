-- Enrich the existing notification source instead of introducing a second inbox.

alter table public.notifications
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists destination_route text,
  add column if not exists destination_params jsonb not null default '{}'::jsonb,
  add column if not exists event_key text,
  add column if not exists read_at timestamptz;

create unique index if not exists notifications_recipient_event_key_unique
  on public.notifications(recipient_id,event_key) where event_key is not null;
create index if not exists notifications_recipient_activity_idx
  on public.notifications(recipient_id,created_at desc);

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  search_kind text not null check(search_kind in ('homes','hotels')),
  criteria jsonb not null default '{}'::jsonb,
  notifications_enabled boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,name,search_kind)
);
alter table public.saved_searches enable row level security;
create policy saved_searches_owner_select on public.saved_searches for select to authenticated using(user_id=(select auth.uid())::text);
create policy saved_searches_owner_insert on public.saved_searches for insert to authenticated with check(user_id=(select auth.uid())::text);
create policy saved_searches_owner_update on public.saved_searches for update to authenticated using(user_id=(select auth.uid())::text) with check(user_id=(select auth.uid())::text);
create policy saved_searches_owner_delete on public.saved_searches for delete to authenticated using(user_id=(select auth.uid())::text);
grant select,insert,update,delete on public.saved_searches to authenticated;

create or replace function public.save_my_property_search(p_name text,p_search_kind text,p_criteria jsonb)
returns uuid language plpgsql security invoker set search_path=public
as $$
declare actor text := (select auth.uid())::text; result uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_search_kind not in ('homes','hotels') then raise exception 'Unsupported saved search'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Saved search name is required'; end if;
  insert into public.saved_searches(user_id,name,search_kind,criteria)
  values(actor,btrim(p_name),p_search_kind,coalesce(p_criteria,'{}'::jsonb))
  on conflict(user_id,name,search_kind) do update set criteria=excluded.criteria,notifications_enabled=true,updated_at=now()
  returning id into result;
  return result;
end;
$$;
grant execute on function public.save_my_property_search(text,text,jsonb) to authenticated;

create or replace function public.mark_my_notification_read(p_notification_id uuid)
returns boolean language sql security invoker set search_path=public
as $$
  update public.notifications set read=true,read_at=coalesce(read_at,now())
  where id=p_notification_id and recipient_id=(select auth.uid())::text returning true;
$$;
create or replace function public.mark_all_my_notifications_read()
returns integer language plpgsql security invoker set search_path=public
as $$ declare affected integer; begin
  update public.notifications set read=true,read_at=coalesce(read_at,now()) where recipient_id=(select auth.uid())::text and not read;
  get diagnostics affected=row_count;return affected;
end $$;
grant execute on function public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() to authenticated;

create or replace function public.notify_matching_saved_home_searches()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.deleted_at is not null or new.status<>'available' or new.availability_status<>'available' then return new; end if;
  if tg_op='UPDATE' and old.status='available' and old.availability_status='available' then return new; end if;
  insert into public.notifications(recipient_id,type,title,message,related_id,source_type,source_id,destination_route,destination_params,event_key)
  select s.user_id,'saved_search_match','A new home matches your search',new.title,new.id::text,'listing',new.id::text,'detail',jsonb_build_object('listing_id',new.id),concat('saved-search:',s.id,':listing:',new.id)
  from public.saved_searches s where s.search_kind='homes' and s.notifications_enabled
    and (coalesce(s.criteria->>'state','')='' or lower(s.criteria->>'state')=lower(coalesce(new.state,'')))
    and (coalesce(s.criteria->>'city','')='' or lower(s.criteria->>'city')=lower(coalesce(new.city,'')))
    and (coalesce((s.criteria->>'min_price')::numeric,0)<=new.price)
    and (nullif(s.criteria->>'max_price','') is null or new.price<=(s.criteria->>'max_price')::numeric)
    and (coalesce(s.criteria->>'sub_type','')='' or s.criteria->>'sub_type'=coalesce(new.sub_type,''))
  on conflict(recipient_id,event_key) where event_key is not null do nothing;
  return new;
end;
$$;
revoke all on function public.notify_matching_saved_home_searches() from public,anon,authenticated;
drop trigger if exists listings_saved_search_activity on public.listings;
create trigger listings_saved_search_activity after insert or update of status,availability_status on public.listings for each row execute function public.notify_matching_saved_home_searches();

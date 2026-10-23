-- Route property listing reports into the same scoped moderation queue used by
-- profile and conversation reports. The listing's owner and location are
-- resolved from the database; neither is trusted from client input.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id text not null,
  subject_user_id text not null,
  subject_type text not null,
  subject_ref text,
  reason text not null check (reason in ('spam','harassment','scam','unsafe','inappropriate','other')),
  details text check (details is null or char_length(details)<=1000),
  state_key text,
  status text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  resolution_note text,
  resolved_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_user_id<>subject_user_id)
);
alter table public.content_reports enable row level security;
revoke all on table public.content_reports from anon,authenticated;
grant all on table public.content_reports to service_role;
create index if not exists content_reports_open_idx on public.content_reports(status,state_key,created_at desc);

alter table public.content_reports
  drop constraint if exists content_reports_subject_type_check;
update public.content_reports set subject_type='friend_chat' where subject_type='companion_chat';
alter table public.content_reports
  add constraint content_reports_subject_type_check
  check (subject_type in (
    'roommate_chat','friend_chat','worker_chat','hotel_chat',
    'support_case','profile','message','listing'
  ));

create or replace function public.report_listing(
  p_listing_id text,
  p_reason text,
  p_details text default null
) returns uuid
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_listing public.listings;
  v_report_id uuid;
  v_owner_id text;
begin
  select * into v_actor
  from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false)
    and not coalesce(p.suspended,false)
    and not coalesce(p.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Sign in to report'; end if;
  if p_listing_id is null or length(p_listing_id)>100 then raise exception 'Invalid listing'; end if;
  if p_reason is null or p_reason not in ('spam','harassment','scam','unsafe','inappropriate','other') then
    raise exception 'Choose a report reason';
  end if;

  select l.* into v_listing
  from public.listings l
  where l.id::text=p_listing_id or l.listing_id=p_listing_id
  order by (l.id::text=p_listing_id) desc
  limit 1;
  if v_listing.id is null or v_listing.deleted_at is not null then raise exception 'Listing not found'; end if;

  v_owner_id:=coalesce(v_listing.owner_id,v_listing.partner_id);
  if v_owner_id is null then raise exception 'Listing cannot be reported right now'; end if;
  if v_owner_id=v_actor.user_id then raise exception 'You cannot report your own listing'; end if;

  insert into public.content_reports(
    reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key
  ) values (
    v_actor.user_id,v_owner_id,'listing',v_listing.id::text,p_reason,
    nullif(left(btrim(coalesce(p_details,'')),1000),''),
    public.wehouse_state_key(v_listing.state)
  ) returning id into v_report_id;

  return v_report_id;
end
$$;

revoke all on function public.report_listing(text,text,text) from public,anon;
grant execute on function public.report_listing(text,text,text) to authenticated,service_role;

-- Preserve old submissions when retiring their separate moderation path. Rows
-- whose listing no longer resolves remain Creator-reviewable with a neutral
-- owner reference and null geography instead of disappearing.
insert into public.content_reports(
  reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,
  state_key,status,resolution_note,resolved_by,created_at,resolved_at
)
select
  lr.reporter_id,
  case
    when coalesce(l.owner_id,l.partner_id,'')=lr.reporter_id
      then 'legacy-listing-report:'||lr.id::text
    else coalesce(l.owner_id,l.partner_id,'legacy-listing-report:'||lr.id::text)
  end,
  'listing',
  coalesce(l.id::text,lr.listing_id),
  case
    when lower(lr.reason) like '%spam%' then 'spam'
    when lower(lr.reason) like '%fraud%' or lower(lr.reason) like '%suspicious%' then 'scam'
    when lower(lr.reason) like '%safety%' or lower(lr.reason) like '%unsafe%' then 'unsafe'
    when lower(lr.reason) like '%prohibited%' or lower(lr.reason) like '%inappropriate%' then 'inappropriate'
    else 'other'
  end,
  nullif(left(btrim(coalesce(lr.reason,'')),1000),''),
  public.wehouse_state_key(l.state),
  case lower(lr.status)
    when 'resolved' then 'actioned'
    when 'dismissed' then 'dismissed'
    else 'open'
  end,
  null,
  lr.resolved_by,
  lr.created_at,
  lr.resolved_at
from public.listing_reports lr
left join lateral (
  select x.* from public.listings x
  where x.id::text=lr.listing_id or x.listing_id=lr.listing_id
  order by (x.id::text=lr.listing_id) desc
  limit 1
) l on true
where not exists (
  select 1 from public.content_reports r
  where r.subject_type='listing'
    and r.reporter_user_id=lr.reporter_id
    and r.subject_ref=coalesce(l.id::text,lr.listing_id)
    and r.created_at=lr.created_at
);

-- Let a reporter check progress without granting browser access to the queue or
-- exposing the reported account's identity.
create or replace function public.list_my_content_reports()
returns table(
  report_id uuid,
  subject_type text,
  subject_ref text,
  reason text,
  details text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz
)
language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select r.id,r.subject_type,r.subject_ref,r.reason,r.details,r.status,r.created_at,r.resolved_at
  from public.content_reports r
  where r.reporter_user_id=(
    select p.user_id from public.profiles p
    where p.auth_id=(select auth.uid())::text
      and not coalesce(p.deleted,false)
      and not coalesce(p.suspended,false)
      and not coalesce(p.banned,false)
    limit 1
  )
  order by r.created_at desc
  limit 100
$$;
revoke all on function public.list_my_content_reports() from public,anon;
grant execute on function public.list_my_content_reports() to authenticated;

-- Listing reports are scoped to the listing's state and city/LGA, not the
-- property owner's home address. Other report types retain existing user-area
-- scoping. Creator retains global review access.
create or replace function public._content_report_in_actor_scope(
  p_subject_user_id text,
  p_subject_type text,
  p_subject_ref text,
  p_state_key text,
  p_actor public.profiles
) returns boolean
language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select p_actor.role='creator'
    or (
      p_state_key=public.wehouse_state_key(p_actor.assigned_state)
      and (
        nullif(btrim(coalesce(p_actor.assigned_lga,'')),'') is null
        or (
          p_subject_type='listing'
          and exists (
            select 1 from public.listings l
            where (l.id::text=p_subject_ref or l.listing_id=p_subject_ref)
              and lower(btrim(coalesce(l.city,'')))=lower(btrim(p_actor.assigned_lga))
          )
        )
        or (
          p_subject_type<>'listing'
          and public._report_in_admin_area(p_subject_user_id,p_actor)
        )
      )
    )
$$;
revoke all on function public._content_report_in_actor_scope(text,text,text,text,public.profiles) from public,anon,authenticated;

create or replace function public.admin_list_content_reports(p_status text default 'open')
returns setof public.content_reports
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query
    select r.* from public.content_reports r
    where r.status=coalesce(p_status,'open')
      and public._content_report_in_actor_scope(
        r.subject_user_id,r.subject_type,r.subject_ref,r.state_key,v_actor
      )
    order by r.created_at desc limit 200;
end
$$;

create or replace function public.admin_resolve_content_report(
  p_report_id uuid,p_status text,p_note text default null
) returns void
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor public.profiles; n integer;
begin
  v_actor:=public._admin_dashboard_actor();
  if p_status not in ('reviewing','actioned','dismissed') then raise exception 'Invalid status'; end if;
  update public.content_reports r
  set status=p_status,
      resolution_note=nullif(left(btrim(coalesce(p_note,'')),1000),''),
      resolved_by=v_actor.user_id,
      resolved_at=case when p_status='reviewing' then null else now() end
  where r.id=p_report_id
    and public._content_report_in_actor_scope(
      r.subject_user_id,r.subject_type,r.subject_ref,r.state_key,v_actor
    );
  get diagnostics n=row_count;
  if n=0 then raise exception 'Report not found in your area'; end if;
end
$$;

revoke all on function public.admin_list_content_reports(text),
  public.admin_resolve_content_report(uuid,text,text) from public,anon;
grant execute on function public.admin_list_content_reports(text),
  public.admin_resolve_content_report(uuid,text,text) to authenticated,service_role;

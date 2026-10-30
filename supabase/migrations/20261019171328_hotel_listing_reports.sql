-- Public Hotel reports use the existing moderation queue and reporter receipts.
alter table public.content_reports drop constraint if exists content_reports_subject_type_check;
alter table public.content_reports add constraint content_reports_subject_type_check
check(subject_type in ('roommate_chat','friend_chat','worker_chat','hotel_chat','support_case','profile','message','listing','hotel'));

create unique index content_reports_one_open_hotel_reason_idx
on public.content_reports(reporter_user_id,subject_ref,reason)
where subject_type='hotel' and status in ('open','reviewing');

create or replace function public.report_hotel(p_hotel_id integer,p_reason text,p_details text default null)
returns uuid language plpgsql security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_hotel public.hotels;
  v_id uuid;
begin
  select * into v_actor from public.profiles p
  where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)
  limit 1;
  if v_actor.user_id is null then raise exception 'Sign in to report'; end if;
  if p_reason is null or p_reason not in ('spam','harassment','scam','unsafe','inappropriate','other') then
    raise exception 'Choose a report reason';
  end if;
  select * into v_hotel from public.hotels h where h.hotel_id=p_hotel_id and h.status='active';
  if v_hotel.hotel_id is null or v_hotel.owner_id is null then raise exception 'Hotel not found'; end if;
  if v_actor.user_id=v_hotel.owner_id then raise exception 'You cannot report your own hotel'; end if;
  insert into public.content_reports(reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key)
  values(v_actor.user_id,v_hotel.owner_id,'hotel',v_hotel.hotel_id::text,p_reason,
    nullif(left(btrim(coalesce(p_details,'')),1000),''),public.wehouse_state_key(v_hotel.state))
  on conflict(reporter_user_id,subject_ref,reason) where subject_type='hotel' and status in ('open','reviewing')
  do update set details=content_reports.details
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.report_hotel(integer,text,text) from public,anon;
grant execute on function public.report_hotel(integer,text,text) to authenticated;

-- Review scope follows the reported property's location, not its owner's home.
create or replace function public._content_report_in_actor_scope(
  p_subject_user_id text,p_subject_type text,p_subject_ref text,p_state_key text,p_actor public.profiles
) returns boolean language sql stable security definer
set search_path to 'pg_catalog','public'
as $$
  select p_actor.role='creator' or (
    p_state_key=public.wehouse_state_key(p_actor.assigned_state) and (
      nullif(btrim(coalesce(p_actor.assigned_lga,'')),'') is null
      or (p_subject_type='listing' and exists(
        select 1 from public.listings l
        where (l.id::text=p_subject_ref or l.listing_id=p_subject_ref)
          and lower(btrim(coalesce(l.city,'')))=lower(btrim(p_actor.assigned_lga))
      ))
      or (p_subject_type='hotel' and exists(
        select 1 from public.hotels h
        where h.hotel_id::text=p_subject_ref
          and lower(btrim(coalesce(h.city,'')))=lower(btrim(p_actor.assigned_lga))
      ))
      or (p_subject_type not in ('listing','hotel') and public._report_in_admin_area(p_subject_user_id,p_actor))
    )
  );
$$;
revoke all on function public._content_report_in_actor_scope(text,text,text,text,public.profiles) from public,anon,authenticated;

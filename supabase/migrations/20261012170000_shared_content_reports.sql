-- One Report system for every conversation and profile (decision C-030).
-- Moderation scope follows _admin_dashboard_actor: Creator sees all, Admin/Staff see their state.
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id text not null,
  subject_user_id text not null,
  subject_type text not null check (subject_type in ('roommate_chat','companion_chat','worker_chat','hotel_chat','support_case','profile','message')),
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
revoke all on table public.content_reports from anon, authenticated;
grant all on table public.content_reports to service_role;
create index if not exists content_reports_open_idx on public.content_reports(status,state_key,created_at desc);

create or replace function public.report_content(p_subject_type text,p_subject_user_id text,p_reason text,p_details text default null,p_subject_ref text default null)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare a public.profiles; s public.profiles; v_id uuid; lo text; hi text;
begin
  select * into a from public.profiles p where p.auth_id=(select auth.uid())::text
    and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false) limit 1;
  if a.user_id is null then raise exception 'Sign in to report'; end if;
  select * into s from public.profiles p where p.user_id=p_subject_user_id and not coalesce(p.deleted,false) limit 1;
  if s.user_id is null or s.user_id=a.user_id then raise exception 'Invalid report'; end if;
  if p_reason is null or p_reason not in ('spam','harassment','scam','unsafe','inappropriate','other') then raise exception 'Choose a report reason'; end if;
  if p_subject_type='roommate_chat' and not exists(select 1 from public.conversations c where c.conversation_type='roommate'
     and a.user_id in(c.participant_a,c.participant_b) and s.user_id in(c.participant_a,c.participant_b)) then
    raise exception 'You can only report people you have a roommate conversation with'; end if;
  if p_subject_type='companion_chat' then
    lo:=least(a.user_id,s.user_id); hi:=greatest(a.user_id,s.user_id);
    if not exists(select 1 from public.companions c where c.user_low=lo and c.user_high=hi) then
      raise exception 'You can only report your own Companions'; end if;
  end if;
  insert into public.content_reports(reporter_user_id,subject_user_id,subject_type,subject_ref,reason,details,state_key)
  values(a.user_id,s.user_id,p_subject_type,left(p_subject_ref,200),p_reason,nullif(left(btrim(coalesce(p_details,'')),1000),''),public.wehouse_state_key(s.state))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_list_content_reports(p_status text default 'open')
returns setof public.content_reports language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles;
begin
  v_actor:=public._admin_dashboard_actor();
  return query select r.* from public.content_reports r
    where r.status=coalesce(p_status,'open')
      and (v_actor.role='creator' or r.state_key=public.wehouse_state_key(v_actor.assigned_state))
    order by r.created_at desc limit 200;
end $$;

create or replace function public.admin_resolve_content_report(p_report_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare v_actor public.profiles; n int;
begin
  v_actor:=public._admin_dashboard_actor();
  if p_status not in ('reviewing','actioned','dismissed') then raise exception 'Invalid status'; end if;
  update public.content_reports r set status=p_status,resolution_note=nullif(left(btrim(coalesce(p_note,'')),1000),''),
    resolved_by=v_actor.user_id,resolved_at=case when p_status='reviewing' then null else now() end
  where r.id=p_report_id and (v_actor.role='creator' or r.state_key=public.wehouse_state_key(v_actor.assigned_state));
  get diagnostics n=row_count;
  if n=0 then raise exception 'Report not found in your area'; end if;
end $$;

revoke all on function public.report_content(text,text,text,text,text),public.admin_list_content_reports(text),public.admin_resolve_content_report(uuid,text,text) from public,anon;
grant execute on function public.report_content(text,text,text,text,text),public.admin_list_content_reports(text),public.admin_resolve_content_report(uuid,text,text) to authenticated,service_role;

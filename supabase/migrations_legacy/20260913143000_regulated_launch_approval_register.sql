begin;

-- A Creator-facing boolean is not evidence that a regulated launch was approved.
-- These records are written only through the trusted deployment/operator path
-- after the cited approval has been checked. They are deliberately separate from
-- ordinary product settings and must not contain confidential legal advice.
create table if not exists public.legal_launch_approvals(
  gate_key text primary key check(gate_key in(
    'worker_marketplace',
    'worker_identity_checks',
    'worker_pro_web_sales',
    'worker_pro_ios_sales',
    'worker_pro_android_sales',
    'property_marketplace',
    'hotel_marketplace',
    'hotel_pms_connected_mode'
  )),
  status text not null check(status in('pending','approved','rejected','revoked','expired')),
  authority text not null check(length(btrim(authority)) between 3 and 200),
  approval_reference text not null check(length(btrim(approval_reference)) between 3 and 300),
  scope text not null check(length(btrim(scope)) between 10 and 3000),
  conditions text,
  evidence_uri text,
  approved_at timestamptz,
  expires_at timestamptz,
  recorded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(status<>'approved' or approved_at is not null),
  check(expires_at is null or approved_at is null or expires_at>approved_at)
);

alter table public.legal_launch_approvals enable row level security;
drop policy if exists legal_launch_approvals_creator_read on public.legal_launch_approvals;
create policy legal_launch_approvals_creator_read
on public.legal_launch_approvals for select to authenticated
using(public.is_current_creator());

revoke all on table public.legal_launch_approvals from public,anon,authenticated;
grant select on table public.legal_launch_approvals to authenticated;
grant all on table public.legal_launch_approvals to service_role;

create or replace function public._legal_launch_gate_is_approved(p_gate_key text)
returns boolean
language sql
stable
security definer
set search_path='pg_catalog','public'
as $$
  select exists(
    select 1
    from public.legal_launch_approvals approval
    where approval.gate_key=p_gate_key
      and approval.status='approved'
      and approval.approved_at<=now()
      and (approval.expires_at is null or approval.expires_at>now())
  );
$$;
revoke all on function public._legal_launch_gate_is_approved(text) from public,anon,authenticated;
grant execute on function public._legal_launch_gate_is_approved(text) to service_role;

create or replace function public._guard_regulated_platform_launch_setting()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_enabled boolean:=lower(btrim(coalesce(new.value,''))) in('true','1','yes','on');
  v_gate_key text;
begin
  v_gate_key:=case new.key
    when 'worker_marketplace_launch_enabled' then 'worker_marketplace'
    when 'worker_identity_checks_enabled' then 'worker_identity_checks'
    else null
  end;
  if v_gate_key is not null and v_enabled
     and not public._legal_launch_gate_is_approved(v_gate_key) then
    raise exception 'Regulated launch gate % has no current recorded approval',v_gate_key;
  end if;
  return new;
end;
$$;
revoke all on function public._guard_regulated_platform_launch_setting() from public,anon,authenticated;

drop trigger if exists guard_regulated_platform_launch_setting on public.platform_settings;
create trigger guard_regulated_platform_launch_setting
before insert or update of value on public.platform_settings
for each row
when(new.key in('worker_marketplace_launch_enabled','worker_identity_checks_enabled'))
execute function public._guard_regulated_platform_launch_setting();

create or replace function public._close_revoked_legal_launch_gate()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_setting_key text;
begin
  if new.status='approved' and (new.expires_at is null or new.expires_at>now()) then
    return new;
  end if;
  v_setting_key:=case new.gate_key
    when 'worker_marketplace' then 'worker_marketplace_launch_enabled'
    when 'worker_identity_checks' then 'worker_identity_checks_enabled'
    else null
  end;
  if v_setting_key is not null then
    update public.platform_settings
    set value='false',updated_at=now()
    where key=v_setting_key and lower(btrim(value)) in('true','1','yes','on');
  end if;
  return new;
end;
$$;
revoke all on function public._close_revoked_legal_launch_gate() from public,anon,authenticated;

drop trigger if exists close_revoked_legal_launch_gate on public.legal_launch_approvals;
create trigger close_revoked_legal_launch_gate
after insert or update of status,expires_at on public.legal_launch_approvals
for each row execute function public._close_revoked_legal_launch_gate();

-- Existing settings remain fail-closed unless a current approval has already
-- been recorded through the trusted operator path.
update public.platform_settings
set value='false',editable=false,updated_at=now()
where key='worker_marketplace_launch_enabled'
  and not public._legal_launch_gate_is_approved('worker_marketplace');

update public.platform_settings
set value='false',editable=false,updated_at=now()
where key='worker_identity_checks_enabled'
  and not public._legal_launch_gate_is_approved('worker_identity_checks');

commit;

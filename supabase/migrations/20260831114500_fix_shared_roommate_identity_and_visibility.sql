-- Bind shared-home membership to the canonical profile identity instead of
-- assuming auth.users.id and profiles.user_id are interchangeable.

drop policy if exists shared_housing_members_member_read on public.shared_housing_members;
create policy shared_housing_members_member_read on public.shared_housing_members
  for select to authenticated using (
    exists (
      select 1 from public.shared_housing_members mine
      where mine.group_id = shared_housing_members.group_id
        and mine.user_id = public.current_profile_user_id()
    )
  );

do $migration$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'public.create_my_shared_housing_group(uuid,uuid)',
    'public.get_my_shared_housing_group(uuid)',
    'public.respond_to_shared_housing_invite(uuid,boolean)',
    'public.create_my_shared_housing_payment(uuid)',
    'public.start_my_shared_contract_split(uuid)'
  ] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    definition := replace(
      definition,
      'actor text := (select auth.uid())::text',
      'actor text := public.current_profile_user_id()'
    );
    definition := replace(
      definition,
      'actor text := ( SELECT (auth.uid())::text AS text)',
      'actor text := public.current_profile_user_id()'
    );
    execute definition;
  end loop;
end;
$migration$;

create or replace function public.get_my_shared_housing_groups()
returns jsonb language sql security definer set search_path=public
as $$
  select coalesce(
    jsonb_agg(public.get_my_shared_housing_group(m.group_id) order by m.created_at desc),
    '[]'::jsonb
  )
  from public.shared_housing_members m
  where m.user_id = public.current_profile_user_id();
$$;

create or replace function public.notify_shared_housing_member_event()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  group_row public.shared_housing_groups;
  listing_title text;
  actor_name text;
begin
  select * into group_row from public.shared_housing_groups where id=new.group_id;
  select title into listing_title from public.listings where id=group_row.listing_id;
  select coalesce(full_name, username, 'Your roommate') into actor_name
    from public.profiles where user_id=coalesce(group_row.created_by,new.user_id);

  if tg_op='INSERT' and new.invitation_status='invited' then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    ) values (
      new.user_id,'shared_home_invite','Shared home invitation',
      actor_name||' invited you to share '||coalesce(listing_title,'a home')||'.',
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_invite:'||new.group_id::text||':'||new.user_id
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  elsif tg_op='UPDATE' and new.invitation_status is distinct from old.invitation_status
    and new.invitation_status in ('accepted','declined') then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    ) values (
      group_row.created_by,'shared_home_response',
      case when new.invitation_status='accepted' then 'Shared home accepted' else 'Shared home declined' end,
      case when new.invitation_status='accepted'
        then 'Your roommate accepted the invitation for '||coalesce(listing_title,'the selected home')||'.'
        else 'Your roommate declined the invitation for '||coalesce(listing_title,'the selected home')||'.' end,
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_response:'||new.group_id::text||':'||new.invitation_status
    ) on conflict (recipient_id,event_key) where event_key is not null do nothing;
  elsif tg_op='UPDATE' and new.payment_status='paid'
    and old.payment_status is distinct from 'paid' then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,read,source_type,source_id,
      destination_route,destination_params,event_key
    )
    select member.user_id,'shared_home_payment','Roommate share updated',
      'A payment share for '||coalesce(listing_title,'your shared home')||' was confirmed.',
      new.group_id::text,false,'shared_housing',new.group_id,'my_reservations',
      jsonb_build_object('sharedGroupId',new.group_id),
      'shared_home_payment:'||new.group_id::text||':'||new.id::text
    from public.shared_housing_members member
    where member.group_id=new.group_id and member.user_id<>new.user_id
    on conflict (recipient_id,event_key) where event_key is not null do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists shared_housing_member_activity on public.shared_housing_members;
create trigger shared_housing_member_activity
after insert or update of invitation_status,payment_status on public.shared_housing_members
for each row execute function public.notify_shared_housing_member_event();

revoke all on function public.notify_shared_housing_member_event() from public,anon,authenticated;
grant execute on function public.notify_shared_housing_member_event() to service_role;

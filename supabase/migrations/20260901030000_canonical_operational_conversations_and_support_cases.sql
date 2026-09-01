-- Reservation operations and genuine support are different products.
-- Keep the established message history, but make the owning channel explicit.

alter table public.partner_support_conversations
  add column if not exists channel_kind text,
  add column if not exists case_number text;

update public.partner_support_conversations
set channel_kind = case
  when context_type in ('apartment_reservation','reservation','hotel_booking') then 'reservation_operations'
  when context_type='property_inspection' then 'property_operations'
  else 'support_case'
end
where channel_kind is null;

alter table public.partner_support_conversations
  alter column channel_kind set default 'support_case',
  alter column channel_kind set not null;

alter table public.partner_support_conversations
  drop constraint if exists partner_support_conversations_channel_kind_check;
alter table public.partner_support_conversations
  add constraint partner_support_conversations_channel_kind_check
  check(channel_kind in ('reservation_operations','property_operations','support_case'));

update public.partner_support_conversations
set case_number='WHC-'||upper(substring(replace(id::text,'-','') from 1 for 10))
where channel_kind='support_case' and case_number is null;

delete from public.partner_support_conversations c
where c.channel_kind='support_case' and c.context_type='general'
  and not exists(select 1 from public.partner_support_messages m where m.conversation_id=c.id);

create unique index if not exists partner_support_case_number_idx
  on public.partner_support_conversations(case_number) where case_number is not null;

create or replace function public.classify_conversation_channel() returns trigger
language plpgsql
security invoker
set search_path='pg_catalog','public'
as $$
begin
  new.channel_kind:=case
    when new.context_type in ('apartment_reservation','reservation','hotel_booking') then 'reservation_operations'
    when new.context_type='property_inspection' then 'property_operations'
    else 'support_case'
  end;
  if new.channel_kind='support_case' and new.case_number is null then
    new.case_number:='WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));
  end if;
  return new;
end $$;

drop trigger if exists partner_support_classify_channel on public.partner_support_conversations;
create trigger partner_support_classify_channel before insert on public.partner_support_conversations
for each row execute function public.classify_conversation_channel();

create or replace function public.open_my_reservation_conversation(
  p_context_type text,
  p_context_id text
) returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  actor public.profiles;
  result_id uuid;
  snapshot jsonb;
  display_subject text;
begin
  select * into actor from public.profiles
  where auth_id=auth.uid()::text and not coalesce(deleted,false)
    and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Active WeHouse account required'; end if;

  if p_context_type in ('apartment_reservation','reservation') then
    select to_jsonb(r)||jsonb_build_object(
      'reservation_id',r.id,'listing_title',coalesce(l.title,'Property reservation'),
      'listing_city',l.city,'listing_state',l.state
    ), coalesce(l.title,case when r.stay_type='short_let' then 'Short Let' else 'Long Stay' end)
    into snapshot,display_subject
    from public.reservations r
    left join public.listings l on l.listing_id=r.listing_id or l.id::text=r.listing_id
    where r.id=p_context_id and r.user_id=actor.user_id limit 1;
  elsif p_context_type='hotel_booking' then
    select to_jsonb(b)||jsonb_build_object('hotel_name',h.name),coalesce(h.name,'Hotel stay')
    into snapshot,display_subject
    from public.hotel_bookings b join public.hotels h on h.hotel_id=b.hotel_id
    where b.booking_id::text=p_context_id and b.user_id=actor.user_id limit 1;
  else
    raise exception 'Reservation context is invalid';
  end if;
  if snapshot is null then raise exception 'Reservation was not found'; end if;

  select id into result_id from public.partner_support_conversations
  where partner_id=actor.user_id and channel_kind='reservation_operations'
    and context_type=p_context_type and context_id=p_context_id limit 1;
  if result_id is null then
    insert into public.partner_support_conversations(
      partner_id,requester_role,subject,status,category,context_type,context_id,
      context_snapshot,priority,channel_kind,created_at,updated_at
    ) values(
      actor.user_id,actor.role,display_subject,'open','reservation_operations',
      p_context_type,p_context_id,snapshot,'normal','reservation_operations',now(),now()
    ) returning id into result_id;
  else
    update public.partner_support_conversations set subject=display_subject,
      context_snapshot=snapshot,updated_at=now() where id=result_id;
  end if;
  return result_id;
end $$;

create or replace function public.create_my_support_case(
  p_subject text,
  p_category text default 'general',
  p_source_type text default null,
  p_source_id text default null,
  p_source_snapshot jsonb default '{}'::jsonb,
  p_priority text default 'normal'
) returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare actor public.profiles; result_id uuid; normalized_subject text;
begin
  select * into actor from public.profiles where auth_id=auth.uid()::text
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if actor.user_id is null then raise exception 'Active WeHouse account required'; end if;
  normalized_subject:=nullif(btrim(coalesce(p_subject,'')),'');
  if normalized_subject is null then raise exception 'Tell us what you need help with'; end if;
  insert into public.partner_support_conversations(
    partner_id,requester_role,subject,status,category,context_type,context_id,
    context_snapshot,priority,channel_kind,case_number,created_at,updated_at
  ) values(
    actor.user_id,actor.role,normalized_subject,'open',coalesce(nullif(btrim(p_category),''),'general'),
    'support_case',nullif(btrim(coalesce(p_source_id,'')),''),
    coalesce(p_source_snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('source_type',nullif(btrim(coalesce(p_source_type,'')),''),'source_id',nullif(btrim(coalesce(p_source_id,'')),''))),
    case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
    'support_case','WHC-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10)),now(),now()
  ) returning id into result_id;
  return result_id;
end $$;

create or replace function public.enforce_conversation_context_ownership() returns trigger
language plpgsql
security invoker
set search_path='pg_catalog','public'
as $$
begin
  if old.context_type is distinct from new.context_type
    or old.context_id is distinct from new.context_id
    or old.channel_kind is distinct from new.channel_kind then
    raise exception 'Conversation ownership cannot be reassigned';
  end if;
  return new;
end $$;

drop trigger if exists partner_support_context_immutable on public.partner_support_conversations;
create trigger partner_support_context_immutable before update on public.partner_support_conversations
for each row execute function public.enforce_conversation_context_ownership();

revoke all on function public.open_my_reservation_conversation(text,text),
  public.create_my_support_case(text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.open_my_reservation_conversation(text,text),
  public.create_my_support_case(text,text,text,text,jsonb,text) to authenticated;
revoke all on function public.enforce_conversation_context_ownership() from public,anon,authenticated;
revoke all on function public.classify_conversation_channel() from public,anon,authenticated;

comment on column public.partner_support_conversations.channel_kind is
  'Canonical boundary: reservation/property operations are not generic support cases.';

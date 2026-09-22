\set ON_ERROR_STOP on
begin;

do $$
begin
  if to_regclass('public.partner_support_messages_conversation_created_idx') is null then
    raise exception 'Operational message ordering index is missing';
  end if;
  if to_regclass('public.partner_support_messages_unread_conversation_idx') is null then
    raise exception 'Operational unread-message index is missing';
  end if;
end
$$;

set local session_replication_role=replica;

insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,account_kind,full_name,state,local_government
) values
 ('11111111-1111-4111-8111-111111111111','bundle-customer@example.invalid','bundle-customer','user',true,'consumer','Bundle Customer','Nasarawa','Lafia'),
 ('22222222-2222-4222-8222-222222222222','bundle-creator@example.invalid','bundle-creator','creator',true,'consumer','Bundle Creator','Nasarawa','Lafia');

insert into public.workspace_role_assignments(
  user_id,workspace_role,scope_type,status
) values('bundle-creator','creator','global','active');

insert into public.partner_support_conversations(
  id,partner_id,subject,status,requester_role,category,context_type,
  context_snapshot,priority,channel_kind
) values(
  '33333333-3333-4333-8333-333333333333','bundle-customer','Bundle test',
  'in_progress','user','general','general','{}','normal','support_case'
);

insert into public.partner_support_messages(
  id,conversation_id,sender_id,sender_role,content,action_type,
  action_metadata,visibility,created_at
) values
 ('44444444-4444-4444-8444-444444444441','33333333-3333-4333-8333-333333333333','bundle-customer','user','hello',null,'{}','customer',now()-interval '4 minutes'),
 ('44444444-4444-4444-8444-444444444442','33333333-3333-4333-8333-333333333333','bundle-creator','creator','reply',null,'{}','customer',now()-interval '3 minutes'),
 ('44444444-4444-4444-8444-444444444443','33333333-3333-4333-8333-333333333333','bundle-creator','creator','internal only',null,'{}','internal',now()-interval '2 minutes'),
 ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','bundle-creator','creator','status text','status_change','{"event_type":"resolved"}','customer',now()-interval '1 minute');

insert into public.support_case_events(
  id,conversation_id,event_type,actor_id,from_status,to_status,note,metadata
) values(
  '55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',
  'resolved','bundle-creator','in_progress','resolved','resolved note','{}'
);

set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

do $$
declare
  bundle jsonb;
  contents jsonb;
begin
  perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
  bundle:=public.get_operational_conversation_bundle('33333333-3333-4333-8333-333333333333');

  if jsonb_array_length(bundle->'messages')<>2 then
    raise exception 'Operations chat did not isolate two customer-visible messages';
  end if;
  if jsonb_array_length(bundle->'internal_notes')<>1 then
    raise exception 'Operations internal-note lane is not separate';
  end if;
  if jsonb_array_length(bundle->'events')<>1 then
    raise exception 'Case history was not projected separately';
  end if;
  select jsonb_agg(item->>'content' order by item->>'content')
    into contents from jsonb_array_elements(bundle->'messages') item;
  if contents <> '["hello","reply"]'::jsonb then
    raise exception 'Internal/status records leaked into customer message lane: %',contents;
  end if;

  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  bundle:=public.get_operational_conversation_bundle('33333333-3333-4333-8333-333333333333');
  if jsonb_array_length(bundle->'internal_notes')<>0 then
    raise exception 'Requester can read WeHouse-only internal notes';
  end if;
end
$$;

rollback;

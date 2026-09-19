\set ON_ERROR_STOP on

begin;

-- Synthetic requester. The fixture and every created conversation/message are
-- rolled back at the end of this contract.
set local session_replication_role=replica;
insert into public.profiles(
  auth_id,email,user_id,role,profile_complete,full_name,state,city,local_government
) values(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'support-atomic-contract@example.invalid',
  'support-atomic-contract','user',true,'Support Atomic Contract',
  'Nasarawa','Lafia','Lafia'
);
set local session_replication_role=origin;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$
declare
  v_draft uuid;
  v_failed_draft uuid;
  v_first jsonb;
  v_replay jsonb;
  v_conversation uuid;
  v_message uuid;
  v_before integer;
  v_rejected boolean:=false;
begin
  if not exists(
    select 1 from storage.buckets
    where id='support-files' and public=false and file_size_limit=26214400
  ) then
    raise exception 'Private support-files bucket is not reproducible from migrations';
  end if;

  if (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname in('support_files_insert','support_files_read','support_files_delete'))<>3 then
    raise exception 'Support evidence Storage policies are incomplete';
  end if;

  select count(*) into v_before
  from public.partner_support_conversations
  where partner_id='support-atomic-contract';

  v_draft:=public.create_my_support_message_draft();
  v_first:=public.send_my_first_wehouse_message(
    v_draft,
    'Account help','general','general',null,'{}'::jsonb,'normal',
    'Please help with my account','{}'::text[],'{}'::text[]
  );
  v_conversation:=(v_first->>'conversation_id')::uuid;
  v_message:=(v_first->>'message_id')::uuid;

  if v_conversation is null or v_message is null then
    raise exception 'First Send did not return canonical conversation/message ids';
  end if;
  if (select count(*) from public.partner_support_conversations
      where partner_id='support-atomic-contract')<>v_before+1 then
    raise exception 'First Send did not create exactly one conversation';
  end if;
  if not exists(
    select 1 from public.partner_support_messages
    where id=v_message and conversation_id=v_conversation
      and sender_id='support-atomic-contract'
  ) then
    raise exception 'First Send did not persist the first customer message';
  end if;

  v_replay:=public.send_my_first_wehouse_message(
    v_draft,
    'Account help','general','general',null,'{}'::jsonb,'normal',
    'Please help with my account','{}'::text[],'{}'::text[]
  );
  if v_replay->>'conversation_id'<>v_first->>'conversation_id'
     or v_replay->>'message_id'<>v_first->>'message_id' then
    raise exception 'First-Send replay did not return the original result';
  end if;
  if (select count(*) from public.partner_support_messages
      where conversation_id=v_conversation
        and sender_id='support-atomic-contract')<>1 then
    raise exception 'First-Send replay duplicated the customer message';
  end if;

  -- A failed first Send must leave no conversation/request behind. The draft
  -- remains retryable because the whole command rolls back.
  v_failed_draft:=public.create_my_support_message_draft();
  begin
    perform public.send_my_first_wehouse_message(
      v_failed_draft,
      'Invalid empty first send','general','general',null,'{}'::jsonb,'normal',
      '','{}'::text[],'{}'::text[]
    );
  exception when others then
    v_rejected:=position('Message or attachment is required' in sqlerrm)>0;
  end;
  if not v_rejected then
    raise exception 'Empty first Send was not rejected';
  end if;
  if (select count(*) from public.partner_support_conversations
      where partner_id='support-atomic-contract')<>v_before+1 then
    raise exception 'Failed first Send left an orphan conversation';
  end if;
  if not exists(
    select 1 from public.support_message_drafts
    where draft_id=v_failed_draft and consumed_at is null
  ) then
    raise exception 'Failed first Send consumed its retryable draft';
  end if;
end;
$$;

rollback;

begin;

do $contract$
declare
  candidate text; event jsonb; result jsonb; choices jsonb:='{}'; documents jsonb;
  kind text;
begin
  documents:=public.get_current_legal_documents();
  foreach kind in array array['privacy','terms'] loop
    if documents->kind is not null and documents->kind<>'null'::jsonb then
      choices:=choices||jsonb_build_object(kind,jsonb_build_object(
        'policy_version_id',documents#>>array[kind,'policy_version_id'],
        'checksum',documents#>>array[kind,'checksum']));
    end if;
  end loop;
  foreach candidate in array array['someone@mailinator.com','someone@MAILINATOR.COM',
    'someone@child.mailinator.com','someone@10minutemail.com',
    'someone@guerrillamail.com','someone@yopmail.com'] loop
    event:=jsonb_build_object('user',jsonb_build_object('email',candidate,
      'user_metadata',jsonb_build_object('legal_review',choices),
      'app_metadata',jsonb_build_object('provider','email')));
    result:=public.require_reviewed_legal_signup(event);
    if result#>>'{error,http_code}'<>'403' or result#>>'{error,message}' not like '%Temporary email%' then
      raise exception 'Temporary address was not rejected: %',candidate;
    end if;
    event:=jsonb_set(event,'{user,app_metadata,provider}','"google"');
    if public.require_reviewed_legal_signup(event)#>>'{error,message}' not like '%Temporary email%' then
      raise exception 'OAuth creation skipped the email policy';
    end if;
  end loop;
  foreach candidate in array array['person@gmail.com','person@hotmail.com','person@outlook.com',
    'person@yahoo.com','person@proton.me','person@fastmail.com','person@icloud.com',
    'person@privaterelay.appleid.com','person@mozmail.com','person@duck.com',
    'person@simplelogin.com','person+alias@business.example.invalid',
    'person@mailinator.com.example.invalid','person@notmailinator.example.invalid'] loop
    event:=jsonb_build_object('user',jsonb_build_object('email',candidate,
      'user_metadata',jsonb_build_object('legal_review',choices)));
    if public.require_reviewed_legal_signup(event)<>'{}'::jsonb then
      raise exception 'Permanent, private-relay or similar-looking domain was blocked: %',candidate;
    end if;
  end loop;
  if not has_function_privilege('supabase_auth_admin','public.require_reviewed_legal_signup(jsonb)','execute')
    or not has_schema_privilege('supabase_auth_admin','private','usage')
    or not has_table_privilege('supabase_auth_admin','private.disposable_email_domains','select') then
    raise exception 'Auth service cannot enforce the installed hook';
  end if;
  if has_table_privilege('anon','private.disposable_email_domains','select')
    or has_table_privilege('authenticated','private.disposable_email_domains','insert')
    or has_function_privilege('authenticated','public.require_reviewed_legal_signup(jsonb)','execute') then
    raise exception 'Signup policy authority is browser-accessible';
  end if;
end;
$contract$;

select 'signup_email_domain_contract_ok';
rollback;

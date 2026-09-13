-- Privacy and Terms use the same immutable Creator policy authority as every
-- commercial rule. Raw platform_settings text remains historical input only;
-- it is no longer a publication or acceptance authority.

create unique index if not exists policy_acceptance_one_general_receipt
  on public.policy_acceptance_receipts(user_id,policy_version_id)
  where lifecycle_subject_type is null and lifecycle_subject_id is null;

create or replace function public.enforce_legal_document_policy()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare v_body text; v_title text; v_locale text; v_review text;
begin
  if new.policy_key not in('legal_privacy','legal_terms') then return new; end if;
  v_body:=btrim(coalesce(new.value->>'body',''));
  v_title:=btrim(coalesce(new.value->>'title',''));
  v_locale:=btrim(coalesce(new.value->>'locale',''));
  v_review:=btrim(coalesce(new.value->>'review_reference',''));
  if new.scope_type<>'global' or new.scope_key<>'*' then
    raise exception 'Launch legal documents must use global scope';
  end if;
  if not new.public_disclosure then
    raise exception 'Legal documents must be publicly readable';
  end if;
  if char_length(v_title)<3 or char_length(v_body)<500 or v_locale='' then
    raise exception 'Legal document title, locale and complete body are required';
  end if;
  if new.status in('active','scheduled') and (
    new.legal_review_state<>'reviewed' or v_review=''
  ) then
    raise exception 'A reviewed legal document and review reference are required for publication';
  end if;
  return new;
end
$$;

drop trigger if exists enforce_legal_document_policy
on public.creator_policy_versions;
create trigger enforce_legal_document_policy
before insert or update on public.creator_policy_versions
for each row execute function public.enforce_legal_document_policy();

create or replace function public.creator_save_legal_draft(
  p_document text,p_title text,p_body text,p_locale text,p_reason text
)
returns public.creator_policy_versions
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_key text;
  v_version integer;
  v_value jsonb;
  v_result public.creator_policy_versions;
begin
  if not public.current_actor_has_workspace('creator',null) then
    raise exception 'Creator authority required';
  end if;
  if p_document not in('privacy','terms') then
    raise exception 'Document must be privacy or terms';
  end if;
  if char_length(btrim(coalesce(p_body,'')))<500 then
    raise exception 'Complete legal document body is required';
  end if;
  if char_length(btrim(coalesce(p_reason,'')))<5 then
    raise exception 'Draft reason is required';
  end if;
  v_key:=case when p_document='privacy' then 'legal_privacy' else 'legal_terms' end;
  perform pg_advisory_xact_lock(hashtext('legal-document:'||v_key||':'||coalesce(p_locale,'en-NG')));
  select coalesce(max(version),0)+1 into v_version
  from public.creator_policy_versions
  where policy_key=v_key and scope_type='global' and scope_key='*';
  v_value:=jsonb_build_object(
    'document_type',p_document,
    'title',btrim(coalesce(p_title,case when p_document='privacy'
      then 'Privacy Policy' else 'Terms & Conditions' end)),
    'body',btrim(p_body),
    'locale',coalesce(nullif(btrim(p_locale),''),'en-NG'),
    'review_reference',null
  );
  insert into public.creator_policy_versions(
    policy_key,scope_type,scope_key,version,value,value_schema,status,
    effective_from,public_disclosure,disclosure_text,legal_review_state,
    reason,created_by,checksum
  ) values(
    v_key,'global','*',v_version,v_value,
    '{"type":"legal_document","required":["document_type","title","body","locale","review_reference"]}'::jsonb,
    'draft',now(),true,'Published legal document','pending',btrim(p_reason),
    v_actor,md5(v_value::text)
  ) returning * into v_result;
  return v_result;
end
$$;

create or replace function public.creator_publish_legal_document(
  p_policy_version_id uuid,p_effective_from timestamptz,
  p_review_reference text,p_creator_elevation_id uuid
)
returns public.creator_policy_versions
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_draft public.creator_policy_versions;
  v_result public.creator_policy_versions;
  v_status text;
  v_effective timestamptz:=coalesce(p_effective_from,now());
  v_value jsonb;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator policy authentication required';
  end if;
  if char_length(btrim(coalesce(p_review_reference,'')))<3 then
    raise exception 'Record the legal review reference before publication';
  end if;
  select * into v_draft from public.creator_policy_versions
  where policy_version_id=p_policy_version_id
    and policy_key in('legal_privacy','legal_terms')
    and status='draft' for update;
  if v_draft.policy_version_id is null then
    raise exception 'Legal draft not found';
  end if;
  v_status:=case when v_effective>now() then 'scheduled' else 'active' end;
  v_value:=jsonb_set(v_draft.value,'{review_reference}',
    to_jsonb(btrim(p_review_reference)),true);
  update public.creator_policy_versions set status='retired',retired_at=now()
  where policy_key=v_draft.policy_key and scope_type='global' and scope_key='*'
    and status='scheduled';
  if v_status='active' then
    update public.creator_policy_versions
    set status='retired',effective_until=v_effective,retired_at=now()
    where policy_key=v_draft.policy_key and scope_type='global' and scope_key='*'
      and status='active';
  end if;
  update public.creator_policy_versions set
    value=v_value,status=v_status,effective_from=v_effective,
    legal_review_state='reviewed',approved_by=v_actor,published_at=now(),
    checksum=md5(v_value::text)
  where policy_version_id=v_draft.policy_version_id
  returning * into v_result;
  insert into public.admin_audit_log(
    admin_id,action,target_type,target_id,details,created_at
  ) values(
    v_actor,'creator_publish_legal_document','creator_policy_version',
    v_result.policy_version_id::text,
    jsonb_build_object('document',v_result.value->>'document_type',
      'version',v_result.version,'effective_from',v_result.effective_from,
      'review_reference',btrim(p_review_reference),
      'creator_elevation_id',p_creator_elevation_id)::text,now()
  );
  return v_result;
end
$$;

create or replace function public.get_current_legal_documents()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select jsonb_build_object(
    'privacy',(select jsonb_build_object(
      'policy_version_id',p.policy_version_id,'version',p.version,
      'title',p.value->>'title','body',p.value->>'body',
      'locale',p.value->>'locale','effective_from',p.effective_from,
      'checksum',p.checksum
    ) from public.creator_policy_versions p
      where p.policy_key='legal_privacy' and p.status='active'
        and p.legal_review_state='reviewed' and p.public_disclosure
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1),
    'terms',(select jsonb_build_object(
      'policy_version_id',p.policy_version_id,'version',p.version,
      'title',p.value->>'title','body',p.value->>'body',
      'locale',p.value->>'locale','effective_from',p.effective_from,
      'checksum',p.checksum
    ) from public.creator_policy_versions p
      where p.policy_key='legal_terms' and p.status='active'
        and p.legal_review_state='reviewed' and p.public_disclosure
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      order by p.effective_from desc limit 1)
  )
$$;

create or replace function public.get_my_legal_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_documents jsonb;
  v_privacy uuid;
  v_terms uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  v_documents:=public.get_current_legal_documents();
  v_privacy:=nullif(v_documents#>>'{privacy,policy_version_id}','')::uuid;
  v_terms:=nullif(v_documents#>>'{terms,policy_version_id}','')::uuid;
  return jsonb_build_object(
    'privacy_accepted',v_privacy is not null and exists(
      select 1 from public.policy_acceptance_receipts
      where user_id=v_user and policy_version_id=v_privacy),
    'terms_accepted',v_terms is not null and exists(
      select 1 from public.policy_acceptance_receipts
      where user_id=v_user and policy_version_id=v_terms),
    'privacy_version_id',v_privacy,'terms_version_id',v_terms,
    'privacy_version',v_documents#>'{privacy,version}',
    'terms_version',v_documents#>'{terms,version}'
  );
end
$$;

create or replace function public.accept_current_legal(p_document text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user text:=public.current_profile_user_id();
  v_documents jsonb;
  v_policy_id uuid;
  v_version text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_document not in('privacy','terms') then
    raise exception 'Invalid legal document';
  end if;
  v_documents:=public.get_current_legal_documents();
  v_policy_id:=nullif(v_documents#>>array[p_document,'policy_version_id'],'')::uuid;
  if v_policy_id is null then raise exception 'Legal document is not published'; end if;
  insert into public.policy_acceptance_receipts(
    user_id,policy_version_id,presentation,locale,source
  ) values(
    v_user,v_policy_id,'full_document_checkbox',
    coalesce(v_documents#>>array[p_document,'locale'],'en-NG'),'account'
  ) on conflict do nothing;
  if p_document='privacy' then
    update public.profiles set privacy_accepted_at=now(),updated_at=now()
    where user_id=v_user;
  else
    update public.profiles set terms_accepted_at=now(),updated_at=now()
    where user_id=v_user;
  end if;
  if (public.get_my_legal_status()->>'privacy_accepted')::boolean
    and (public.get_my_legal_status()->>'terms_accepted')::boolean then
    v_version:='privacy:'||coalesce(v_documents#>>'{privacy,version}','-')
      ||'|terms:'||coalesce(v_documents#>>'{terms,version}','-');
    update public.profiles set legal_accepted_version=v_version,updated_at=now()
    where user_id=v_user;
  end if;
  return public.get_my_legal_status();
end
$$;

create or replace function public.block_legacy_legal_setting_writes()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $$
declare v_key text:=case when tg_op='DELETE' then old.key else new.key end;
begin
  if v_key in('privacy_policy','terms_of_service','legal_version') then
    raise exception 'Use the versioned Creator legal document registry';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists block_legacy_legal_setting_writes
on public.platform_settings;
create trigger block_legacy_legal_setting_writes
before insert or update or delete on public.platform_settings
for each row execute function public.block_legacy_legal_setting_writes();

revoke all on function public.enforce_legal_document_policy()
from public,anon,authenticated;
revoke all on function public.block_legacy_legal_setting_writes()
from public,anon,authenticated;
grant execute on function public.enforce_legal_document_policy() to service_role;
grant execute on function public.block_legacy_legal_setting_writes() to service_role;
revoke all on function public.creator_save_legal_draft(text,text,text,text,text)
from public,anon;
grant execute on function public.creator_save_legal_draft(text,text,text,text,text)
to authenticated,service_role;
revoke all on function public.creator_publish_legal_document(uuid,timestamptz,text,uuid)
from public,anon;
grant execute on function public.creator_publish_legal_document(uuid,timestamptz,text,uuid)
to authenticated,service_role;
revoke all on function public.get_current_legal_documents() from public;
grant execute on function public.get_current_legal_documents()
to anon,authenticated,service_role;
revoke all on function public.get_my_legal_status() from public,anon;
grant execute on function public.get_my_legal_status()
to authenticated,service_role;
revoke all on function public.accept_current_legal(text) from public,anon;
grant execute on function public.accept_current_legal(text)
to authenticated,service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select p.oid::regprocedure::text,p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',p.oid,'execute'),
  has_function_privilege('anon',p.oid,'execute'),
  has_function_privilege('authenticated',p.oid,'execute'),
  has_function_privilege('service_role',p.oid,'execute'),
  case when p.proname='get_current_legal_documents'
    then 'approved_public_projection'
    when p.proname in('enforce_legal_document_policy','block_legacy_legal_setting_writes')
    then 'approved_service_only'
    else 'approved_client_rpc' end,
  case when p.proname='get_current_legal_documents'
    then 'Current reviewed legal documents without acceptance or identity data'
    when p.proname in('enforce_legal_document_policy','block_legacy_legal_setting_writes')
    then 'Internal legal registry integrity trigger'
    else 'Versioned legal draft, publication, status or acceptance command' end,
  now()
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in(
  'enforce_legal_document_policy','creator_save_legal_draft',
  'creator_publish_legal_document','get_current_legal_documents',
  'get_my_legal_status','accept_current_legal',
  'block_legacy_legal_setting_writes'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,rationale=excluded.rationale,captured_at=now();

comment on function public.get_current_legal_documents() is
  'Public projection of only active, reviewed, versioned Privacy and Terms documents.';
comment on table public.policy_acceptance_receipts is
  'Immutable per-version acceptance receipts, including legal document versions.';

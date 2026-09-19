-- Accept only the exact published text displayed to the person.
create or replace function public.accept_reviewed_legal(
  p_document text, p_policy_version_id uuid, p_checksum text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_user text := public.current_profile_user_id();
  v_documents jsonb;
  v_document jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_document is null or p_document not in ('privacy','terms') then raise exception 'Invalid legal document'; end if;
  v_documents := public.get_current_legal_documents();
  v_document := v_documents -> p_document;
  if p_policy_version_id is null or p_checksum is null
    or v_document->>'policy_version_id' is distinct from p_policy_version_id::text
    or v_document->>'checksum' is distinct from p_checksum then
    raise exception 'Review the current document before confirming';
  end if;
  insert into public.policy_acceptance_receipts(user_id,policy_version_id,presentation,locale,source)
  values(v_user,p_policy_version_id,'full_document_checkbox',coalesce(v_document->>'locale','en-NG'),'account')
  on conflict do nothing;
  if p_document = 'privacy' then
    update public.profiles set privacy_accepted_at=now(),updated_at=now() where user_id=v_user;
  else
    update public.profiles set terms_accepted_at=now(),updated_at=now() where user_id=v_user;
  end if;
  if (public.get_my_legal_status()->>'privacy_accepted')::boolean
    and (public.get_my_legal_status()->>'terms_accepted')::boolean then
    update public.profiles set legal_accepted_version='privacy:'||(v_documents#>>'{privacy,version}')
      ||'|terms:'||(v_documents#>>'{terms,version}'),updated_at=now() where user_id=v_user;
  end if;
  return public.get_my_legal_status();
end;
$$;
revoke all on function public.accept_reviewed_legal(text,uuid,text) from public,anon;
grant execute on function public.accept_reviewed_legal(text,uuid,text) to authenticated,service_role;
-- Stale clients must reload rather than accept unseen text using the old RPC.
revoke execute on function public.accept_current_legal(text) from public,anon,authenticated;

create or replace function public.require_legal_before_profile_completion()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_documents jsonb; v_kind text;
begin
  if not new.profile_complete then return new; end if;
  if tg_op='UPDATE' and old.profile_complete then return new; end if;
  v_documents := public.get_current_legal_documents();
  foreach v_kind in array array['privacy','terms'] loop
    if v_documents#>>array[v_kind,'policy_version_id'] is null or not exists (
      select 1 from public.policy_acceptance_receipts r where r.user_id=new.user_id
        and r.policy_version_id::text=v_documents#>>array[v_kind,'policy_version_id']
    ) then raise exception 'Review and confirm both current legal documents before completing your account'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.require_legal_before_profile_completion() from public,anon,authenticated;
create trigger require_legal_before_profile_completion
before insert or update of profile_complete on public.profiles
for each row execute function public.require_legal_before_profile_completion();

-- Configure as the Supabase Before User Created hook. Existing sign-ins are
-- unaffected. New users take Create account -> review -> email/password ->
-- Google verification; a direct OAuth callback cannot skip registration.
-- The declaration is consent only; it never grants a role or data access.
create or replace function public.require_reviewed_legal_signup(event jsonb)
returns jsonb language plpgsql set search_path = pg_catalog, public
as $$
declare v_documents jsonb; v_kind text; v_choice jsonb;
begin
  v_documents := public.get_current_legal_documents();
  if v_documents->>'privacy' is null or v_documents->>'terms' is null then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
      'Registration is unavailable until the Privacy Policy and Terms of Service are published.'));
  end if;
  foreach v_kind in array array['privacy','terms'] loop
    v_choice := event#>array['user','user_metadata','legal_review',v_kind];
    if v_choice->>'policy_version_id' is distinct from v_documents#>>array[v_kind,'policy_version_id']
      or v_choice->>'checksum' is distinct from v_documents#>>array[v_kind,'checksum'] then
      return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
        'Choose Create account and review the current Privacy Policy and Terms of Service first.'));
    end if;
  end loop;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.require_reviewed_legal_signup(jsonb) from public,anon,authenticated;
grant execute on function public.require_reviewed_legal_signup(jsonb) to supabase_auth_admin;
grant execute on function public.get_current_legal_documents() to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

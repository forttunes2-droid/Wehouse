-- Owner correction: acceptance is required for each published document.
-- Absence of published text is not a registration or profile-completion block.
-- Registration/maintenance switches and all identity/age controls remain active.
create or replace function public.require_legal_before_profile_completion()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_documents jsonb; v_kind text;
begin
  if not new.profile_complete then return new; end if;
  if tg_op='UPDATE' and old.profile_complete then return new; end if;
  v_documents := public.get_current_legal_documents();
  foreach v_kind in array array['privacy','terms'] loop
    if v_documents->v_kind is null or v_documents->v_kind='null'::jsonb then continue; end if;
    if v_documents#>>array[v_kind,'policy_version_id'] is null or not exists (
      select 1 from public.policy_acceptance_receipts r where r.user_id=new.user_id
        and r.policy_version_id::text=v_documents#>>array[v_kind,'policy_version_id']
    ) then raise exception 'Review and confirm each published legal document before completing your account'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.require_legal_before_profile_completion() from public,anon,authenticated;

create or replace function public.require_reviewed_legal_signup(event jsonb)
returns jsonb language plpgsql set search_path = pg_catalog, public
as $$
declare v_documents jsonb; v_kind text; v_choice jsonb; v_access jsonb;
begin
  v_access := public.get_signup_availability();
  if (v_access->>'maintenance_mode')::boolean then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
      'WeHouse is currently under maintenance. Please check back later.'));
  end if;
  if not (v_access->>'registration_open')::boolean then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
      'New registrations are currently closed.'));
  end if;
  v_documents := public.get_current_legal_documents();
  foreach v_kind in array array['privacy','terms'] loop
    if v_documents->v_kind is null or v_documents->v_kind='null'::jsonb then continue; end if;
    v_choice := event#>array['user','user_metadata','legal_review',v_kind];
    if v_documents#>>array[v_kind,'policy_version_id'] is null
      or v_documents#>>array[v_kind,'checksum'] is null
      or v_choice->>'policy_version_id' is distinct from v_documents#>>array[v_kind,'policy_version_id']
      or v_choice->>'checksum' is distinct from v_documents#>>array[v_kind,'checksum'] then
      return jsonb_build_object('error',jsonb_build_object('http_code',403,'message',
        'Choose Create account and review the published legal documents first.'));
    end if;
  end loop;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.require_reviewed_legal_signup(jsonb) from public,anon,authenticated;
grant execute on function public.require_reviewed_legal_signup(jsonb) to supabase_auth_admin;

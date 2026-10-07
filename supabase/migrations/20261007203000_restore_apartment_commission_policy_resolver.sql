begin;

create or replace function private.resolve_apartment_commission_policy(
  p_stay_type text,
  p_management_mode text,
  p_policy_version_id uuid default null
)
returns table(policy_version_id uuid, policy_key text, percent numeric)
language plpgsql
stable security definer
set search_path to 'pg_catalog','public','private'
as $function$
declare
  v_base_key text := case
    when p_stay_type='short_let' then 'commission_short_let'
    else 'commission_long_let'
  end;
  v_key text;
begin
  v_key := case
    when p_management_mode='wehouse' then v_base_key || '_wehouse_managed'
    else v_base_key
  end;

  return query
  select p.policy_version_id,p.policy_key,(p.value->>'percent')::numeric
  from public.creator_policy_versions p
  where p.policy_key=v_key
    and p.scope_type='global'
    and p.scope_key='*'
    and (
      (p_policy_version_id is not null and p.policy_version_id=p_policy_version_id)
      or (
        p_policy_version_id is null
        and p.status='active'
        and p.effective_from<=now()
        and (p.effective_until is null or p.effective_until>now())
      )
    )
  order by p.effective_from desc,p.version desc
  limit 1;
end
$function$;

revoke all on function private.resolve_apartment_commission_policy(text,text,uuid) from public,anon,authenticated;

commit;
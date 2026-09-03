create or replace function public.prevent_privileged_self_review() returns trigger
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare actor text:=public.current_profile_user_id(); v_new jsonb:=to_jsonb(new); v_old jsonb:=to_jsonb(old);
begin
  if actor is null then return new; end if;
  if tg_table_name='listings'
     and (v_new->>'approved_by' is distinct from v_old->>'approved_by' or (v_old->>'status' is distinct from v_new->>'status' and v_new->>'status' in('available','rejected')))
     and actor in(coalesce(v_new->>'owner_id',''),coalesce(v_new->>'partner_id','')) then
    raise exception 'Another authorized person must review your listing';
  elsif tg_table_name='profiles'
     and (v_new->>'worker_status' in('verified','rejected') or coalesce((v_new->>'worker_verified')::boolean,false))
     and (v_new->>'worker_status' is distinct from v_old->>'worker_status' or v_new->>'worker_verified' is distinct from v_old->>'worker_verified')
     and actor=v_new->>'user_id' then
    raise exception 'Another authorized person must review your Worker verification';
  elsif tg_table_name='reservations'
     and v_new->>'status'='refunded' and v_old->>'status' is distinct from v_new->>'status' and actor=v_new->>'user_id' then
    raise exception 'Another authorized person must process your refund';
  elsif tg_table_name='inspection_requests'
     and v_new->>'access_evidence_status' in('verified','rejected')
     and v_old->>'access_evidence_status' is distinct from v_new->>'access_evidence_status'
     and actor=v_new->>'owner_id' then
    raise exception 'Another authorized person must review your property evidence';
  end if;
  return new;
end $$;

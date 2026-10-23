begin;
create or replace function private.invalidate_worker_credential_context() returns trigger language plpgsql security definer set search_path='' as $$
declare target_worker text;
begin
 if tg_table_name='profiles' then target_worker:=new.user_id;
 elsif tg_op='DELETE' then target_worker:=old.worker_id;
 else target_worker:=new.worker_id;end if;
 if exists(select 1 from public.worker_verifications v where v.worker_id=target_worker and v.credential_requirements is not null and v.credential_context is distinct from private.worker_credential_context(target_worker)) then
  update public.profiles set worker_status='profile_under_review',worker_verified=false,available=false,updated_at=now() where user_id=target_worker;
  perform private.worker_credential_required_activity(target_worker);
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
commit;

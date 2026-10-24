begin;
alter function public.my_native_push_device(text,text,text,text) set schema private;
revoke all on function private.my_native_push_device(text,text,text,text) from public,anon,authenticated;
create function public.my_native_push_device(p_device_id text,p_platform text,p_action text default 'status',p_token text default null,p_expected_user_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_expected_user_id is null or p_expected_user_id is distinct from public.current_profile_user_id() then raise exception 'The signed-in account changed'; end if;
 result:=private.my_native_push_device(p_device_id,p_platform,p_action,p_token);
 if p_action='disable' then
  update public.native_push_jobs j set status='cancelled',last_error='disabled_by_user'
   from public.native_push_devices d where d.id=j.device_id and d.user_id=p_expected_user_id and d.device_id=p_device_id and d.platform=p_platform and j.status in ('queued','sending');
 end if;
 return result||jsonb_build_object('user_id',p_expected_user_id);
end $$;
revoke all on function public.my_native_push_device(text,text,text,text,text) from public,anon;
grant execute on function public.my_native_push_device(text,text,text,text,text) to authenticated;

-- End-device operations immediately invalidate consent, including future token refresh.
create function private.disable_ended_device_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.is_active or new.trust_status='rejected' then
  update public.native_push_devices set enabled=false,updated_at=now() where user_id=new.user_id and auth_id=new.auth_id::uuid and auth_session_id=new.auth_session_id::uuid;
 end if;
 return new;
end $$;
revoke all on function private.disable_ended_device_push() from public,anon,authenticated;
create trigger native_push_end_session after update of is_active,trust_status on public.user_sessions for each row execute function private.disable_ended_device_push();

create function public.maintain_native_push_queue() returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 if (select auth.role())<>'service_role' then raise exception 'Service role required'; end if;
 update public.native_push_jobs set status='failed',last_error='retry_limit' where attempts>=5 and status='sending' and lease_until<now();
 delete from public.native_push_jobs where created_at<now()-interval '7 days' and status in ('sent','cancelled','failed');
 get diagnostics removed=row_count;
 delete from public.native_push_devices where updated_at<now()-interval '90 days';
 return removed;
end $$;
revoke all on function public.maintain_native_push_queue() from public,anon,authenticated;
grant execute on function public.maintain_native_push_queue() to service_role;
commit;

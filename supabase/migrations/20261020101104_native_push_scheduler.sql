begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Deployment credentials are resolved from Vault at execution time, never embedded
-- in cron.job or returned through an authenticated RPC. Missing secrets mean no send.
create function private.run_native_push_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text; request_id bigint;
begin
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='native_push_project_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='native_push_worker_secret';
 if endpoint is null or endpoint !~ '^https://[a-z]{20}\.supabase\.co$' or length(coalesce(secret,''))<32 then return null; end if;
 select net.http_post(url=>endpoint||'/functions/v1/native-push',headers=>jsonb_build_object('Content-Type','application/json','x-push-worker-secret',secret),body=>'{"action":"dispatch"}'::jsonb,timeout_milliseconds=>60000) into request_id;
 return request_id;
end $$;
revoke all on function private.run_native_push_worker() from public,anon,authenticated;
select cron.schedule('wehouse-native-push','* * * * *','select private.run_native_push_worker()');
commit;

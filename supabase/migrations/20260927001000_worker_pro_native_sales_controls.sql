-- Creator opens each native Worker plan independently after legal approval,
-- store products and current terms are configured. Existing subscribers remain.
insert into public.platform_settings(key,value,category,label,description,data_type,editable,is_active)
values
  ('worker_pro_ios_sales_enabled','false','worker_pro','App Store Worker plan sales',
   'New StoreKit subscriptions require store verification and legal launch approval.','boolean',false,true),
  ('worker_pro_android_sales_enabled','false','worker_pro','Google Play Worker plan sales',
   'New Play Billing subscriptions require store verification and legal launch approval.','boolean',false,true)
on conflict(key) do nothing;

create or replace function public.creator_set_worker_pro_native_sales(
  p_platform text,p_enabled boolean,p_creator_elevation_id uuid
) returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public' as $$
declare v_key text; v_prefix text; v_terms text; v_content text;
begin
  if not public.creator_has_elevation(p_creator_elevation_id,'policy_publish') then
    raise exception 'Recent Creator authentication required'; end if;
  if p_platform not in ('apple','google') or p_enabled is null then
    raise exception 'Choose a store and sale status'; end if;
  v_key:=case p_platform when 'apple' then 'worker_pro_ios_sales_enabled'
    else 'worker_pro_android_sales_enabled' end;
  v_prefix:=case p_platform when 'apple' then 'worker_pro_apple'
    else 'worker_pro_google' end;
  if p_enabled then
    select value into v_terms from public.platform_settings
      where key='worker_pro_terms_version' and is_active;
    select value into v_content from public.platform_settings
      where key='worker_pro_terms_content' and is_active;
    if nullif(btrim(coalesce(v_terms,'')),'') is null or length(btrim(coalesce(v_content,'')))<100
      or not exists(select 1 from public.platform_settings
        where key in (v_prefix||'_product_id',v_prefix||'_yearly_product_id')
          and is_active and nullif(btrim(value),'') is not null) then
      raise exception 'Configure store products and publish current subscription terms first'; end if;
  end if;
  update public.platform_settings set value=case when p_enabled then 'true' else 'false' end,
    updated_at=now() where key=v_key and category='worker_pro' and is_active;
  if not found then raise exception 'Native paid plan sale switch is unavailable'; end if;
  -- Existing legal launch gate trigger verifies the platform-specific approval.
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
    values(public.current_profile_user_id(),'worker_pro_native_sales_updated',
      'platform_settings',v_key,jsonb_build_object('enabled',p_enabled)::text,now());
  return true;
end $$;
revoke all on function public.creator_set_worker_pro_native_sales(text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.creator_set_worker_pro_native_sales(text,boolean,uuid) to authenticated;

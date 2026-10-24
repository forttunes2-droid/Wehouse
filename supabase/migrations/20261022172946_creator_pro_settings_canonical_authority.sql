-- Use live trusted Creator workspace authority for both Pro setting families.
CREATE OR REPLACE FUNCTION public.creator_set_partner_pro_setting(p_key text, p_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_value text:=btrim(coalesce(p_value,'')); v_month numeric; v_year numeric; v_version text; v_terms text;
begin
 if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
 if not public.current_actor_has_workspace('creator',null) then raise exception 'Creator access required'; end if;
 if p_key not in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn','partner_pro_monthly_plan_code',
   'partner_pro_yearly_plan_code','partner_pro_terms_version','partner_pro_terms_content','partner_pro_sales_enabled') then
   raise exception 'Setting is not part of Property Partner Pro'; end if;
 if p_key in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn') then
   if v_value !~ '^[0-9]+(\.[0-9]{1,2})?$' or v_value::numeric>10000000 then raise exception 'Invalid Partner Pro price'; end if;
 elsif p_key in ('partner_pro_monthly_plan_code','partner_pro_yearly_plan_code') then
   if v_value<>'' and v_value !~ '^PLN_[A-Za-z0-9]+$' then raise exception 'Invalid Paystack plan code'; end if;
 elsif p_key='partner_pro_sales_enabled' then
   if v_value not in ('true','false') then raise exception 'Invalid sales setting'; end if;
   if v_value='true' then
     select coalesce(nullif(value,'')::numeric,0) into v_month from public.platform_settings where key='partner_pro_monthly_price_ngn';
     select coalesce(nullif(value,'')::numeric,0) into v_year from public.platform_settings where key='partner_pro_yearly_price_ngn';
     select value into v_version from public.platform_settings where key='partner_pro_terms_version';
     select value into v_terms from public.platform_settings where key='partner_pro_terms_content';
     if coalesce(v_month,0)<=0 and coalesce(v_year,0)<=0 then raise exception 'Set a Partner Pro price first'; end if;
     if length(btrim(coalesce(v_version,'')))<1 or length(btrim(coalesce(v_terms,'')))<100 then raise exception 'Publish complete Partner Pro terms first'; end if;
   end if;
 elsif p_key='partner_pro_terms_version' and length(v_value)>100 then raise exception 'Terms version is too long';
 elsif p_key='partner_pro_terms_content' and length(v_value)>50000 then raise exception 'Terms are too long'; end if;
 if p_key in ('partner_pro_monthly_price_ngn','partner_pro_yearly_price_ngn','partner_pro_monthly_plan_code',
   'partner_pro_yearly_plan_code','partner_pro_terms_version','partner_pro_terms_content') and exists(
   select 1 from public.platform_settings where key=p_key and value is distinct from v_value) then
   update public.platform_settings set value='false',updated_at=now() where key='partner_pro_sales_enabled';
 end if;
 update public.platform_settings set value=v_value,updated_at=now() where key=p_key;
 if not found then raise exception 'Partner Pro setting is missing'; end if;
 insert into public.admin_audit_log(admin_id,action,target_type,target_id,details,created_at)
 values(public.current_profile_user_id(),'partner_pro_setting','platform_settings',p_key,
   jsonb_build_object('updated',true,'sales_enabled',(select value from public.platform_settings where key='partner_pro_sales_enabled'))::text,now());
 return true;
end $function$;
revoke all on function public.creator_set_partner_pro_setting(text,text) from public,anon,service_role;
grant execute on function public.creator_set_partner_pro_setting(text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.creator_set_worker_pro_setting(p_key text, p_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_value text:=btrim(coalesce(p_value,''));
  v_monthly_price numeric:=0;
  v_yearly_price numeric:=0;
  v_terms text:='';
  v_terms_content text:='';
  v_monthly_plan text:='';
  v_yearly_plan text:='';
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if not public.current_actor_has_workspace('creator',null) then raise exception 'Creator access required'; end if;
  if p_key not in(
    'worker_pro_monthly_price_ngn','worker_pro_yearly_price_ngn',
    'worker_pro_sales_enabled','worker_pro_apple_product_id',
    'worker_pro_apple_yearly_product_id','worker_pro_google_product_id',
    'worker_pro_google_yearly_product_id','worker_pro_web_paystack_plan_code',
    'worker_pro_web_paystack_yearly_plan_code','worker_pro_terms_version',
    'worker_pro_terms_content','worker_pro_support_response_hours',
    'worker_pro_payment_grace_days','worker_pro_product_name',
    'worker_pro_product_tagline','worker_featured_sales_enabled',
    'worker_featured_slot_count'
  ) then raise exception 'This setting is not part of the paid Worker plan'; end if;

  if p_key in('worker_pro_monthly_price_ngn','worker_pro_yearly_price_ngn') then
    if v_value !~ '^\d+(\.\d{1,2})?$' or v_value::numeric<0 or v_value::numeric>10000000 then
      raise exception 'Plan price must be between 0 and 10,000,000 NGN';
    end if;
  elsif p_key='worker_pro_support_response_hours' then
    if v_value !~ '^\d+$' or v_value::integer<1 or v_value::integer>168 then
      raise exception 'Support response target must be between 1 and 168 hours';
    end if;
  elsif p_key='worker_pro_payment_grace_days' then
    if v_value !~ '^\d+$' or v_value::integer<0 or v_value::integer>14 then
      raise exception 'Failed-payment grace must be between 0 and 14 days';
    end if;
  elsif p_key='worker_featured_slot_count' then
    if v_value !~ '^\d+$' or v_value::integer<0 or v_value::integer>6 then
      raise exception 'Featured Worker slots must be between 0 and 6';
    end if;
  elsif p_key='worker_featured_sales_enabled' then
    if lower(v_value) not in('true','false') then raise exception 'Featured setting must be true or false'; end if;
    if lower(v_value)='true' then
      if not public._legal_launch_gate_is_approved('worker_featured_placement') then
        raise exception 'Sponsored Worker placement has no current legal launch approval';
      end if;
      if not exists(
        select 1 from public.platform_settings
        where key='worker_marketplace_launch_enabled' and is_active=true
          and lower(value) in('true','1','yes','on')
      ) then raise exception 'Open the legally approved Worker marketplace before Featured Workers'; end if;
    end if;
  elsif p_key='worker_pro_sales_enabled' then
    if lower(v_value) not in('true','false') then raise exception 'Sales setting must be true or false'; end if;
    if lower(v_value)='true' then
      if not public._legal_launch_gate_is_approved('worker_pro_web_sales') then
        raise exception 'Paid Worker plan web sales have no current legal launch approval';
      end if;
      select coalesce(nullif(value,'')::numeric,0) into v_monthly_price from public.platform_settings where key='worker_pro_monthly_price_ngn';
      select coalesce(nullif(value,'')::numeric,0) into v_yearly_price from public.platform_settings where key='worker_pro_yearly_price_ngn';
      select coalesce(value,'') into v_monthly_plan from public.platform_settings where key='worker_pro_web_paystack_plan_code';
      select coalesce(value,'') into v_yearly_plan from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code';
      select coalesce(value,'') into v_terms from public.platform_settings where key='worker_pro_terms_version';
      select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content';
      if not(
        (v_monthly_price>0 and nullif(btrim(v_monthly_plan),'') is not null)
        or (v_yearly_price>0 and nullif(btrim(v_yearly_plan),'') is not null)
      ) then raise exception 'Configure and sync at least one web billing plan before enabling sales'; end if;
      if nullif(btrim(v_terms),'') is null then raise exception 'Publish a paid plan terms version before enabling sales'; end if;
      if length(btrim(v_terms_content))<100 then raise exception 'Publish complete paid plan subscription terms before enabling sales'; end if;
    end if;
  elsif p_key in(
    'worker_pro_apple_product_id','worker_pro_apple_yearly_product_id',
    'worker_pro_google_product_id','worker_pro_google_yearly_product_id',
    'worker_pro_web_paystack_plan_code','worker_pro_web_paystack_yearly_plan_code'
  ) then
    if v_value<>'' and v_value !~ '^[A-Za-z0-9._-]{3,160}$' then
      raise exception 'Invalid subscription product or plan identifier';
    end if;
  elsif p_key='worker_pro_terms_version' and length(v_value)>100 then
    raise exception 'Paid plan terms version is too long';
  elsif p_key='worker_pro_terms_content'
    and (v_value<>'' and (length(v_value)<100 or length(v_value)>50000)) then
      raise exception 'Paid plan subscription terms must be between 100 and 50,000 characters';
  elsif p_key='worker_pro_product_name' then
    if length(v_value)<3 or length(v_value)>40 then
      raise exception 'Paid Worker plan name must be between 3 and 40 characters';
    end if;
  elsif p_key='worker_pro_product_tagline' then
    if length(v_value)<10 or length(v_value)>140 then
      raise exception 'Paid Worker plan tagline must be between 10 and 140 characters';
    end if;
  end if;

  if p_key in('worker_pro_monthly_price_ngn','worker_pro_yearly_price_ngn') and exists(
    select 1 from public.platform_settings where key=p_key and value is distinct from v_value
  ) then
    update public.platform_settings set value='false',updated_at=now()
    where key='worker_pro_sales_enabled';
  end if;

  update public.platform_settings set value=v_value,updated_at=now()
  where key=p_key and category='worker_pro' and editable=true;
  if not found then raise exception 'Paid Worker plan setting is unavailable'; end if;

  if exists(
    select 1 from public.platform_settings
    where key='worker_pro_sales_enabled' and lower(value)='true' and is_active=true
  ) then
    select coalesce(nullif(value,'')::numeric,0) into v_monthly_price from public.platform_settings where key='worker_pro_monthly_price_ngn';
    select coalesce(nullif(value,'')::numeric,0) into v_yearly_price from public.platform_settings where key='worker_pro_yearly_price_ngn';
    select coalesce(value,'') into v_monthly_plan from public.platform_settings where key='worker_pro_web_paystack_plan_code';
    select coalesce(value,'') into v_yearly_plan from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code';
    select coalesce(value,'') into v_terms from public.platform_settings where key='worker_pro_terms_version';
    select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content';
    if not public._legal_launch_gate_is_approved('worker_pro_web_sales')
       or not(
         (v_monthly_price>0 and nullif(btrim(v_monthly_plan),'') is not null)
         or (v_yearly_price>0 and nullif(btrim(v_yearly_plan),'') is not null)
       )
       or nullif(btrim(v_terms),'') is null
       or length(btrim(v_terms_content))<100 then
      raise exception 'Disable paid plan web sales before clearing its approval, terms or final enabled plan';
    end if;
  end if;
  return true;
end;
$function$;
revoke all on function public.creator_set_worker_pro_setting(text,text) from public,anon,service_role;
grant execute on function public.creator_set_worker_pro_setting(text,text) to authenticated;

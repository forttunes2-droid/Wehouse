CREATE OR REPLACE FUNCTION public.get_my_worker_pro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_worker_id text;
  v_subscription public.worker_pro_subscriptions;
  v_monthly_price numeric:=0;
  v_yearly_price numeric:=0;
  v_enabled boolean:=false;
  v_ios_enabled boolean:=false;
  v_android_enabled boolean:=false;
  v_apple_monthly text:='';
  v_apple_yearly text:='';
  v_google_monthly text:='';
  v_google_yearly text:='';
  v_web_monthly text:='';
  v_web_yearly text:='';
  v_terms_version text:='';
  v_terms_content text:='';
  v_terms_sha256 text:='';
  v_terms_accepted boolean:=false;
  v_support_hours integer:=24;
  v_grace_days integer:=0;
  v_product_name text:='WeHouse Works';
  v_product_tagline text:='Run your work with clearer numbers, documents and reach.';
  v_featured_enabled boolean:=false;
  v_yearly_saving numeric:=0;
  v_yearly_discount numeric:=0;
begin
  select profile.user_id into v_worker_id
  from public.profiles profile
  where profile.auth_id=(select auth.uid())::text
    and public.user_has_active_workspace(profile.user_id,'worker')
    and not coalesce(profile.deleted,false)
    and not coalesce(profile.suspended,false)
    and not coalesce(profile.banned,false)
  limit 1;
  if v_worker_id is null then raise exception 'Active Worker workspace required'; end if;

  select * into v_subscription
  from public.worker_pro_subscriptions
  where worker_id=v_worker_id limit 1;
  select coalesce(nullif(value,'')::numeric,0) into v_monthly_price from public.platform_settings where key='worker_pro_monthly_price_ngn' and is_active=true limit 1;
  select coalesce(nullif(value,'')::numeric,0) into v_yearly_price from public.platform_settings where key='worker_pro_yearly_price_ngn' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_enabled from public.platform_settings where key='worker_pro_sales_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_ios_enabled from public.platform_settings where key='worker_pro_ios_sales_enabled' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_android_enabled from public.platform_settings where key='worker_pro_android_sales_enabled' and is_active=true limit 1;
  select coalesce(value,'') into v_apple_monthly from public.platform_settings where key='worker_pro_apple_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_apple_yearly from public.platform_settings where key='worker_pro_apple_yearly_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_google_monthly from public.platform_settings where key='worker_pro_google_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_google_yearly from public.platform_settings where key='worker_pro_google_yearly_product_id' and is_active=true limit 1;
  select coalesce(value,'') into v_web_monthly from public.platform_settings where key='worker_pro_web_paystack_plan_code' and is_active=true limit 1;
  select coalesce(value,'') into v_web_yearly from public.platform_settings where key='worker_pro_web_paystack_yearly_plan_code' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_version from public.platform_settings where key='worker_pro_terms_version' and is_active=true limit 1;
  select coalesce(value,'') into v_terms_content from public.platform_settings where key='worker_pro_terms_content' and is_active=true limit 1;
  select coalesce(nullif(value,'')::integer,24) into v_support_hours from public.platform_settings where key='worker_pro_support_response_hours' and is_active=true limit 1;
  select coalesce(nullif(value,'')::integer,0) into v_grace_days from public.platform_settings where key='worker_pro_payment_grace_days' and is_active=true limit 1;
  select coalesce(nullif(btrim(value),''),'WeHouse Works') into v_product_name from public.platform_settings where key='worker_pro_product_name' and is_active=true limit 1;
  select coalesce(nullif(btrim(value),''),'Run your work with clearer numbers, documents and reach.') into v_product_tagline from public.platform_settings where key='worker_pro_product_tagline' and is_active=true limit 1;
  select coalesce(lower(value) in('true','1','yes','on'),false) into v_featured_enabled from public.platform_settings where key='worker_featured_sales_enabled' and is_active=true limit 1;

  if nullif(btrim(v_terms_content),'') is not null then
    v_terms_sha256:=encode(extensions.digest(convert_to(v_terms_content,'UTF8'),'sha256'),'hex');
    select exists(
      select 1 from public.worker_pro_terms_acceptances acceptance
      where acceptance.worker_id=v_worker_id
        and acceptance.terms_version=v_terms_version
        and acceptance.terms_sha256=v_terms_sha256
    ) into v_terms_accepted;
  end if;
  v_yearly_saving:=greatest(v_monthly_price*12-v_yearly_price,0);
  if v_monthly_price>0 and v_yearly_saving>0 then
    v_yearly_discount:=round((v_yearly_saving/(v_monthly_price*12))*100,1);
  end if;

  return jsonb_build_object(
    'product_name',v_product_name,
    'product_tagline',v_product_tagline,
    'plan','worker_pro',
    'sales_enabled',coalesce(v_enabled,false),
    'native_sales',jsonb_build_object(
      'ios_enabled',coalesce(v_ios_enabled,false),
      'android_enabled',coalesce(v_android_enabled,false)
    ),
    'monthly_price_ngn',coalesce(v_monthly_price,0),
    'yearly_price_ngn',coalesce(v_yearly_price,0),
    'apple_product_id',coalesce(v_apple_monthly,''),
    'google_product_id',coalesce(v_google_monthly,''),
    'web_paystack_plan_code',coalesce(v_web_monthly,''),
    'plans',jsonb_build_array(
      jsonb_build_object(
        'billing_period','monthly','period','P1M','label','Monthly',
        'price_ngn',coalesce(v_monthly_price,0),
        'web_plan_code',coalesce(v_web_monthly,''),
        'apple_product_id',coalesce(v_apple_monthly,''),
        'google_product_id',coalesce(v_google_monthly,''),
        'web_available',coalesce(v_enabled,false) and v_monthly_price>0 and nullif(btrim(v_web_monthly),'') is not null,
        'saving_ngn',0,'discount_percent',0
      ),
      jsonb_build_object(
        'billing_period','yearly','period','P1Y','label','Yearly',
        'price_ngn',coalesce(v_yearly_price,0),
        'web_plan_code',coalesce(v_web_yearly,''),
        'apple_product_id',coalesce(v_apple_yearly,''),
        'google_product_id',coalesce(v_google_yearly,''),
        'web_available',coalesce(v_enabled,false) and v_yearly_price>0 and nullif(btrim(v_web_yearly),'') is not null,
        'saving_ngn',v_yearly_saving,'discount_percent',v_yearly_discount
      )
    ),
    'terms_version',coalesce(v_terms_version,''),
    'terms_content',coalesce(v_terms_content,''),
    'terms_accepted',coalesce(v_terms_accepted,false),
    'support_response_hours',coalesce(v_support_hours,24),
    'payment_grace_days',coalesce(v_grace_days,0),
    'active',public.worker_pro_is_active(v_worker_id),
    'status',coalesce(v_subscription.status,'inactive'),
    'provider',v_subscription.provider,
    'product_id',v_subscription.product_id,
    'billing_period',coalesce(v_subscription.billing_period,'monthly'),
    'current_period_start',v_subscription.current_period_start,
    'current_period_end',v_subscription.current_period_end,
    'cancel_at_period_end',coalesce(v_subscription.cancel_at_period_end,false),
    'auto_renews',coalesce(v_subscription.auto_renews,false),
    'features',jsonb_build_array(
      'Work Insights from completed WeHouse records',
      'Quotes and invoices with clear payment labels'
    )
  );
end;
$function$
;
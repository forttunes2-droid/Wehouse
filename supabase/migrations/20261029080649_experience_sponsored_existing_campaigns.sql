-- Activities extend Sponsored resources, prices, orders and reporting. Promotion
-- never creates an activity approval, capacity hold, discount or booking.
alter table public.sponsored_market_rules drop constraint sponsored_market_rules_resource_type_check;
alter table public.sponsored_market_rules add constraint sponsored_market_rules_resource_type_check check(resource_type in('worker','property','hotel','experience'));
alter table public.sponsored_campaigns drop constraint sponsored_campaigns_resource_type_check;
alter table public.sponsored_campaigns add constraint sponsored_campaigns_resource_type_check check(resource_type in('worker','property','hotel','experience'));

create function private.sponsored_experience_context(p_resource_id text,p_owner text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('state_name',a.details->>'state','state_key',public.wehouse_state_key(a.details->>'state'),
  'lga_name',a.details->>'local_area','lga_key',public.worker_market_text_key(a.details->>'local_area'),
  'category_key',public.worker_market_text_key(a.details->>'category'))
 from public.experience_activities a
 where a.id::text=p_resource_id and a.host_user_id=p_owner and a.details->>'country_code'='NG'
  and private.experience_is_published(a.id)
  and exists(select 1 from public.experience_sessions s where s.activity_id=a.id and s.status='draft'
   and s.starts_at>now() and s.currency='NGN' and private.experience_session_remaining(s.id)>0);
$$;
revoke all on function private.sponsored_experience_context(text,text) from public,anon,authenticated,service_role;

do $extend$declare definition text;needle text;signature text;begin
 definition:=pg_get_functiondef('public._my_sponsored_resource_context(text,text)'::regprocedure);
 needle:='  if p_resource_type=''worker'' then';
 if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored resource authority';end if;
 execute replace(definition,needle,$activity$  if p_resource_type='experience' then
    v_actor:=private.experience_host_actor();
    if private.sponsored_experience_context(p_resource_id,v_actor) is null then raise exception 'A published activity you host with available dates is required';end if;
    return private.sponsored_experience_context(p_resource_id,v_actor);
  end if;
  if p_resource_type='worker' then$activity$);

 foreach signature in array array['public.creator_set_sponsored_market_rule(text,text,text,text,boolean,integer,numeric,integer[],uuid)',
  'public.quote_my_sponsored_campaign(text,text,integer)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='p_resource_type not in (''worker'',''property'',''hotel'')';
  if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored type validation: %',signature;end if;
  definition:=replace(definition,needle,'p_resource_type not in (''worker'',''property'',''hotel'',''experience'')');
  execute replace(definition,'Choose Worker, Property or Hotel','Choose a service profile, home, hotel or activity');
 end loop;

 definition:=pg_get_functiondef('public.get_my_sponsored_resources()'::regprocedure);
 needle:='  union all';
 if strpos(definition,needle)=0 then raise exception 'Inspect owned Sponsored resources';end if;
 execute overlay(definition placing $owned$  union all
  select 'experience',a.id::text,a.details->>'title' from public.experience_activities a
   where a.host_user_id=public.current_profile_user_id() and public.user_has_active_workspace(a.host_user_id,'worker')
    and private.sponsored_experience_context(a.id::text,a.host_user_id) is not null
  union all$owned$ from strpos(definition,needle) for length(needle));

 -- Both provider-confirmation paths must re-check the exact activity and market.
 foreach signature in array array['public.confirm_sponsored_paystack_charge(text,text,bigint,text,text)',
  'public.confirm_sponsored_store_purchase(text,text,text,text,uuid,text,text,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  -- profiles.auth_id is the existing text identity link; the verified store
  -- account input is UUID. Keep exact identity binding for every resource.
  if signature='public.confirm_sponsored_store_purchase(text,text,text,text,uuid,text,text,text)' then
   needle:='p.auth_id=p_account_user_id)';
   if strpos(definition,needle)=0 then raise exception 'Inspect store account identity binding';end if;
   definition:=replace(definition,needle,'p.auth_id=p_account_user_id::text)');
  end if;
  needle:='    elsif v_campaign.resource_type=''property'' then';
  if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored payment eligibility: %',signature;end if;
  execute replace(definition,needle,$eligible$    elsif v_campaign.resource_type='experience' then
      select context is not null and context->>'state_key' is not distinct from v_campaign.state_key
        and context->>'lga_key' is not distinct from v_campaign.lga_key and context->>'category_key' is not distinct from v_campaign.category_key
      into v_eligible from (select private.sponsored_experience_context(v_campaign.resource_id,v_campaign.owner_user_id) context) current_activity;
    elsif v_campaign.resource_type='property' then$eligible$);
 end loop;

 definition:=pg_get_functiondef('public.get_sponsored_discovery(text,text,text,text,integer)'::regprocedure);
 needle:='    and (c.resource_type<>''worker'' or (select auth.uid()) is not null)';
 if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored audience';end if;
 definition:=replace(definition,needle,'    and (c.resource_type not in(''worker'',''experience'') or (select public.current_profile_user_id()) is not null)');
 needle:='      when ''property'' then';
 if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored public resource checks';end if;
 definition:=replace(definition,needle,$visible$      when 'experience' then exists(select 1 from (select private.sponsored_experience_context(c.resource_id,c.owner_user_id) context) current_activity
        where context is not null and context->>'state_key' is not distinct from c.state_key
          and context->>'lga_key' is not distinct from c.lga_key and context->>'category_key' is not distinct from c.category_key)
      when 'property' then$visible$);
 execute definition;

 definition:=pg_get_functiondef('public.record_my_sponsored_impression(uuid,text)'::regprocedure);
 needle:='(''worker_discovery'',''home_discovery'',''hotel_discovery'')';
 if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored impression contexts';end if;
 definition:=replace(definition,needle,'(''worker_discovery'',''home_discovery'',''hotel_discovery'',''experience_discovery'')');
 needle:='when ''home_discovery'' then ''property'' else ''hotel'' end';
 if strpos(definition,needle)=0 then raise exception 'Inspect Sponsored impression type';end if;
 definition:=replace(definition,needle,'when ''home_discovery'' then ''property'' when ''experience_discovery'' then ''experience'' else ''hotel'' end');
 -- Validate the campaign in its actual market. A valid local placement must
 -- not lose its receipt because 12 unrelated national campaigns sorted first.
 needle:='end,null,null,null,12) d';
 if strpos(definition,needle)=0 then raise exception 'Inspect placement market binding';end if;
 execute replace(definition,needle,$market$end,
      (select state_key from public.sponsored_campaigns where campaign_id=p_campaign_id),
      (select lga_key from public.sponsored_campaigns where campaign_id=p_campaign_id),
      (select category_key from public.sponsored_campaigns where campaign_id=p_campaign_id),12) d$market$);
end $extend$;

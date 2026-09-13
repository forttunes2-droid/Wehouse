-- Complete the Personal-first Worker compatibility path for public discovery,
-- Work Posts, wallet creation and Paystack-verified payout destinations.

drop policy if exists worker_services_verified_public_select
on public.worker_services;
create policy worker_services_verified_public_select
on public.worker_services for select to anon,authenticated
using(
  public.user_has_active_workspace(worker_id,'worker')
  and exists(
    select 1 from public.profiles worker
    where worker.user_id=worker_services.worker_id
      and worker.worker_status='verified'
      and coalesce(worker.worker_verified,false)
      and coalesce(worker.available,false)
      and not coalesce(worker.deleted,false)
      and not coalesce(worker.suspended,false)
      and not coalesce(worker.banned,false)
  )
);

drop policy if exists worker_showcase_select
on public.worker_showcase_posts;
create policy worker_showcase_select
on public.worker_showcase_posts for select to anon,authenticated
using(
  deleted_at is null
  and (
    worker_id=public.current_profile_user_id()
    or (
      hidden_at is null
      and kind='work_post'
      and public.user_has_active_workspace(worker_id,'worker')
      and exists(
        select 1 from public.profiles worker
        where worker.user_id=worker_showcase_posts.worker_id
          and worker.worker_status='verified'
          and coalesce(worker.worker_verified,false)
          and not coalesce(worker.deleted,false)
          and not coalesce(worker.suspended,false)
          and not coalesce(worker.banned,false)
      )
    )
  )
);

create or replace function public.get_public_workers(
  p_state text default null,
  p_city text default null,
  p_occupation text default null
)
returns table(
  user_id text,
  full_name text,
  username text,
  avatar_url text,
  bio text,
  state text,
  city text,
  local_government text,
  area text,
  worker_occupation text,
  worker_skills jsonb,
  worker_price integer,
  worker_bio text,
  worker_experience text,
  rating numeric,
  review_count integer,
  is_online boolean,
  last_seen timestamptz,
  services jsonb,
  coverage jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id();
begin
  return query
  select
    profile.user_id,profile.full_name,profile.username,profile.avatar_url,
    profile.bio,profile.state,profile.city,profile.local_government,
    profile.area,profile.worker_occupation,profile.worker_skills,
    profile.worker_price,profile.worker_bio,profile.worker_experience,
    profile.rating,profile.review_count,profile.is_online,profile.last_seen,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name',service.service_name,
        'price',service.price,
        'price_type',service.price_type
      ))
      from public.worker_services service
      where service.worker_id=profile.user_id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'state',coverage_row.state,
        'lga',coverage_row.lga,
        'areas',coverage_row.areas
      ))
      from public.worker_service_coverage coverage_row
      where coverage_row.worker_id=profile.user_id
    ),'[]'::jsonb)
  from public.profiles profile
  where public.user_has_active_workspace(profile.user_id,'worker')
    and profile.worker_status='verified'
    and profile.worker_verified=true
    and profile.available=true
    and not profile.deleted
    and not profile.suspended
    and not profile.banned
    and public.worker_identity_is_current(profile.user_id)
    and (
      p_state is null
      or public.wehouse_state_key(profile.state)=public.wehouse_state_key(p_state)
    )
    and (
      p_city is null
      or profile.city ilike p_city
      or profile.local_government ilike p_city
    )
    and (
      p_occupation is null
      or profile.worker_occupation ilike p_occupation
    )
    and not exists(
      select 1 from public.worker_user_blocks block_row
      where v_actor is not null and (
        (block_row.blocker_user_id=v_actor
          and block_row.blocked_user_id=profile.user_id)
        or (block_row.blocker_user_id=profile.user_id
          and block_row.blocked_user_id=v_actor)
      )
    )
  order by profile.rating desc nulls last,
    profile.review_count desc nulls last;
end
$$;

create or replace function public.get_worker_marketplace_trust(
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker public.profiles;
  v_enabled boolean:=false;
  v_min_jobs integer:=5;
  v_min_rating numeric:=4.5;
  v_max_cancel numeric:=20;
  v_block_disputes boolean:=true;
  v_completed integer:=0;
  v_worker_cancelled integer:=0;
  v_open_disputes integer:=0;
  v_review_count integer:=0;
  v_rating numeric:=0;
  v_cancel_rate numeric:=0;
  v_trusted boolean:=false;
begin
  select * into v_worker
  from public.profiles
  where user_id=p_worker_id
    and public.user_has_active_workspace(user_id,'worker')
    and worker_status='verified'
    and worker_verified=true
    and available=true
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_worker is null then
    return jsonb_build_object('reviewed',false,'trusted',false);
  end if;
  select coalesce(lower(value) in ('true','1','yes','on'),false)
  into v_enabled from public.platform_settings
  where key='worker_trust_enabled' and is_active=true limit 1;
  select coalesce(nullif(value,''),'5')::integer
  into v_min_jobs from public.platform_settings
  where key='worker_trusted_min_completed_jobs' and is_active=true limit 1;
  select coalesce(nullif(value,''),'4.5')::numeric
  into v_min_rating from public.platform_settings
  where key='worker_trusted_min_rating' and is_active=true limit 1;
  select coalesce(nullif(value,''),'20')::numeric
  into v_max_cancel from public.platform_settings
  where key='worker_trusted_max_cancel_rate' and is_active=true limit 1;
  select coalesce(lower(value) in ('true','1','yes','on'),true)
  into v_block_disputes from public.platform_settings
  where key='worker_trusted_block_open_disputes' and is_active=true limit 1;
  select count(*) into v_completed
  from public.worker_bookings
  where worker_id=p_worker_id and status='approved_released';
  select count(*) into v_worker_cancelled
  from public.worker_bookings
  where worker_id=p_worker_id and status='cancelled'
    and cancelled_by=p_worker_id;
  select count(*) into v_open_disputes
  from public.worker_bookings
  where worker_id=p_worker_id and status='disputed';
  select coalesce(round(avg(review.rating)::numeric,2),0),count(*)::integer
  into v_rating,v_review_count
  from public.worker_booking_reviews review
  join public.worker_bookings booking on booking.id=review.booking_id
  where review.worker_id=p_worker_id
    and booking.worker_id=p_worker_id
    and booking.status='approved_released';
  if v_completed+v_worker_cancelled>0 then
    v_cancel_rate:=round(
      (v_worker_cancelled::numeric*100)/(v_completed+v_worker_cancelled),2
    );
  end if;
  v_trusted:=coalesce(v_enabled,false)
    and v_completed>=coalesce(v_min_jobs,5)
    and v_rating>=coalesce(v_min_rating,4.5)
    and v_cancel_rate<=coalesce(v_max_cancel,20)
    and (not coalesce(v_block_disputes,true) or v_open_disputes=0);
  return jsonb_build_object(
    'reviewed',true,'trusted',v_trusted,
    'trusted_enabled',coalesce(v_enabled,false),
    'completed_jobs',v_completed,'rating',v_rating,
    'review_count',v_review_count,'worker_cancel_rate',v_cancel_rate,
    'open_disputes',v_open_disputes,
    'label',case when v_trusted then 'WeHouse Trusted'
      else 'WeHouse Reviewed' end
  );
end
$$;

create or replace function public.create_my_worker_showcase_post(
  p_kind text,
  p_media_type text,
  p_storage_path text,
  p_caption text default null,
  p_booking_id uuid default null
)
returns public.worker_showcase_posts
language plpgsql
security definer
set search_path to 'pg_catalog','public','storage'
as $$
declare
  v_worker public.profiles;
  v_booking public.worker_bookings;
  v_post public.worker_showcase_posts;
begin
  select * into v_worker
  from public.profiles
  where auth_id=(select auth.uid())::text
    and worker_status='verified'
    and coalesce(worker_verified,false)
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  limit 1;
  if v_worker is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Only an approved live Worker can publish Work Posts';
  end if;
  if not public.worker_identity_is_current(v_worker.user_id) then
    raise exception 'Repeat your WeHouse identity check before publishing new work';
  end if;
  if p_kind<>'work_post' then raise exception 'Only Work Posts are supported'; end if;
  if p_media_type not in ('image','video') then raise exception 'Invalid media type'; end if;
  if nullif(btrim(coalesce(p_storage_path,'')),'') is null
     or split_part(p_storage_path,'/',1)<>v_worker.user_id then
    raise exception 'Invalid Work Post storage path';
  end if;
  if length(coalesce(p_caption,''))>300 then raise exception 'Caption is too long'; end if;
  if not exists(
    select 1 from storage.objects object
    where object.bucket_id='worker-showcase' and object.name=p_storage_path
  ) then raise exception 'Work Post media upload was not found'; end if;
  if p_booking_id is not null then
    select * into v_booking
    from public.worker_bookings booking
    where booking.id=p_booking_id
      and booking.worker_id=v_worker.user_id
      and booking.status='approved_released';
    if v_booking is null then
      raise exception 'Only your completed WeHouse job can be linked';
    end if;
  end if;
  insert into public.worker_showcase_posts(
    worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,
    expires_at,job_confirmation_status
  ) values(
    v_worker.user_id,'work_post',p_media_type,p_storage_path,
    nullif(btrim(coalesce(p_caption,'')),''),p_booking_id,false,null,
    case when p_booking_id is null then 'not_linked' else 'pending' end
  ) returning * into v_post;
  if p_booking_id is not null then
    insert into public.notifications(
      recipient_id,type,title,message,related_id,source_type,source_id,
      destination_route,destination_params,event_key
    ) values(
      v_booking.user_id,'work_post_confirmation_requested',
      'Confirm this work post',
      'The Worker linked a photo or video to your completed job. Review the media and confirm only if it shows the work completed for you.',
      v_post.id::text,'worker_work_post',v_post.id::text,'activity',
      jsonb_build_object(
        'work_post_id',v_post.id,'booking_id',v_booking.id
      ),
      'work-post-confirmation:'||v_post.id::text
    ) on conflict(recipient_id,event_key)
      where event_key is not null do nothing;
  end if;
  return v_post;
end
$$;

create or replace function public.set_my_worker_work_post_hidden(
  p_post_id uuid,
  p_hidden boolean
)
returns public.worker_showcase_posts
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker text:=public.current_profile_user_id();
  v_post public.worker_showcase_posts;
begin
  if v_worker is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required';
  end if;
  update public.worker_showcase_posts
  set hidden_at=case when p_hidden then coalesce(hidden_at,now()) else null end
  where id=p_post_id and worker_id=v_worker and deleted_at is null
  returning * into v_post;
  if v_post is null then raise exception 'Work Post not found'; end if;
  return v_post;
end
$$;

create or replace function public.delete_my_worker_showcase_post(
  p_post_id uuid
)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_worker text:=public.current_profile_user_id();
  v_path text;
begin
  if v_worker is null or not public.current_actor_has_workspace('worker',null) then
    raise exception 'Worker workspace required';
  end if;
  update public.worker_showcase_posts
  set deleted_at=now()
  where id=p_post_id and worker_id=v_worker and deleted_at is null
  returning storage_path into v_path;
  if v_path is null then raise exception 'Work Post not found'; end if;
  return v_path;
end
$$;

create or replace function public._ensure_verified_worker_wallet()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if public.user_has_active_workspace(new.user_id,'worker')
     and new.worker_status='verified'
     and new.worker_verified is true then
    insert into public.wallets(
      owner_id,owner_type,available_balance,pending_balance,
      frozen_balance,total_withdrawn
    ) values(new.user_id,'worker',0,0,0,0)
    on conflict(owner_id,owner_type) do nothing;
  end if;
  return new;
end
$$;

create or replace function public.request_worker_withdrawal(
  p_amount numeric,
  p_bank_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_user_id text:=public.current_profile_user_id();
  v_wallet public.wallets;
  v_bank public.bank_accounts;
  v_min numeric;
  v_request_id uuid;
  v_new_balance numeric;
begin
  if v_user_id is null or not public.current_actor_has_workspace('worker',null) then
    return jsonb_build_object(
      'success',false,'error','Worker workspace required'
    );
  end if;
  if p_amount is null or p_amount<=0 then
    return jsonb_build_object('success',false,'error','Amount must be positive');
  end if;
  if p_bank_account_id is not null then
    select * into v_bank from public.bank_accounts
    where id=p_bank_account_id and user_id=v_user_id
      and verified_at is not null;
  else
    select * into v_bank from public.bank_accounts
    where user_id=v_user_id and verified_at is not null
    order by is_default desc,created_at limit 1;
  end if;
  if v_bank.id is null
     or nullif(btrim(coalesce(v_bank.paystack_recipient_code,'')),'') is null then
    return jsonb_build_object(
      'success',false,'error','Choose a Paystack-verified payout account'
    );
  end if;
  select * into v_wallet from public.wallets
  where owner_id=v_user_id and owner_type='worker' for update;
  if v_wallet.id is null then
    return jsonb_build_object('success',false,'error','Wallet not found');
  end if;
  if coalesce(v_wallet.is_frozen,false) then
    return jsonb_build_object('success',false,'error','Wallet is frozen');
  end if;
  select nullif(trim(value),'')::numeric into v_min
  from public.platform_settings
  where key in ('wallet_minimum_withdrawal','min_withdrawal')
    and coalesce(is_active,true)
  order by case key when 'wallet_minimum_withdrawal' then 0 else 1 end
  limit 1;
  if v_min is null then
    return jsonb_build_object(
      'success',false,'error','Minimum withdrawal setting is missing'
    );
  end if;
  if p_amount<v_min then
    return jsonb_build_object(
      'success',false,'error',format('Minimum withdrawal is ₦%s',v_min)
    );
  end if;
  if p_amount>coalesce(v_wallet.available_balance,0) then
    return jsonb_build_object(
      'success',false,'error','Insufficient available balance'
    );
  end if;
  v_new_balance:=v_wallet.available_balance-p_amount;
  update public.wallets
  set available_balance=v_new_balance,
      frozen_balance=coalesce(frozen_balance,0)+p_amount,
      updated_at=now()
  where id=v_wallet.id;
  insert into public.withdrawals(
    wallet_id,amount,status,bank_name,bank_account_number,bank_account_name,
    bank_account_id,payout_recipient_code,snapshot_bank_name,
    snapshot_bank_account_number,snapshot_bank_account_name,
    snapshot_bank_code,created_at,updated_at
  ) values(
    v_wallet.id,p_amount,'awaiting_review',v_bank.bank_name,
    v_bank.account_number,v_bank.account_name,v_bank.id,
    v_bank.paystack_recipient_code,v_bank.bank_name,v_bank.account_number,
    v_bank.account_name,v_bank.bank_code,now(),now()
  ) returning id into v_request_id;
  insert into public.wallet_transactions(
    user_id,transaction_type,amount,balance_after,reference_id,
    reference_type,description,metadata,created_at
  ) values(
    v_user_id,'withdrawal',-p_amount,v_new_balance,v_request_id::text,
    'withdrawal','Withdrawal awaiting Finance Operations review',
    jsonb_build_object(
      'wallet_id',v_wallet.id,'status','awaiting_review',
      'bank_account_id',v_bank.id
    ),now()
  );
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,amount,reference_id,reference_type,
    description,metadata
  ) values(
    'withdrawal_requested',v_user_id,v_user_id,p_amount,
    v_request_id::text,'withdrawal',
    'Withdrawal requested; amount reserved from available balance',
    jsonb_build_object('owner_type','worker','bank_account_id',v_bank.id)
  );
  return jsonb_build_object(
    'success',true,'request_id',v_request_id,
    'amount',p_amount,'status','awaiting_review'
  );
end
$$;

create or replace function public.save_verified_payout_account(
  p_user_id text,
  p_bank_code text,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_recipient_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_claim_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
  v_profile public.profiles;
  v_owner_type text;
  v_account public.bank_accounts;
  v_existing_count integer:=0;
  v_profile_tokens text[];
  v_account_tokens text[];
  v_match_count integer:=0;
  v_is_first boolean:=false;
begin
  if v_claim_role<>'service_role' then raise exception 'Service role required'; end if;
  select * into v_profile
  from public.profiles
  where user_id=p_user_id
    and not coalesce(deleted,false)
    and not coalesce(suspended,false)
    and not coalesce(banned,false)
  for update;
  if v_profile is null then raise exception 'Active professional account required'; end if;
  v_owner_type:=case
    when v_profile.role in ('worker','property_partner') then v_profile.role
    when public.user_has_active_workspace(p_user_id,'worker') then 'worker'
    when public.user_has_active_workspace(p_user_id,'property_partner')
      then 'property_partner'
    else null
  end;
  if v_owner_type is null then
    raise exception 'Worker or Property Partner workspace required';
  end if;
  if coalesce(btrim(p_bank_code),'')=''
     or coalesce(btrim(p_bank_name),'')='' then
    raise exception 'Verified bank is required';
  end if;
  if coalesce(btrim(p_account_number),'') !~ '^[0-9]{10}$' then
    raise exception 'Bank account number must contain 10 digits';
  end if;
  if coalesce(btrim(p_account_name),'')='' then
    raise exception 'Verified account name is required';
  end if;
  select * into v_account
  from public.bank_accounts
  where user_id=p_user_id
    and bank_code=btrim(p_bank_code)
    and account_number=btrim(p_account_number)
  limit 1;
  if v_account is not null then
    update public.bank_accounts
    set bank_name=btrim(p_bank_name),
        account_name=btrim(p_account_name),
        paystack_recipient_code=coalesce(
          nullif(btrim(coalesce(p_recipient_code,'')),''),
          paystack_recipient_code
        ),
        verified_at=coalesce(verified_at,now())
    where id=v_account.id
    returning * into v_account;
    return jsonb_build_object(
      'success',true,'already_saved',true,
      'first_account',coalesce(v_account.is_default,false),
      'additional_account',not coalesce(v_account.is_default,false),
      'name_match_count',null,
      'account',jsonb_build_object(
        'id',v_account.id,'bank_name',v_account.bank_name,
        'bank_code',v_account.bank_code,
        'account_number',v_account.account_number,
        'account_name',v_account.account_name,
        'is_default',coalesce(v_account.is_default,false),
        'verified_at',v_account.verified_at
      )
    );
  end if;
  select count(*)::integer into v_existing_count
  from public.bank_accounts where user_id=p_user_id;
  v_is_first:=v_existing_count=0;
  if not v_is_first then
    if coalesce(btrim(v_profile.full_name),'')='' then
      raise exception 'Complete your WeHouse full name before adding another payout account';
    end if;
    select array(
      select distinct token
      from unnest(regexp_split_to_array(
        lower(regexp_replace(v_profile.full_name,'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      where length(token)>1
        and token not in (
          'mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon',
          'prof','sir','madam'
        )
    ) into v_profile_tokens;
    select array(
      select distinct token
      from unnest(regexp_split_to_array(
        lower(regexp_replace(p_account_name,'[^a-zA-Z0-9 ]',' ','g')),
        '\s+'
      )) token
      where length(token)>1
        and token not in (
          'mr','mrs','miss','ms','dr','chief','alhaji','hajiya','hon',
          'prof','sir','madam'
        )
    ) into v_account_tokens;
    if coalesce(cardinality(v_profile_tokens),0)<2 then
      raise exception 'Your WeHouse full name must contain at least two names before adding another payout account';
    end if;
    select count(distinct token)::integer into v_match_count
    from unnest(v_profile_tokens) token
    where token=any(v_account_tokens);
    if v_match_count<2 then
      raise exception 'The verified bank account name must match at least two names from your WeHouse full name';
    end if;
  end if;
  insert into public.bank_accounts(
    user_id,account_number,bank_code,bank_name,account_name,
    paystack_recipient_code,is_default,verified_at,created_at
  ) values(
    p_user_id,btrim(p_account_number),btrim(p_bank_code),btrim(p_bank_name),
    btrim(p_account_name),nullif(btrim(coalesce(p_recipient_code,'')),''),
    v_is_first,now(),now()
  ) returning * into v_account;
  if v_is_first then
    update public.wallets
    set bank_name=v_account.bank_name,
        bank_account_number=v_account.account_number,
        bank_account_name=v_account.account_name,
        paystack_recipient_code=v_account.paystack_recipient_code,
        updated_at=now()
    where owner_id=p_user_id and owner_type=v_owner_type;
  end if;
  insert into public.bank_account_history(
    user_id,bank_name,bank_code,bank_account_number,bank_account_name,
    verified_account_name,is_verified,changed_at,changed_by
  ) values(
    p_user_id,v_account.bank_name,v_account.bank_code,
    v_account.account_number,v_account.account_name,v_account.account_name,
    true,now(),p_user_id
  );
  insert into public.financial_audit_logs(
    event_type,user_id,target_user_id,reference_id,reference_type,
    description,metadata,created_at
  ) values(
    'bank_account_change',p_user_id,p_user_id,v_account.id::text,
    'bank_account',case when v_is_first
      then 'First verified payout account added'
      else 'Additional verified payout account added' end,
    jsonb_build_object(
      'bank_name',v_account.bank_name,
      'account_last4',right(v_account.account_number,4),
      'account_name',v_account.account_name,
      'first_account',v_is_first,
      'matching_name_tokens',case when v_is_first then null
        else v_match_count end,
      'workspace',v_owner_type
    ),now()
  );
  return jsonb_build_object(
    'success',true,'already_saved',false,'first_account',v_is_first,
    'additional_account',not v_is_first,'name_match_count',v_match_count,
    'account',jsonb_build_object(
      'id',v_account.id,'bank_name',v_account.bank_name,
      'bank_code',v_account.bank_code,
      'account_number',v_account.account_number,
      'account_name',v_account.account_name,
      'is_default',v_account.is_default,
      'verified_at',v_account.verified_at
    )
  );
end
$$;

revoke all on function public.get_public_workers(text,text,text)
from public;
grant execute on function public.get_public_workers(text,text,text)
to anon,authenticated,service_role;
revoke all on function public.get_worker_marketplace_trust(text)
from public;
grant execute on function public.get_worker_marketplace_trust(text)
to anon,authenticated,service_role;
revoke all on function public.create_my_worker_showcase_post(
  text,text,text,text,uuid
) from public,anon;
revoke all on function public.set_my_worker_work_post_hidden(uuid,boolean)
from public,anon;
revoke all on function public.delete_my_worker_showcase_post(uuid)
from public,anon;
revoke all on function public.request_worker_withdrawal(numeric,uuid)
from public,anon;
revoke all on function public._ensure_verified_worker_wallet()
from public,anon,authenticated;
revoke all on function public.save_verified_payout_account(
  text,text,text,text,text,text
) from public,anon,authenticated;

grant execute on function public.create_my_worker_showcase_post(
  text,text,text,text,uuid
) to authenticated,service_role;
grant execute on function public.set_my_worker_work_post_hidden(uuid,boolean)
to authenticated,service_role;
grant execute on function public.delete_my_worker_showcase_post(uuid)
to authenticated,service_role;
grant execute on function public.request_worker_withdrawal(numeric,uuid)
to authenticated,service_role;
grant execute on function public._ensure_verified_worker_wallet()
to service_role;
grant execute on function public.save_verified_payout_account(
  text,text,text,text,text,text
) to service_role;

insert into public.function_execution_registry(
  function_signature,function_name,security_mode,public_allowed,anon_allowed,
  authenticated_allowed,service_role_allowed,review_state,rationale,captured_at
)
select
  function.oid::regprocedure::text,function.proname,
  case when function.prosecdef then 'definer' else 'invoker' end,
  has_function_privilege('public',function.oid,'execute'),
  has_function_privilege('anon',function.oid,'execute'),
  has_function_privilege('authenticated',function.oid,'execute'),
  has_function_privilege('service_role',function.oid,'execute'),
  case
    when function.proname in (
      'get_public_workers','get_worker_marketplace_trust'
    ) then 'approved_public_projection'
    when function.proname in (
      '_ensure_verified_worker_wallet','save_verified_payout_account'
    ) then 'approved_service_only'
    else 'approved_client_rpc'
  end,
  case
    when function.proname in (
      'get_public_workers','get_worker_marketplace_trust'
    ) then 'Field-limited public Worker marketplace projection'
    when function.proname='_ensure_verified_worker_wallet'
      then 'Internal verified-Worker wallet provisioning trigger'
    when function.proname='save_verified_payout_account'
      then 'Service-only Paystack-verified payout destination write'
    else 'Actor-bound Worker marketplace or payout action'
  end,
  now()
from pg_proc function
join pg_namespace namespace on namespace.oid=function.pronamespace
where namespace.nspname='public' and function.proname in(
  'get_public_workers','get_worker_marketplace_trust',
  'create_my_worker_showcase_post','set_my_worker_work_post_hidden',
  'delete_my_worker_showcase_post','_ensure_verified_worker_wallet',
  'request_worker_withdrawal','save_verified_payout_account'
)
on conflict(function_signature) do update set
  function_name=excluded.function_name,
  security_mode=excluded.security_mode,
  public_allowed=excluded.public_allowed,
  anon_allowed=excluded.anon_allowed,
  authenticated_allowed=excluded.authenticated_allowed,
  service_role_allowed=excluded.service_role_allowed,
  review_state=excluded.review_state,
  rationale=excluded.rationale,
  captured_at=now();

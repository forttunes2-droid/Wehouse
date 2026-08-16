insert into public.platform_settings(key,value,category,label,description,data_type,editable,is_active,created_at,updated_at)
values
('worker_identity_recheck_days','14','worker_verification','Identity re-check interval (days)','How often a live Worker must repeat the private automatic face and liveness check.','number',true,true,now(),now()),
('message_edit_window_minutes','10','communications','Message edit window (minutes)','How long a sender may edit their own text message after sending.','number',true,true,now(),now())
on conflict(key) do update set value=excluded.value,category=excluded.category,label=excluded.label,description=excluded.description,data_type=excluded.data_type,editable=excluded.editable,is_active=true,updated_at=now();

alter table public.booking_messages add column if not exists edited_at timestamptz;

create or replace function public.worker_identity_recheck_days()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select greatest(1,least(90,coalesce((select case when trim(value) ~ '^[0-9]+$' then trim(value)::integer end from public.platform_settings where key='worker_identity_recheck_days' and is_active=true limit 1),14)));
$$;

create or replace function public.message_edit_window_minutes()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select greatest(1,least(60,coalesce((select case when trim(value) ~ '^[0-9]+$' then trim(value)::integer end from public.platform_settings where key='message_edit_window_minutes' and is_active=true limit 1),10)));
$$;

create or replace function public.worker_identity_is_current(p_worker_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists(
    select 1 from public.worker_identity_checks wic
    where wic.worker_id=p_worker_id
      and wic.status='passed'
      and wic.captured_at is not null
      and wic.captured_at + make_interval(days=>public.worker_identity_recheck_days()) > now()
  );
$$;

create or replace function public.enforce_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id text;
  v_window interval:=make_interval(mins=>public.message_edit_window_minutes());
begin
  if current_setting('request.jwt.claim.role',true)='service_role' then return new; end if;
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;

  if tg_table_name='messages' then
    if new.id is distinct from old.id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id or new.created_at is distinct from old.created_at or new.attachments is distinct from old.attachments or new.attachment_types is distinct from old.attachment_types or new.file_url is distinct from old.file_url or new.file_name is distinct from old.file_name or new.file_type is distinct from old.file_type then
      raise exception 'Message metadata cannot be changed';
    end if;
    if new.content is distinct from old.content then
      if old.sender_id<>v_user_id then raise exception 'You can only edit your own messages'; end if;
      if now()>old.created_at+v_window then raise exception 'This message can no longer be edited'; end if;
      if nullif(btrim(coalesce(new.content,'')),'') is null and coalesce(array_length(old.attachments,1),0)=0 and nullif(btrim(coalesce(old.file_url,'')),'') is null then raise exception 'Message cannot be empty'; end if;
      new.content:=btrim(coalesce(new.content,''));
      new.edited_at:=now();
    else
      new.edited_at:=old.edited_at;
    end if;
    return new;
  end if;

  if tg_table_name='booking_messages' then
    if new.id is distinct from old.id or new.conversation_id is distinct from old.conversation_id or new.sender_id is distinct from old.sender_id or new.created_at is distinct from old.created_at or new.attachments is distinct from old.attachments then
      raise exception 'Message metadata cannot be changed';
    end if;
    if new.content is distinct from old.content then
      if old.sender_id<>v_user_id then raise exception 'You can only edit your own messages'; end if;
      if now()>old.created_at+v_window then raise exception 'This message can no longer be edited'; end if;
      if nullif(btrim(coalesce(new.content,'')),'') is null and coalesce(array_length(old.attachments,1),0)=0 then raise exception 'Message cannot be empty'; end if;
      new.content:=btrim(coalesce(new.content,''));
      new.edited_at:=now();
    else
      new.edited_at:=old.edited_at;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_edit_guard on public.messages;
create trigger messages_edit_guard before update on public.messages for each row execute function public.enforce_chat_message_update();
drop trigger if exists booking_messages_edit_guard on public.booking_messages;
create trigger booking_messages_edit_guard before update on public.booking_messages for each row execute function public.enforce_chat_message_update();

create or replace function public.edit_my_roommate_message(p_message_id uuid,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_user_id text; v_row public.messages;
begin
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  update public.messages set content=coalesce(p_content,'') where id=p_message_id and sender_id=v_user_id returning * into v_row;
  if v_row.id is null then raise exception 'Message not found or not yours'; end if;
  return jsonb_build_object('id',v_row.id,'content',v_row.content,'edited_at',v_row.edited_at);
end;
$$;

create or replace function public.edit_my_booking_message(p_message_id uuid,p_content text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_user_id text; v_row public.booking_messages;
begin
  select user_id into v_user_id from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_user_id is null then raise exception 'Authenticated profile required'; end if;
  update public.booking_messages set content=coalesce(p_content,'') where id=p_message_id and sender_id=v_user_id returning * into v_row;
  if v_row.id is null then raise exception 'Message not found or not yours'; end if;
  return jsonb_build_object('id',v_row.id,'content',v_row.content,'edited_at',v_row.edited_at);
end;
$$;

grant execute on function public.edit_my_roommate_message(uuid,text) to authenticated;
grant execute on function public.edit_my_booking_message(uuid,text) to authenticated;

drop policy if exists bm_all on public.booking_messages;
drop policy if exists booking_messages_select on public.booking_messages;
drop policy if exists booking_messages_insert on public.booking_messages;
drop policy if exists booking_messages_update on public.booking_messages;
create policy booking_messages_select on public.booking_messages for select to authenticated using (
  conversation_id in (select bc.id from public.booking_conversations bc where bc.user_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1) or bc.worker_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1))
);
create policy booking_messages_insert on public.booking_messages for insert to authenticated with check (
  sender_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1)
  and conversation_id in (select bc.id from public.booking_conversations bc where bc.user_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1) or bc.worker_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1))
);
create policy booking_messages_update on public.booking_messages for update to authenticated using (
  conversation_id in (select bc.id from public.booking_conversations bc where bc.user_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1) or bc.worker_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1))
) with check (
  conversation_id in (select bc.id from public.booking_conversations bc where bc.user_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1) or bc.worker_id=(select p.user_id from public.profiles p where p.auth_id=auth.uid()::text limit 1))
);

create or replace function public.get_my_worker_activation()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile public.profiles; v_ver public.worker_verifications; v_payment public.booking_payments; v_test public.worker_test_attempts; v_identity public.worker_identity_checks;
  v_attempts_24h integer:=0; v_profile_ready boolean:=false; v_paid boolean:=false; v_days integer:=public.worker_identity_recheck_days(); v_identity_current boolean:=false; v_due_at timestamptz; v_days_remaining integer;
begin
  select * into v_profile from public.profiles where auth_id=auth.uid()::text and role='worker' limit 1;
  if v_profile is null then raise exception 'Worker profile not found'; end if;
  v_profile_ready:=public.worker_professional_profile_ready(v_profile.user_id);
  select * into v_ver from public.worker_verifications where worker_id=v_profile.user_id limit 1;
  select * into v_payment from public.booking_payments where user_id=v_profile.user_id and purpose='worker_verification' order by created_at desc limit 1;
  select * into v_test from public.worker_test_attempts where worker_id=v_profile.user_id order by started_at desc limit 1;
  select * into v_identity from public.worker_identity_checks where worker_id=v_profile.user_id;
  select count(*) into v_attempts_24h from public.worker_test_attempts where worker_id=v_profile.user_id and started_at>=now()-interval '24 hours';
  v_paid:=coalesce(v_payment.status in('paid','completed'),false);
  if v_identity.status='passed' and v_identity.captured_at is not null then
    v_due_at:=v_identity.captured_at+make_interval(days=>v_days);
    v_identity_current:=v_due_at>now();
    v_days_remaining:=greatest(0,ceil(extract(epoch from (v_due_at-now()))/86400.0)::integer);
  end if;
  return jsonb_build_object(
    'worker_status',coalesce(v_profile.worker_status,'pending'),
    'live',coalesce(v_profile.worker_status='verified' and v_profile.worker_verified and v_identity_current,false),
    'profile_complete',v_profile_ready,
    'payment_status',v_payment.status,'payment_confirmed',v_paid,'gold_badge',v_paid,
    'identity_required',true,
    'identity_status',case when v_identity.status='passed' and not v_identity_current then 'expired' else coalesce(v_identity.status,'not_started') end,
    'identity_captured',coalesce(v_identity.status='passed',false),
    'identity_passed',v_identity_current,
    'identity_current',v_identity_current,
    'identity_captured_at',v_identity.captured_at,
    'identity_due_at',v_due_at,
    'identity_recheck_days',v_days,
    'identity_days_remaining',v_days_remaining,
    'test_passed',public.worker_test_passed(v_profile.user_id),'test_percent',v_test.percent,'test_attempts_24h',v_attempts_24h,
    'evidence_saved',coalesce(nullif(btrim(coalesce(v_ver.verification_video_url,'')),'') is not null,false),
    'submitted',coalesce(v_ver.submitted_at is not null,false),'review_status',v_ver.status,
    'rejection_reason',(select rejection_reason from public.worker_verification_reviews where worker_id=v_profile.user_id order by created_at desc limit 1)
  );
end;
$$;

create or replace function public.get_public_workers(p_state text default null,p_city text default null,p_occupation text default null)
returns table(user_id text,username text,avatar_url text,bio text,state text,city text,local_government text,area text,worker_occupation text,worker_skills jsonb,worker_price integer,worker_bio text,worker_experience text,rating numeric,review_count integer,is_online boolean,last_seen timestamptz,services jsonb,coverage jsonb)
language plpgsql security definer set search_path to 'public'
as $$
begin
return query select p.user_id,p.username,p.avatar_url,p.bio,p.state,p.city,p.local_government,p.area,p.worker_occupation,p.worker_skills,p.worker_price,p.worker_bio,p.worker_experience,p.rating,p.review_count,p.is_online,p.last_seen,
coalesce((select jsonb_agg(jsonb_build_object('name',ws.service_name,'price',ws.price,'price_type',ws.price_type)) from public.worker_services ws where ws.worker_id=p.user_id),'[]'::jsonb),
coalesce((select jsonb_agg(jsonb_build_object('state',wsc.state,'lga',wsc.lga,'areas',wsc.areas)) from public.worker_service_coverage wsc where wsc.worker_id=p.user_id),'[]'::jsonb)
from public.profiles p where p.role='worker' and p.worker_status='verified' and p.worker_verified=true and p.available=true and p.deleted=false and p.suspended=false and p.banned=false and public.worker_identity_is_current(p.user_id) and (p_state is null or p.state ilike p_state) and (p_city is null or p.city ilike p_city or p.local_government ilike p_city) and (p_occupation is null or p.worker_occupation ilike p_occupation)
order by p.rating desc nulls last,p.review_count desc nulls last;
end; $$;

create or replace function public.set_my_worker_availability(p_is_available boolean)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare w public.profiles;
begin
  select * into w from public.profiles where auth_id=auth.uid()::text for update;
  if w is null or w.role<>'worker' then raise exception 'Worker account required'; end if;
  if coalesce(w.deleted,false) or coalesce(w.suspended,false) or coalesce(w.banned,false) then raise exception 'Worker account is not active'; end if;
  if p_is_available and (w.worker_status<>'verified' or w.worker_verified is distinct from true) then raise exception 'Only verified workers can become available'; end if;
  if p_is_available and not public.worker_identity_is_current(w.user_id) then raise exception 'Repeat your WeHouse identity check before going available'; end if;
  update public.profiles set available=p_is_available,updated_at=now() where id=w.id;
end $$;

create or replace function public.worker_accept_booking(p_booking_id uuid,p_negotiated_amount numeric,p_scheduled_date text default null)
returns boolean language plpgsql security definer set search_path to 'public'
as $$
declare w public.profiles;b public.worker_bookings;v_date date;
begin
  select * into w from public.profiles where auth_id=auth.uid()::text for update;
  if w is null or w.role<>'worker' then raise exception 'Worker account required'; end if;
  if w.worker_status<>'verified' or w.worker_verified is distinct from true then raise exception 'Verified Worker account required'; end if;
  if not public.worker_identity_is_current(w.user_id) then raise exception 'Repeat your WeHouse identity check before accepting new work'; end if;
  if coalesce(w.deleted,false) or coalesce(w.suspended,false) or coalesce(w.banned,false) then raise exception 'Worker account is not active'; end if;
  if p_negotiated_amount is null or p_negotiated_amount<=0 then raise exception 'Agreed amount must be positive'; end if;
  if nullif(trim(coalesce(p_scheduled_date,'')),'') is not null then v_date:=p_scheduled_date::date; if v_date<current_date then raise exception 'Schedule date cannot be in the past'; end if; end if;
  select * into b from public.worker_bookings where id=p_booking_id for update;
  if b is null then raise exception 'Booking not found'; end if;
  if b.worker_id<>w.user_id then raise exception 'Not authorized'; end if;
  if b.status not in ('booking_requested','negotiating') then raise exception 'Booking cannot be accepted in current status: %',b.status; end if;
  update public.worker_bookings set status='waiting_payment',negotiated_amount=round(p_negotiated_amount,2),agreed_amount=round(p_negotiated_amount,2),scheduled_date=coalesce(v_date,scheduled_date),updated_at=now() where id=p_booking_id;
  return true;
end;
$$;

create or replace function public.worker_start_job(p_booking_id uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $$
declare w public.profiles; b public.worker_bookings;
begin
 select * into w from public.profiles where auth_id=auth.uid()::text;
 if w is null or w.role<>'worker' or w.worker_status<>'verified' or w.worker_verified is distinct from true or coalesce(w.deleted,false) or coalesce(w.suspended,false) or coalesce(w.banned,false) then raise exception 'Active verified worker required'; end if;
 if not public.worker_identity_is_current(w.user_id) then raise exception 'Repeat your WeHouse identity check before starting new work'; end if;
 select * into b from public.worker_bookings where id=p_booking_id for update;
 if b is null or b.worker_id<>w.user_id or b.status<>'confirmed' then raise exception 'Booking not found or not ready to start'; end if;
 update public.worker_bookings set status='in_progress',started_at=now(),updated_at=now() where id=p_booking_id; return true;
end $$;

create or replace function public.create_booking_request(p_worker_id text,p_service_type text,p_description text,p_address text,p_scheduled_date text,p_customer_message text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_customer public.profiles;v_worker public.profiles;v_booking_id uuid;v_conv_id uuid;v_code text;v_date date;v_service text:=trim(coalesce(p_service_type,''));v_service_ok boolean:=false;v_has_specific_services boolean:=false;
begin
  select * into v_customer from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_customer is null or v_customer.role<>'user' then raise exception 'Regular user account required'; end if;
  if coalesce(v_customer.deleted,false) or coalesce(v_customer.suspended,false) or coalesce(v_customer.banned,false) then raise exception 'Customer account is not active'; end if;
  if v_service='' then raise exception 'Choose a service'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'Describe the work you need'; end if;
  if nullif(trim(coalesce(p_address,'')),'') is null then raise exception 'Job location is required'; end if;
  if nullif(trim(coalesce(p_scheduled_date,'')),'') is not null then v_date:=p_scheduled_date::date; if v_date<current_date then raise exception 'Schedule date cannot be in the past'; end if; end if;
  select * into v_worker from public.profiles where user_id=p_worker_id and role='worker' limit 1;
  if v_worker is null then raise exception 'Worker not found'; end if;
  if v_worker.worker_status<>'verified' or v_worker.worker_verified is distinct from true then raise exception 'Worker is not verified'; end if;
  if not public.worker_identity_is_current(v_worker.user_id) then raise exception 'This Worker is temporarily unavailable while identity is re-checked'; end if;
  if v_worker.available is distinct from true then raise exception 'Worker is not accepting new bookings'; end if;
  if coalesce(v_worker.deleted,false) or coalesce(v_worker.suspended,false) or coalesce(v_worker.banned,false) then raise exception 'Worker account is not active'; end if;
  if v_customer.user_id=p_worker_id then raise exception 'Cannot book yourself'; end if;
  v_has_specific_services:=exists(select 1 from public.worker_services ws where ws.worker_id=v_worker.user_id) or (jsonb_typeof(v_worker.worker_skills)='array' and jsonb_array_length(v_worker.worker_skills)>0);
  v_service_ok:=exists(select 1 from public.worker_services ws where ws.worker_id=v_worker.user_id and lower(trim(ws.service_name))=lower(v_service)) or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(v_worker.worker_skills)='array' then v_worker.worker_skills else '[]'::jsonb end) skill(value) where lower(trim(skill.value))=lower(v_service)) or (not v_has_specific_services and lower(trim(coalesce(v_worker.worker_occupation,'')))=lower(v_service));
  if not v_service_ok then raise exception 'This Worker does not offer the selected service'; end if;
  v_code:='WH-'||upper(substring(md5(gen_random_uuid()::text) from 1 for 8));
  insert into public.worker_bookings(booking_code,user_id,worker_id,service_type,description,address,scheduled_date,agreed_amount,wehouse_fee,worker_commission,worker_receives,status,customer_message,created_at,updated_at)
  values(v_code,v_customer.user_id,v_worker.user_id,v_service,trim(p_description),trim(p_address),v_date,0,0,0,0,'booking_requested',nullif(trim(coalesce(p_customer_message,'')),''),now(),now()) returning id into v_booking_id;
  insert into public.booking_conversations(booking_id,user_id,worker_id,status,created_at,updated_at) values(v_booking_id,v_customer.user_id,v_worker.user_id,'active',now(),now()) returning id into v_conv_id;
  update public.worker_bookings set booking_conversation_id=v_conv_id where id=v_booking_id;
  if nullif(trim(coalesce(p_customer_message,'')),'') is not null then insert into public.booking_messages(conversation_id,sender_id,content,created_at) values(v_conv_id,v_customer.user_id,trim(p_customer_message),now()); end if;
  return jsonb_build_object('booking_id',v_booking_id,'conversation_id',v_conv_id,'booking_code',v_code);
end;
$$;

create or replace function public.create_my_worker_showcase_post(p_kind text,p_media_type text,p_storage_path text,p_caption text default null,p_booking_id uuid default null)
returns public.worker_showcase_posts language plpgsql security definer set search_path to 'public','storage'
as $$ declare v_worker public.profiles;v_verified_job boolean:=false;v_post public.worker_showcase_posts;begin
 select * into v_worker from public.profiles where auth_id=auth.uid()::text and role='worker' and worker_status='verified' and coalesce(worker_verified,false)=true and coalesce(deleted,false)=false and coalesce(suspended,false)=false and coalesce(banned,false)=false limit 1;
 if v_worker is null then raise exception 'Only an approved live Worker can publish Work Stories or Portfolio media'; end if;
 if not public.worker_identity_is_current(v_worker.user_id) then raise exception 'Repeat your WeHouse identity check before publishing new work'; end if;
 if p_kind not in ('story','portfolio') then raise exception 'Invalid showcase type'; end if;
 if p_media_type not in ('image','video') then raise exception 'Invalid media type'; end if;
 if nullif(btrim(coalesce(p_storage_path,'')),'') is null or split_part(p_storage_path,'/',1)<>v_worker.user_id then raise exception 'Invalid showcase storage path'; end if;
 if length(coalesce(p_caption,''))>300 then raise exception 'Caption is too long'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='worker-showcase' and o.name=p_storage_path) then raise exception 'Showcase media upload was not found'; end if;
 if p_booking_id is not null then select exists(select 1 from public.worker_bookings b where b.id=p_booking_id and b.worker_id=v_worker.user_id and b.status='approved_released') into v_verified_job; if not v_verified_job then raise exception 'Only a completed approved WeHouse job can be linked as verified work'; end if; end if;
 insert into public.worker_showcase_posts(worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,expires_at) values(v_worker.user_id,p_kind,p_media_type,p_storage_path,nullif(btrim(coalesce(p_caption,'')),''),p_booking_id,v_verified_job,case when p_kind='story' then now()+interval '24 hours' else null end) returning * into v_post;
 return v_post;
end; $$;

create or replace function public.update_platform_setting(p_key text,p_value text)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','public','extensions'
as $$
declare v_actor public.profiles;
begin
 select * into v_actor from public.profiles where auth_id=auth.uid()::text and deleted_at is null limit 1;
 if v_actor is null or v_actor.role<>'creator' then raise exception 'Only Creator can update global platform settings'; end if;
 update public.platform_settings set value=p_value,updated_at=now() where key=p_key and editable=true;
 if found then insert into public.audit_logs(action,target_type,target_id,details,admin_id,admin_email) values('PLATFORM_SETTING_UPDATED','platform_settings',p_key,jsonb_build_object('key',p_key)::text,v_actor.user_id,v_actor.email); end if;
 return found;
end;
$$;
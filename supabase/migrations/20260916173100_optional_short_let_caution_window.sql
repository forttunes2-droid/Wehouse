-- Short Let caution is optional and applies only to Short Let apartments.
-- When a Property Partner enables a refundable caution amount, the guest gets
-- a short post-check-in condition-evidence window. This does not change Hotel
-- arrival policy or accommodation-payment release timing.

alter table public.reservations
  add column if not exists caution_check_in_policy_version_id uuid references public.creator_policy_versions(policy_version_id),
  add column if not exists caution_check_in_window_minutes integer,
  add column if not exists caution_check_in_deadline_at timestamptz;

alter table public.reservations
  drop constraint if exists reservations_caution_check_in_window_minutes_check;
alter table public.reservations
  add constraint reservations_caution_check_in_window_minutes_check
  check(caution_check_in_window_minutes is null or caution_check_in_window_minutes between 30 and 60);

-- Publish the launch policy without changing the separate Hotel/Short Let
-- accommodation-arrival Payment Protection policy.
insert into public.creator_policy_versions(
  policy_key,scope_type,scope_key,version,value,value_schema,status,
  effective_from,effective_until,public_disclosure,disclosure_text,
  legal_review_state,reason,created_by,approved_by,supersedes,checksum,published_at
)
select
  'short_let_caution_check_in_window','global','*',1,
  jsonb_build_object('default_minutes',60,'minimum_minutes',30,'maximum_minutes',60),
  jsonb_build_object('type','bounded_duration_policy','unit','minutes'),
  'active',now(),null,true,
  'When a Short Let includes a refundable caution amount, the guest can record pre-existing property-condition evidence for the booked check-in window. The launch window is 30 to 60 minutes.',
  'pending','Optional Short Let caution check-in condition evidence window.',
  null,null,null,md5('short_let_caution_check_in_window:30:60:v1'),now()
where not exists(
  select 1 from public.creator_policy_versions
  where policy_key='short_let_caution_check_in_window'
    and scope_type='global' and scope_key='*' and status='active'
);

create or replace function public.current_short_let_caution_check_in_policy()
returns table(
  policy_version_id uuid,
  default_minutes integer,
  minimum_minutes integer,
  maximum_minutes integer
)
language sql
stable
security definer
set search_path to 'pg_catalog','public'
as $$
  select p.policy_version_id,
    (p.value->>'default_minutes')::integer,
    (p.value->>'minimum_minutes')::integer,
    (p.value->>'maximum_minutes')::integer
  from public.creator_policy_versions p
  where p.policy_key='short_let_caution_check_in_window'
    and p.scope_type='global' and p.scope_key='*'
    and p.status='active' and p.effective_from<=now()
    and (p.effective_until is null or p.effective_until>now())
  order by p.effective_from desc,p.version desc
  limit 1
$$;

revoke all on function public.current_short_let_caution_check_in_policy() from public,anon;
grant execute on function public.current_short_let_caution_check_in_policy() to authenticated,service_role;

create or replace function public.snapshot_short_let_caution_check_in_policy()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_policy record;
begin
  if new.stay_type is distinct from 'short_let' or coalesce(new.security_deposit_snapshot,0)<=0 then
    new.caution_check_in_policy_version_id:=null;
    new.caution_check_in_window_minutes:=null;
    new.caution_check_in_deadline_at:=null;
    return new;
  end if;

  if tg_op='UPDATE'
     and old.caution_check_in_policy_version_id is not null
     and new.caution_check_in_policy_version_id is distinct from old.caution_check_in_policy_version_id then
    raise exception 'A booked Short Let caution check-in policy snapshot is immutable';
  end if;
  if new.caution_check_in_policy_version_id is not null then return new; end if;

  select * into v_policy from public.current_short_let_caution_check_in_policy();
  if v_policy.policy_version_id is null
     or v_policy.default_minutes not between v_policy.minimum_minutes and v_policy.maximum_minutes then
    raise exception 'Active Short Let caution check-in policy required';
  end if;
  new.caution_check_in_policy_version_id:=v_policy.policy_version_id;
  new.caution_check_in_window_minutes:=v_policy.default_minutes;
  return new;
end
$$;

create or replace function public.set_short_let_caution_check_in_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
begin
  if new.stay_type='short_let'
     and new.checked_in_at is not null
     and (old.checked_in_at is null or new.checked_in_at is distinct from old.checked_in_at) then
    if coalesce(new.security_deposit_snapshot,0)<=0 then
      new.caution_check_in_deadline_at:=null;
      return new;
    end if;
    if new.caution_check_in_policy_version_id is null
       or new.caution_check_in_window_minutes not between 30 and 60 then
      raise exception 'Short Let caution check-in policy snapshot required before check-in';
    end if;
    new.caution_check_in_deadline_at:=new.checked_in_at
      +make_interval(mins=>new.caution_check_in_window_minutes);
  end if;
  return new;
end
$$;

drop trigger if exists reservations_snapshot_short_let_caution_check_in_policy on public.reservations;
create trigger reservations_snapshot_short_let_caution_check_in_policy
before insert or update of security_deposit_snapshot,stay_type
on public.reservations
for each row execute function public.snapshot_short_let_caution_check_in_policy();

drop trigger if exists reservations_set_short_let_caution_check_in_deadline on public.reservations;
create trigger reservations_set_short_let_caution_check_in_deadline
before update of checked_in_at
on public.reservations
for each row execute function public.set_short_let_caution_check_in_deadline();

-- Future/unstarted existing bookings with caution adopt the new launch policy.
-- Already checked-in stays keep the legacy four-hour evidence promise.
update public.reservations r
set caution_check_in_policy_version_id=p.policy_version_id,
    caution_check_in_window_minutes=p.default_minutes
from public.current_short_let_caution_check_in_policy() p
where r.stay_type='short_let'
  and coalesce(r.security_deposit_snapshot,0)>0
  and r.checked_in_at is null
  and r.caution_check_in_policy_version_id is null;

create or replace function public.guest_submit_short_let_check_in_evidence(
  p_reservation_id text,
  p_evidence_paths text[],
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor text:=public.current_profile_user_id();
  v_res public.reservations;
  v_path text;
  v_count integer:=0;
  v_deadline timestamptz;
begin
  select * into v_res from public.reservations
  where id=p_reservation_id and stay_type='short_let'
    and user_id=v_actor and canonical_state='checked_in' for update;
  if v_res.id is null then raise exception 'Checked-in Short Let guest required'; end if;
  if coalesce(v_res.security_deposit_snapshot,0)<=0 then
    raise exception 'This Short Let has no refundable caution amount';
  end if;

  -- Legacy already-checked-in stays retain the old four-hour evidence window.
  v_deadline:=coalesce(
    v_res.caution_check_in_deadline_at,
    v_res.checked_in_at+interval '4 hours'
  );
  if v_res.checked_in_at is null or now()>v_deadline then
    raise exception 'The Short Let check-in condition evidence window is closed';
  end if;
  if coalesce(cardinality(p_evidence_paths),0)=0 then
    raise exception 'At least one evidence file is required';
  end if;
  foreach v_path in array p_evidence_paths loop
    insert into public.caution_evidence(
      reservation_id,submitted_by,evidence_type,object_path,description,captured_at
    ) values(
      v_res.id,v_actor,'check_in_condition',v_path,nullif(btrim(p_description),''),now()
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end
$$;

-- Base submission authority: Short Let caution is optional. A missing/zero
-- amount means the Partner did not enable it; negative amounts remain invalid.
create or replace function public.create_my_property_inspection_batch(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile record;
  v_batch_id uuid:=gen_random_uuid();
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_request_code text;
  v_results jsonb:='[]'::jsonb;
  v_photo_urls text[];
  v_amenities text[];
  v_lat numeric;
  v_lng numeric;
  v_accuracy numeric;
  v_address text;
  v_city text;
  v_state text;
  v_type text;
  v_sub_type text;
  v_deposit numeric;
begin
  select user_id,email,phone,role,deleted,suspended,banned into v_profile
  from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_profile is null then raise exception 'Profile not found'; end if;
  if not public.user_has_active_workspace(v_profile.user_id,'property_partner') then
    raise exception 'Property Partner account required';
  end if;
  if coalesce(v_profile.deleted,false) or coalesce(v_profile.suspended,false) or coalesce(v_profile.banned,false) then
    raise exception 'Account is not active';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Property batch must be an array'; end if;
  if jsonb_array_length(p_items)<1 then raise exception 'Add at least one property'; end if;
  if jsonb_array_length(p_items)>25 then raise exception 'A batch can contain at most 25 properties'; end if;

  for v_item,v_position in select value,ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    v_address:=nullif(btrim(v_item->>'property_address'),'');
    v_city:=nullif(btrim(v_item->>'property_city'),'');
    v_state:=nullif(btrim(v_item->>'property_state'),'');
    v_type:=nullif(btrim(v_item->>'property_type'),'');
    v_sub_type:=nullif(btrim(v_item->>'sub_type'),'');
    v_deposit:=coalesce(nullif(v_item->>'security_deposit_amount','')::numeric,0);
    if v_address is null then raise exception 'Property %: address is required',v_position; end if;
    if v_city is null then raise exception 'Property %: city/LGA is required',v_position; end if;
    if v_state is null then raise exception 'Property %: state is required',v_position; end if;
    if v_type not in('apartment','hotel') then raise exception 'Property %: choose Apartment or Hotel',v_position; end if;
    if v_type='apartment' and v_sub_type is not null and v_sub_type not in('short_let','long_stay') then
      raise exception 'Property %: invalid apartment stay type',v_position;
    end if;
    if v_type='hotel' then
      v_sub_type:=null;
      v_deposit:=null;
    elsif v_sub_type='short_let' then
      if v_deposit<0 then raise exception 'Property %: Caution amount cannot be negative',v_position; end if;
    elsif v_sub_type='long_stay' then
      v_deposit:=null;
    end if;

    v_lat:=nullif(v_item->>'gps_latitude','')::numeric;
    v_lng:=nullif(v_item->>'gps_longitude','')::numeric;
    v_accuracy:=nullif(v_item->>'location_accuracy_m','')::numeric;
    if (v_lat is null)<>(v_lng is null) then raise exception 'Property %: latitude and longitude must be supplied together',v_position; end if;
    if v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180) then
      raise exception 'Property %: invalid coordinates',v_position;
    end if;

    select coalesce(array_agg(value),array[]::text[]) into v_photo_urls
    from jsonb_array_elements_text(coalesce(v_item->'photo_urls','[]'::jsonb));
    select coalesce(array_agg(distinct value),array[]::text[]) into v_amenities
    from jsonb_array_elements_text(coalesce(v_item->'amenities','[]'::jsonb));
    if v_sub_type='short_let' and not ('Furnished'=any(coalesce(v_amenities,array[]::text[]))) then
      v_amenities:=array_append(coalesce(v_amenities,array[]::text[]),'Furnished');
    end if;

    v_request_code:='WHIR-'||upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 10));
    insert into public.inspection_requests(
      request_code,owner_id,owner_email,owner_phone,property_address,property_city,
      property_state,property_type,sub_type,bedrooms,bathrooms,expected_rent,
      security_deposit_amount,amenities,description,photo_urls,gps_latitude,
      gps_longitude,location_accuracy_m,submission_batch_id,submission_batch_position,
      status,created_at,updated_at
    ) values(
      v_request_code,v_profile.user_id,v_profile.email,
      coalesce(nullif(btrim(v_item->>'owner_phone'),''),v_profile.phone),
      v_address,v_city,v_state,v_type,v_sub_type,
      nullif(v_item->>'bedrooms','')::integer,nullif(v_item->>'bathrooms','')::integer,
      nullif(v_item->>'expected_rent','')::numeric,v_deposit,v_amenities,
      nullif(btrim(v_item->>'description'),''),v_photo_urls,v_lat,v_lng,
      case when v_accuracy is null or v_accuracy<0 then null else v_accuracy end,
      v_batch_id,v_position,'pending',now(),now()
    ) returning id into v_request_id;
    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'id',v_request_id,'request_code',v_request_code,'position',v_position
    ));
  end loop;
  return jsonb_build_object('batch_id',v_batch_id,'count',jsonb_array_length(v_results),'requests',v_results);
end
$$;

create or replace function public.set_property_inspection_stay_type(
  p_inspection_id uuid,
  p_sub_type text,
  p_security_deposit_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_ir public.inspection_requests;
  v_amenities text[];
  v_caution numeric:=coalesce(p_security_deposit_amount,0);
begin
  select * into v_actor from public.profiles
  where auth_id=auth.uid()::text and role in('staff','admin','creator')
    and coalesce(deleted,false)=false and coalesce(suspended,false)=false
    and coalesce(banned,false)=false limit 1;
  if v_actor is null then raise exception 'WeHouse operations access required'; end if;
  if v_actor.role='staff' and not public.current_staff_has_permission('operations') then
    raise exception 'Operations permission required';
  end if;
  if p_sub_type not in('short_let','long_stay') then raise exception 'Choose Short Let or Long Let'; end if;
  select * into v_ir from public.inspection_requests where id=p_inspection_id for update;
  if v_ir is null then raise exception 'Property request not found'; end if;
  if v_ir.property_type<>'apartment' then raise exception 'Stay type applies to apartments only'; end if;
  if v_ir.published_at is not null then raise exception 'Published property classification cannot be changed here'; end if;
  if v_actor.role<>'creator' and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then
    raise exception 'Property is outside your assigned State/LGA';
  end if;
  if p_sub_type='short_let' and v_caution<0 then raise exception 'Caution amount cannot be negative'; end if;
  v_amenities:=coalesce(v_ir.amenities,array[]::text[]);
  if p_sub_type='short_let' and not ('Furnished'=any(v_amenities)) then
    v_amenities:=array_append(v_amenities,'Furnished');
  end if;
  update public.inspection_requests
  set sub_type=p_sub_type,
      security_deposit_amount=case when p_sub_type='short_let' then v_caution else null end,
      amenities=v_amenities,updated_at=now()
  where id=p_inspection_id;
  return jsonb_build_object('success',true,'sub_type',p_sub_type,
    'security_deposit_amount',case when p_sub_type='short_let' then v_caution else null end);
end
$$;

create or replace function public.admin_publish_inspected_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_actor public.profiles;
  v_listing public.listings;
  v_ir public.inspection_requests;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role not in('admin','creator') then raise exception 'Admin or Creator access required'; end if;
  select * into v_listing from public.listings where id=p_listing_id and deleted_at is null for update;
  if v_listing is null or v_listing.inspection_request_id is null then raise exception 'Inspection-linked listing required'; end if;
  select * into v_ir from public.inspection_requests where id=v_listing.inspection_request_id for update;
  if v_ir.status not in('completed','approved') then raise exception 'Inspection is not complete'; end if;
  if v_actor.role='admin' and not public.current_actor_in_scope(v_ir.property_state,v_ir.property_city) then raise exception 'Property is outside your assigned branch'; end if;
  if v_ir.final_media_reviewed_at is null then raise exception 'Confirm the final property gallery before publication'; end if;
  if nullif(btrim(v_listing.title),'') is null or coalesce(v_listing.price,0)<=0 or cardinality(coalesce(v_listing.images,array[]::text[]))<1 then
    raise exception 'Title, valid price and at least one image are required before publication';
  end if;
  if coalesce(v_listing.property_type,'apartment')='apartment' then
    if v_listing.sub_type not in('short_let','long_stay') then raise exception 'Apartment must be classified as Short Let or Long Let before publication'; end if;
    if v_listing.sub_type='short_let' and coalesce(v_listing.security_deposit_amount,0)<0 then raise exception 'Caution amount cannot be negative'; end if;
    if v_listing.sub_type='short_let' and not ('Furnished'=any(coalesce(v_listing.amenities,array[]::text[]))) then raise exception 'Short Let apartment must be furnished'; end if;
  end if;
  update public.listings set status='available',availability_status='available',approved_by=v_actor.user_id,
    approved_at=now(),rejection_reason=null,updated_at=now() where id=p_listing_id;
  update public.inspection_requests set status='approved',approved_by=v_actor.user_id,approved_at=now(),
    published_at=now(),updated_at=now() where id=v_ir.id;
end
$$;

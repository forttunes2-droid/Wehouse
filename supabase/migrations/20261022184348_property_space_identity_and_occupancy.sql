-- One physical-space authority underneath existing property submissions/listings/reservations.
-- Layout names are data; no bedroom count or property marketing name defines occupancy.
create table public.property_spaces(
 id uuid primary key,
 owner_user_id text not null references public.profiles(user_id),
 parent_id uuid references public.property_spaces(id),
 root_unit_id uuid references public.property_spaces(id),
 kind text not null check(kind in('site','unit','private_room')),
 label text not null check(length(btrim(label)) between 1 and 120),
 layout_name text,
 shared_areas text[] not null default '{}',
 address text,city text,state text,
 availability_revision bigint not null default 0,
 created_at timestamptz not null default now(),
 check((kind='site' and parent_id is null and root_unit_id is null)
 or(kind='unit' and parent_id is not null and root_unit_id=id)
 or(kind='private_room' and parent_id is not null and root_unit_id=parent_id)),
 check(layout_name is null or length(layout_name)<=120),
 check(cardinality(shared_areas)<=12)
);
create index property_spaces_owner_idx on public.property_spaces(owner_user_id,id);
create index property_spaces_parent_idx on public.property_spaces(parent_id) where parent_id is not null;
create index property_spaces_root_idx on public.property_spaces(root_unit_id) where root_unit_id is not null;
create unique index property_spaces_sibling_label_idx on public.property_spaces(parent_id,kind,lower(btrim(label))) where parent_id is not null;
alter table public.property_spaces enable row level security;
revoke all on public.property_spaces from public,anon,authenticated;
-- Only scoped definer commands read/write the private registry.
alter table public.inspection_requests add column physical_space_id uuid references public.property_spaces(id),add column space_scope text,add column space_label text,add column shared_areas text[];
alter table public.listings add column physical_space_id uuid references public.property_spaces(id),
 add column space_scope text,add column space_label text,add column shared_areas text[];
alter table public.reservations add column physical_space_id uuid references public.property_spaces(id),
 add column physical_unit_id uuid references public.property_spaces(id);
create index inspection_requests_space_idx on public.inspection_requests(physical_space_id) where physical_space_id is not null;
create index listings_physical_space_idx on public.listings(physical_space_id) where physical_space_id is not null;
create index reservations_active_physical_unit_idx on public.reservations(physical_unit_id)
 where physical_unit_id is not null and status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied');
create index reservations_space_fk_idx on public.reservations(physical_space_id) where physical_space_id is not null;

create function private.ensure_submission_space(p_owner text,p_id uuid,p_parent uuid,p_kind text,p_label text,p_layout text,p_shared text[],p_address text default null,p_city text default null,p_state text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare parent public.property_spaces; saved public.property_spaces; root_id uuid;
begin
 if p_id is null or p_owner is null or p_kind not in('site','unit','private_room')
 or length(btrim(coalesce(p_label,''))) not between 1 and 120 or length(coalesce(p_layout,''))>120
 or cardinality(coalesce(p_shared,'{}'))>12
 or exists(select 1 from unnest(coalesce(p_shared,'{}'))a where length(btrim(coalesce(a,''))) not between 1 and 80)
 then raise exception 'Provide valid property and unit details'; end if;
 if p_kind='site' then
  if p_parent is not null or nullif(btrim(p_address),'') is null or nullif(btrim(p_city),'') is null or nullif(btrim(p_state),'') is null then raise exception 'Property location is required'; end if;
 else
  select * into parent from public.property_spaces where id=p_parent for update;
  if parent.id is null or parent.owner_user_id<>p_owner or parent.kind<>(case when p_kind='unit' then 'site' else 'unit' end) then
   raise exception 'The containing property is unavailable'; end if;
  root_id:=case when p_kind='unit' then p_id else p_parent end;
 end if;
 insert into public.property_spaces(id,owner_user_id,parent_id,root_unit_id,kind,label,layout_name,shared_areas,address,city,state)
 values(p_id,p_owner,p_parent,root_id,p_kind,btrim(p_label),nullif(btrim(p_layout),''),coalesce(p_shared,'{}'),p_address,p_city,p_state)
 on conflict(id) do nothing;
 select * into saved from public.property_spaces where id=p_id for update;
 if saved.owner_user_id is distinct from p_owner or saved.parent_id is distinct from p_parent
 or saved.kind is distinct from p_kind or saved.label is distinct from btrim(p_label)
 or saved.layout_name is distinct from nullif(btrim(p_layout),'')
 or saved.shared_areas is distinct from coalesce(p_shared,'{}')
 or (p_kind='site' and (saved.address,saved.city,saved.state) is distinct from(p_address,p_city,p_state))
 then raise exception 'Property identity changed. Refresh before submitting'; end if;
 return saved.id;
end; $$;
revoke all on function private.ensure_submission_space(text,uuid,uuid,text,text,text,text[],text,text,text) from public,anon,authenticated,service_role;

create function private.link_submission_space(p_request uuid,p_item jsonb,p_owner text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare spec jsonb:=p_item->'physical_space'; site uuid; unit uuid; space uuid; scope text; shared text[]; old_command text;
begin
 if spec is null or spec='null'::jsonb then return null; end if;
 if p_item->>'property_type'<>'apartment' or jsonb_typeof(spec)<>'object' then raise exception 'Physical home details are invalid'; end if;
 if not exists(select 1 from public.inspection_requests where id=p_request and owner_id=p_owner and physical_space_id is null and document_requirements is null) then raise exception 'Property review already has a space identity'; end if;
 scope:=spec->>'scope';
 if scope not in('entire_unit','private_room') or scope is null then raise exception 'Choose the whole home or a private room'; end if;
 site:=private.ensure_submission_space(p_owner,(spec->>'site_id')::uuid,null,'site',spec->>'site_label',null,'{}',p_item->>'property_address',p_item->>'property_city',p_item->>'property_state');
 unit:=private.ensure_submission_space(p_owner,(spec->>'unit_id')::uuid,site,'unit',spec->>'unit_label',spec->>'layout_name','{}');
 if scope='private_room' then
  if jsonb_typeof(spec->'shared_areas')<>'array' or jsonb_array_length(spec->'shared_areas')<1 then raise exception 'Describe the shared areas for a private room'; end if;
  select array_agg(value) into shared from jsonb_array_elements_text(spec->'shared_areas');
  space:=private.ensure_submission_space(p_owner,(spec->>'space_id')::uuid,unit,'private_room',spec->>'space_label',null,shared);
 else
  if (spec->>'space_id')::uuid is distinct from unit then raise exception 'Whole-home offer must identify its physical unit'; end if;
  space:=unit;
 end if;
 old_command:=current_setting('wehouse.property_space_command',true);
 perform set_config('wehouse.property_space_command','link',true);
 update public.inspection_requests set physical_space_id=space where id=p_request and owner_id=p_owner;
 perform set_config('wehouse.property_space_command',coalesce(old_command,''),true);
 update public.listings set physical_space_id=space where inspection_request_id=p_request;
 return space;
end; $$;
revoke all on function private.link_submission_space(uuid,jsonb,text) from public,anon,authenticated,service_role;

create function private.guard_submission_space_identity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.property_spaces;
begin
 if tg_op='INSERT' then
  if new.physical_space_id is not null then raise exception 'Use the reviewed property submission to identify the physical space';end if;
  new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;return new;
 end if;
 if new.physical_space_id is distinct from old.physical_space_id and
 (old.physical_space_id is not null or current_setting('wehouse.property_space_command',true) is distinct from 'link'
 or not exists(select 1 from public.property_spaces s where s.id=new.physical_space_id and s.owner_user_id=new.owner_id and s.kind<>'site'))
 then raise exception 'Use the reviewed property submission to identify the physical space'; end if;
 if new.physical_space_id is not null then
  select * into s from public.property_spaces where id=new.physical_space_id;
  new.space_scope:=case when s.kind='private_room' then 'private_room' else 'entire_unit' end;new.space_label:=s.label;new.shared_areas:=s.shared_areas;
 else new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;end if;
 return new;
end; $$;
revoke all on function private.guard_submission_space_identity() from public,anon,authenticated,service_role;
create trigger inspection_requests_space_identity before insert or update of physical_space_id,space_scope,space_label,shared_areas on public.inspection_requests for each row execute function private.guard_submission_space_identity();

create function private.snapshot_listing_space()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare expected uuid; s public.property_spaces;
begin
 select physical_space_id into expected from public.inspection_requests where id=new.inspection_request_id;
 if tg_op='UPDATE' and old.physical_space_id is not null and old.physical_space_id is distinct from expected then raise exception 'Published space identity cannot be replaced'; end if;
 if new.physical_space_id is not null and new.physical_space_id is distinct from expected then raise exception 'Listing space must match its reviewed submission'; end if;
 if tg_op='UPDATE' and old.physical_space_id is null and expected is not null and exists(select 1 from public.reservations r where r.listing_id in(new.id::text,new.listing_id)) then raise exception 'Existing booking history needs reviewed space migration'; end if;
 new.physical_space_id:=expected;
 if expected is not null then
  select * into s from public.property_spaces where id=expected;
  new.space_scope:=case when s.kind='private_room' then 'private_room' else 'entire_unit' end;
  new.space_label:=s.label;new.shared_areas:=s.shared_areas;
 else new.space_scope:=null;new.space_label:=null;new.shared_areas:=null;
 end if;
 return new;
end; $$;
revoke all on function private.snapshot_listing_space() from public,anon,authenticated,service_role;
create trigger listings_space_snapshot before insert or update of physical_space_id,inspection_request_id,space_scope,space_label,shared_areas on public.listings for each row execute function private.snapshot_listing_space();

create function private.property_spaces_overlap(p_unit uuid,p_space uuid,p_other_space uuid,p_type text,p_other_type text,p_start date,p_end date,p_other_start date,p_other_end date)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select (p_space=p_unit or p_other_space=p_unit or p_space=p_other_space)
 and(coalesce(p_type,'long_stay')<>'short_let' or coalesce(p_other_type,'long_stay')<>'short_let'
 or daterange(p_start,p_end,'[)')&&daterange(p_other_start,p_other_end,'[)'));
$$;
revoke all on function private.property_spaces_overlap(uuid,uuid,uuid,text,text,date,date,date,date) from public,anon,authenticated,service_role;

create function private.guard_physical_space_occupancy()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; unit uuid; active_new boolean; active_old boolean:=false;
begin
 select l.physical_space_id into target from public.listings l where l.id::text=new.listing_id or l.listing_id=new.listing_id limit 1;
 if tg_op='UPDATE' and old.physical_space_id is not null and old.physical_space_id is distinct from target then raise exception 'Booked physical space cannot change'; end if;
 if target is null then new.physical_space_id:=null;new.physical_unit_id:=null;return new;end if;
 select root_unit_id into unit from public.property_spaces where id=target and kind<>'site';
 if unit is null then raise exception 'Bookable physical unit is unavailable'; end if;
 new.physical_space_id:=target;new.physical_unit_id:=unit;
 active_new:=new.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied');
 if tg_op='UPDATE' then active_old:=old.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied');end if;
 if not active_new and not active_old then return new;end if;
 -- An actual row version change serializes sibling offers even at stronger isolation levels.
 update public.property_spaces set availability_revision=availability_revision+1 where id=unit;
 if not active_new then return new;end if;
 if new.stay_type='short_let' and(new.stay_check_in is null or new.stay_check_out is null or new.stay_check_out<=new.stay_check_in) then raise exception 'Choose valid stay dates';end if;
 if exists(
  select 1 from public.reservations r
  where r.physical_unit_id=unit and r.id is distinct from new.id
  and r.status in('payment_pending','reserved','inspection_pending','ready_for_move_in','occupied')
  and private.property_spaces_overlap(unit,target,r.physical_space_id,new.stay_type,r.stay_type,new.stay_check_in,new.stay_check_out,r.stay_check_in,r.stay_check_out)
 )then raise exception 'This physical space is already held or occupied for those dates';end if;
 return new;
end; $$;
revoke all on function private.guard_physical_space_occupancy() from public,anon,authenticated,service_role;
create trigger aa_reservations_physical_space_guard before insert or update of listing_id,status,stay_type,stay_check_in,stay_check_out,physical_space_id,physical_unit_id on public.reservations for each row execute function private.guard_physical_space_occupancy();

CREATE OR REPLACE FUNCTION public.create_my_property_inspection_batch_v4(p_batch_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_auth_id text:=(select auth.uid())::text;
  v_actor text:=public.current_profile_user_id();
  v_result jsonb;
  v_created jsonb;
  v_item jsonb;
  v_position integer;
  v_request_id uuid;
  v_max_guests integer;
  v_display_name text;
begin
  if not public._property_document_session_active() then raise exception 'Active trusted session required'; end if;
  if v_actor is null or not public.current_actor_has_workspace('property_partner',null) then
    raise exception 'Property Partner workspace required';
  end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  if public.account_identity_checks_enabled()
     and not public.account_identity_is_current(v_actor) then
    raise exception 'Complete the private identity check before submitting properties';
  end if;
  if not exists(
    select 1 from public.property_submission_batches batch
    where batch.id=p_batch_id
      and batch.partner_user_id=v_auth_id
      and batch.status in ('draft','submitting')
    for update
  ) then raise exception 'Property submission batch not found'; end if;
  update public.property_submission_batches
  set status='submitting',updated_at=now() where id=p_batch_id;
  perform public._validate_property_submission_facts(p_items);
  for v_item in select value from jsonb_array_elements(p_items) loop
    if v_item->>'property_type'='apartment' and coalesce(v_item->>'management_mode','') not in ('host','wehouse') then
      raise exception 'Choose who will manage each home before submission';
    end if;
  end loop;
  v_result:=public.create_my_property_inspection_batch_v3(p_items);
  for v_created in select value from jsonb_array_elements(v_result->'requests') loop
    v_position:=(v_created->>'position')::integer;
    v_request_id:=(v_created->>'id')::uuid;
    v_item:=p_items->(v_position-1);
    v_max_guests:=nullif(v_item->>'max_guests','')::integer;
    v_display_name:=nullif(btrim(coalesce(v_item->>'property_display_name','')),'');
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and coalesce(v_max_guests,0)<1 then
      raise exception 'Property %: Short Let guest capacity must be at least 1',v_position;
    end if;
    if v_item->>'property_type'='apartment'
       and v_item->>'sub_type'='short_let'
       and v_display_name is null then
      raise exception 'Property %: Short Let property or host name is required',v_position;
    end if;
    update public.inspection_requests set
      requested_management_mode=case when v_item->>'property_type'='apartment' then v_item->>'management_mode' else null end,
      submission_schema_version=2,
      hotel_program=case when v_item->>'property_type'='hotel'
        then v_item->'hotel_program' else null end,
      max_guests=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_max_guests else null end,
      property_display_name=case
        when v_item->>'property_type'='apartment'
          and v_item->>'sub_type'='short_let'
        then v_display_name else null end,
      submission_batch_id=p_batch_id,
      updated_at=now()
    where id=v_request_id and owner_id=v_actor;
    perform private.link_submission_space(v_request_id,v_item,v_actor);
    update public.property_submission_items
    set inspection_request_id=v_request_id,status='submitted',updated_at=now()
    where batch_id=p_batch_id and position=v_position-1;
  end loop;
  update public.property_submission_batches
  set status='submitted',submitted_at=now(),updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  return v_result||jsonb_build_object('batch_id',p_batch_id);
exception when others then
  update public.property_submission_batches
  set status='draft',updated_at=now()
  where id=p_batch_id and partner_user_id=v_auth_id;
  raise;
end;
$function$;
revoke all on function public.create_my_property_inspection_batch_v4(uuid,jsonb) from public,anon,service_role;
grant execute on function public.create_my_property_inspection_batch_v4(uuid,jsonb) to authenticated;

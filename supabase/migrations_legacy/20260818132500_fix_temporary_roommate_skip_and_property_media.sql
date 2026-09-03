
-- Skip is temporary: old clients may still send declined, so normalize it to viewed.
update public.roommate_search_results
set status='viewed', updated_at=now()
where status='declined';

create or replace function public.update_my_roommate_match_status(p_match_id uuid,p_status text)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_actor public.profiles;
  v_match public.roommate_search_results;
  v_reverse public.roommate_search_results;
  v_conv uuid;
  v_status text;
begin
  if p_status not in ('new','viewed','accepted','declined') then raise exception 'Invalid match status'; end if;
  v_status:=case when p_status='declined' then 'viewed' else p_status end;
  select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if v_actor is null or v_actor.role<>'user' or coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Active regular user required'; end if;
  select * into v_match from public.roommate_search_results where id=p_match_id and searcher_id=v_actor.user_id for update;
  if v_match is null then raise exception 'Match not found'; end if;
  update public.roommate_search_results set status=v_status,updated_at=now() where id=p_match_id;
  if v_status='accepted' then
    select * into v_reverse from public.roommate_search_results where searcher_id=v_match.matched_user_id and matched_user_id=v_actor.user_id and status='accepted' limit 1;
    if v_reverse is not null then
      select c.id into v_conv from public.conversations c where c.conversation_type='roommate' and ((c.participant_a=v_actor.user_id and c.participant_b=v_match.matched_user_id) or (c.participant_b=v_actor.user_id and c.participant_a=v_match.matched_user_id)) limit 1;
      if v_conv is null then
        insert into public.conversations(participant_a,participant_b,status,conversation_type,subject,created_at,last_message_at,unread_a,unread_b)
        values(v_actor.user_id,v_match.matched_user_id,'active','roommate','Roommate Match',now(),now(),0,0)
        returning id into v_conv;
      end if;
    end if;
  end if;
  return v_conv;
end
$function$;

drop function if exists public.get_my_roommate_matches_page(integer,integer);
create function public.get_my_roommate_matches_page(p_limit integer default 24,p_offset integer default 0)
returns table(
 id uuid,matched_user_id text,match_score integer,status text,created_at timestamptz,
 username text,full_name text,avatar_url text,gender text,city text,state text,bio text,school text,area_preference text,
 budget_score integer,location_score integer,cleanliness_score integer,noise_score integer,visitors_score integer,stay_score integer,
 mutual_accepted boolean,conversation_id uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
 v_actor public.profiles;
 v_prefs public.roommate_preferences;
 v_school text;
 v_limit integer:=greatest(1,least(coalesce(p_limit,24),50));
 v_offset integer:=greatest(0,coalesce(p_offset,0));
begin
 select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role<>'user' then raise exception 'Regular user required'; end if;
 if coalesce(v_actor.deleted,false) or coalesce(v_actor.suspended,false) or coalesce(v_actor.banned,false) then raise exception 'Account is not active'; end if;
 select * into v_prefs from public.roommate_preferences where user_id=v_actor.user_id limit 1;
 v_school:=nullif(btrim(coalesce(v_prefs.school_name,v_actor.school,'')),'');
 return query
 select r.id,r.matched_user_id,r.match_score,r.status,r.created_at,
   p.username,p.full_name,p.avatar_url,p.gender,p.city,p.state,p.bio,coalesce(rp.school_name,p.school),rp.area_preference,
   round(30*(greatest(0,least(rp.budget_max,v_prefs.budget_max)-greatest(rp.budget_min,v_prefs.budget_min)+1)::numeric/greatest(1,least(rp.budget_max-rp.budget_min+1,v_prefs.budget_max-v_prefs.budget_min+1))))::integer,
   case when nullif(btrim(coalesce(v_actor.local_government,v_actor.city,'')),'') is not null and lower(coalesce(nullif(p.local_government,''),p.city,''))=lower(coalesce(nullif(v_actor.local_government,''),v_actor.city,'')) then 20 else 0 end,
   case when lower(coalesce(rp.cleanliness,''))=lower(coalesce(v_prefs.cleanliness,'')) then 15 else 0 end,
   case when lower(coalesce(rp.noise_level,''))=lower(coalesce(v_prefs.noise_level,'')) then 15 else 0 end,
   case when lower(coalesce(rp.visitors,''))=lower(coalesce(v_prefs.visitors,'')) then 10 else 0 end,
   case when lower(coalesce(rp.stay_duration,''))=lower(coalesce(v_prefs.stay_duration,'')) then 10 else 0 end,
   exists(select 1 from public.roommate_search_results rr where rr.searcher_id=r.matched_user_id and rr.matched_user_id=v_actor.user_id and rr.status='accepted'),
   (select c.id from public.conversations c where c.conversation_type='roommate' and c.status='active' and ((c.participant_a=v_actor.user_id and c.participant_b=r.matched_user_id) or (c.participant_b=v_actor.user_id and c.participant_a=r.matched_user_id)) limit 1)
 from public.roommate_search_results r
 join public.profiles p on p.user_id=r.matched_user_id
 left join public.roommate_preferences rp on rp.user_id=p.user_id
 where r.searcher_id=v_actor.user_id and r.status<>'declined'
   and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false and coalesce(p.banned,false)=false
   and (r.status='accepted' or (coalesce(p.privacy_search_visible,true)=true and coalesce(p.privacy_profile_visible,true)=true and coalesce(rp.active,false)=true and rp.search_status='active' and (not coalesce(v_prefs.school_match,false) or lower(regexp_replace(btrim(coalesce(rp.school_name,p.school,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(v_school,'')),'\s+',' ','g')))))
 order by r.match_score desc,r.created_at desc,r.id
 limit v_limit offset v_offset;
end
$function$;

revoke all on function public.update_my_roommate_match_status(uuid,text) from public,anon;
grant execute on function public.update_my_roommate_match_status(uuid,text) to authenticated;
revoke all on function public.get_my_roommate_matches_page(integer,integer) from public,anon;
grant execute on function public.get_my_roommate_matches_page(integer,integer) to authenticated;

create or replace function public.get_my_property_pipeline(p_stage text default 'all')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor public.profiles; v_result jsonb;
begin
 select * into v_actor from public.profiles where auth_id=auth.uid()::text limit 1;
 if v_actor is null or v_actor.role not in ('admin','creator','staff') then raise exception 'WeHouse operations access required'; end if;
 if v_actor.role='staff' and not public.current_staff_has_permission('operations') then raise exception 'Operations permission required'; end if;
 if v_actor.role in ('admin','staff') and (v_actor.assigned_state is null or v_actor.assigned_lga is null) then raise exception 'Branch assignment required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',ir.id,'request_code',ir.request_code,'owner_id',ir.owner_id,
   'owner_name',coalesce(owner.full_name,owner.username,owner.email),'owner_email',ir.owner_email,'owner_phone',ir.owner_phone,
   'property_address',ir.property_address,'property_city',ir.property_city,'property_state',ir.property_state,
   'property_type',ir.property_type,'sub_type',ir.sub_type,'bedrooms',ir.bedrooms,'bathrooms',ir.bathrooms,
   'expected_rent',ir.expected_rent,'security_deposit_amount',ir.security_deposit_amount,'amenities',ir.amenities,
   'description',ir.description,'status',ir.status,'scheduled_date',ir.scheduled_date,
   'assigned_field_officer_id',coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to),
   'field_officer_name',coalesce(officer.full_name,officer.username,officer.email),'notes',ir.notes,
   'photo_urls',ir.photo_urls,'video_urls',ir.video_urls,'document_urls',ir.document_urls,'gps_latitude',ir.gps_latitude,'gps_longitude',ir.gps_longitude,
   'draft_listing_id',ir.draft_listing_id,'draft_hotel_id',ir.draft_hotel_id,'approved_by',ir.approved_by,'approved_at',ir.approved_at,'published_at',ir.published_at,
   'listing',case when l.id is null then null else jsonb_build_object(
     'id',l.id,'listing_id',l.listing_id,'title',l.title,'price',l.price,'status',l.status,'availability_status',l.availability_status,
     'sub_type',l.sub_type,'security_deposit_amount',l.security_deposit_amount,'amenities',l.amenities,'images',l.images,'videos',l.videos,'created_at',l.created_at
   ) end,
   'hotel',case when h.hotel_id is null then null else jsonb_build_object('hotel_id',h.hotel_id,'name',h.name,'status',h.status,'images',h.images,'created_at',h.created_at) end,
   'created_at',ir.created_at
 ) order by ir.created_at desc),'[]'::jsonb) into v_result
 from public.inspection_requests ir
 left join public.profiles owner on owner.user_id=ir.owner_id
 left join public.profiles officer on officer.user_id=coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to)
 left join public.listings l on l.id=ir.draft_listing_id and l.deleted_at is null
 left join public.hotels h on h.hotel_id=ir.draft_hotel_id
 where (v_actor.role='creator' or (ir.property_state=v_actor.assigned_state and ir.property_city=v_actor.assigned_lga))
   and (p_stage='all'
     or (p_stage='new' and ir.status='pending' and coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) is null)
     or (p_stage='inspection' and ir.status in ('pending','scheduled','in_progress') and coalesce(ir.assigned_field_officer_id,ir.field_officer_id,ir.assigned_to) is not null)
     or (p_stage='ready' and ir.status in ('completed','approved') and ir.draft_listing_id is null and ir.draft_hotel_id is null)
     or (p_stage='preparing' and (ir.draft_listing_id is not null or ir.draft_hotel_id is not null) and ir.published_at is null)
     or (p_stage='published' and ir.published_at is not null)
     or (p_stage='rejected' and ir.status='rejected'));
 return v_result;
end
$function$;

begin;
-- Use the same request-first lock order as evidence review and expiry.
do $upgrade$
declare definition text;needle text;replacement text;target regprocedure;
begin
 target:='private.guard_new_property_booking_documents()'::regprocedure;
 definition:=pg_get_functiondef(target);
 needle:='if request_id is null or not private.property_documents_current(request_id) then';
 if position(needle in definition)=0 then raise exception 'Booking credential gate changed';end if;
 execute replace(definition,needle,'perform 1 from public.inspection_requests where id=request_id for share; '||needle);

 definition:=pg_get_functiondef('public.admin_publish_inspected_listing(uuid)'::regprocedure);
 needle:='select * into l from public.listings where id=p_listing_id and deleted_at is null for update;';
 if position(needle in definition)=0 then raise exception 'Listing publication definition changed';end if;
 definition:=replace(definition,needle,'select * into l from public.listings where id=p_listing_id and deleted_at is null;');
 needle:='select * into r from public.inspection_requests where id=l.inspection_request_id for update;';
 if position(needle in definition)=0 then raise exception 'Listing request lock changed';end if;
 replacement:=needle||' select * into l from public.listings where id=p_listing_id and deleted_at is null for update; if l.id is null or l.inspection_request_id is distinct from r.id then raise exception ''Property changed during review. Reload before publishing.'';end if;';
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.admin_publish_inspected_hotel(integer)'::regprocedure);
 needle:='select * into h from public.hotels where hotel_id=p_hotel_id for update;';
 if position(needle in definition)=0 then raise exception 'Hotel publication definition changed';end if;
 definition:=replace(definition,needle,'select * into h from public.hotels where hotel_id=p_hotel_id;');
 needle:='select * into r from public.inspection_requests where id=h.inspection_request_id for update;';
 if position(needle in definition)=0 then raise exception 'Hotel request lock changed';end if;
 replacement:=needle||' select * into h from public.hotels where hotel_id=p_hotel_id for update; if h.hotel_id is null or h.inspection_request_id is distinct from r.id then raise exception ''Hotel changed during review. Reload before publishing.'';end if;';
 execute replace(definition,needle,replacement);

 -- Preserve first-publication history while exposing a paused property in the
 -- existing preparation/republication controls, instead of a false live state.
 definition:=pg_get_functiondef('public.get_my_property_pipeline_v2(text)'::regprocedure);
 replacement:='case when ir.lifecycle_stage=''live'' and (item->''listing''->>''status''=''pending_approval'' or item->''hotel''->>''status''=''inactive'') then ''listing_prepared'' else ir.lifecycle_stage end';
 needle:='''lifecycle_stage'',ir.lifecycle_stage';
 if position(needle in definition)=0 then raise exception 'Property pipeline projection changed';end if;
 definition:=replace(definition,needle,'''lifecycle_stage'','||replacement);
 needle:='p_stage=''preparing'' and ir.lifecycle_stage=''listing_prepared''';
 if position(needle in definition)=0 then raise exception 'Property preparation filter changed';end if;
 definition:=replace(definition,needle,'p_stage=''preparing'' and ('||replacement||')=''listing_prepared''');
 needle:='p_stage=''published'' and ir.lifecycle_stage=''live''';
 if position(needle in definition)=0 then raise exception 'Property publication filter changed';end if;
 execute replace(definition,needle,'p_stage=''published'' and ('||replacement||')=''live''');
end $upgrade$;
commit;

\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.listings(id,listing_id,title,price,property_type,status,availability_status,inspection_request_id,approved_at)
values
('f1000000-0000-0000-0000-000000000001','capacity-detail-contract-public','Public fixture',100,'apartment','available','available',gen_random_uuid(),now()),
('f1000000-0000-0000-0000-000000000002','capacity-detail-contract-hidden','Unapproved fixture',100,'apartment','available','available',gen_random_uuid(),null);
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare by_text jsonb; by_uuid jsonb;
begin
 by_text:=public.get_public_listing_detail('capacity-detail-contract-public');
 by_uuid:=public.get_public_listing_detail('f1000000-0000-0000-0000-000000000001');
 if by_text is null or by_uuid is null or by_text is distinct from by_uuid then raise exception 'Both public identifiers must resolve the same approved listing'; end if;
 if by_text->>'listing_id'<>'capacity-detail-contract-public' or (by_text->>'location_exact')::boolean or by_text->>'gps_latitude' is not null then raise exception 'Public identity or location projection changed'; end if;
 if public.get_public_listing_detail('not-a-uuid-or-listing') is not null then raise exception 'Unknown text lookup must return null'; end if;
 if public.get_public_listing_detail('capacity-detail-contract-hidden') is not null or public.get_public_listing_detail('f1000000-0000-0000-0000-000000000002') is not null then raise exception 'Unapproved listing exposed by identifier lookup'; end if;
 if public.search_discoverable_hotels(p_limit=>999)->'items' is null then raise exception 'Hotel search response shape changed'; end if;
end $$;
rollback;

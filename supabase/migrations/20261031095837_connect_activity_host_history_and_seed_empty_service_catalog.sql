begin;
set local search_path='';
-- Activities reuse the Provider identity. A reviewed activity does not imply
-- that unrelated requested services have been reviewed.
do $history$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.get_worker_marketplace_trust(text)'::regprocedure);
 needle:='and worker_status=''verified'' and worker_verified=true';
 if strpos(definition,needle)=0 then raise exception 'Inspect Provider history eligibility';end if;
 definition:=replace(definition,needle,$eligible$and ((worker_status='verified' and worker_verified=true) or exists(
   select 1 from public.experience_activities activity where activity.host_user_id=p_worker_id and private.experience_is_published(activity.id)))$eligible$);
 needle:='''reviewed'',true,''trusted'',v_trusted';
 if strpos(definition,needle)=0 then raise exception 'Inspect Provider review distinction';end if;
 execute replace(definition,needle,'''reviewed'',coalesce(v_worker.worker_status=''verified'' and v_worker.worker_verified,false),''trusted'',v_trusted');
end $history$;
create function private.activity_host_public_totals(p_host text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('completed_services',coalesce((data->>'completed_jobs')::integer,0),
  'completed_activity_sessions',coalesce((data->>'completed_activity_sessions')::integer,0),
  'rating',coalesce((data->>'rating')::numeric,0),'review_count',coalesce((data->>'review_count')::integer,0))
 from(select public.get_worker_marketplace_trust(p_host) as data) summary;
$$;
revoke all on function private.activity_host_public_totals(text) from public,anon,authenticated,service_role;
do $detail$
declare definition text;needle text:='return private.experience_public_projection(p_activity_id);';
begin
 definition:=pg_get_functiondef('public.get_published_experience(uuid)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Inspect activity detail projection';end if;
 execute replace(definition,needle,$summary$return (select item||jsonb_build_object('host_summary',private.activity_host_public_totals(item->>'host_user_id'))
   from(select private.experience_public_projection(p_activity_id) item) published where item is not null);$summary$);
end $detail$;
-- Test was missing the existing live taxonomy. Seed only a completely empty
-- catalog; never overwrite Creator-managed categories, services or identifiers.
do $catalog$
begin
 if exists(select 1 from public.service_categories) or exists(select 1 from public.service_subcategories) then return;end if;
 insert into public.service_categories(name,icon,sort_order,is_active) values('Home Services','🔧',1,true),('Lifestyle services','💇',3,true);
 insert into public.service_subcategories(category_id,name,sort_order,is_active)
 select category.id,service.name,service.position,true from(values
  ('Home Services','Electricial service',1),('Home Services','Hairstyling service',2),
  ('Home Services','Laundry service',3),('Home Services','Private chef service',4),
  ('Lifestyle services','Fashion and tailoring services',1),('Lifestyle services','Beauty and make up services',2)
 )service(category,name,position) join public.service_categories category on category.name=service.category;
end $catalog$;
commit;

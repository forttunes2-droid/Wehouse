-- Service taxonomy is canonical. A booking references the service record while
-- keeping service_type as its readable snapshot for operational exports.
alter table public.worker_bookings add column if not exists service_subcategory_id uuid references public.service_subcategories(id) on delete set null;

update public.worker_bookings b set service_subcategory_id=s.id
from public.service_subcategories s
where b.service_subcategory_id is null and lower(btrim(coalesce(b.service_type,'')))=lower(btrim(s.name));

create or replace function public.bind_worker_booking_service()
returns trigger language plpgsql set search_path to 'pg_catalog','public' as $$
declare matched public.service_subcategories;
begin
  if new.service_subcategory_id is not null then
    select * into matched from public.service_subcategories where id=new.service_subcategory_id;
  elsif nullif(btrim(coalesce(new.service_type,'')),'') is not null then
    select * into matched from public.service_subcategories where lower(btrim(name))=lower(btrim(new.service_type)) order by is_active desc,created_at limit 1;
  end if;
  if matched is not null then new.service_subcategory_id:=matched.id;new.service_type:=matched.name;end if;
  return new;
end $$;
drop trigger if exists worker_bookings_bind_service on public.worker_bookings;
create trigger worker_bookings_bind_service before insert or update of service_type,service_subcategory_id on public.worker_bookings for each row execute function public.bind_worker_booking_service();

create or replace function public.rename_service_subcategory(p_subcategory_id uuid,p_name text)
returns public.service_subcategories language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare actor public.profiles;old_name text;result public.service_subcategories;
begin
  select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if actor is null or not public.is_current_creator() then raise exception 'Creator authorization required';end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Service name is required';end if;
  select name into old_name from public.service_subcategories where id=p_subcategory_id for update;
  if old_name is null then raise exception 'Service not found';end if;
  update public.service_subcategories set name=btrim(p_name),updated_at=now() where id=p_subcategory_id returning * into result;
  update public.worker_bookings set service_type=result.name where service_subcategory_id=p_subcategory_id or (service_subcategory_id is null and lower(btrim(coalesce(service_type,'')))=lower(btrim(old_name)));
  update public.profiles p set worker_skills=(select coalesce(jsonb_agg(case when lower(btrim(skill))=lower(btrim(old_name)) then result.name else skill end),'[]'::jsonb) from jsonb_array_elements_text(coalesce(p.worker_skills,'[]'::jsonb)) skill),updated_at=now()
  where exists(select 1 from jsonb_array_elements_text(coalesce(p.worker_skills,'[]'::jsonb)) skill where lower(btrim(skill))=lower(btrim(old_name)));
  return result;
end $$;
revoke all on function public.rename_service_subcategory(uuid,text) from public,anon;
grant execute on function public.rename_service_subcategory(uuid,text) to authenticated,service_role;

-- The legacy reviews table uses incompatible integer identities. Preserve it
-- for old dependencies and introduce the canonical booking-backed record.
create table if not exists public.worker_booking_reviews(
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.worker_bookings(id) on delete restrict,
  user_id text not null references public.profiles(user_id) on delete restrict,
  worker_id text not null references public.profiles(user_id) on delete restrict,
  rating smallint not null check(rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(user_id<>worker_id),
  check(comment is null or char_length(comment)<=1200)
);
alter table public.worker_booking_reviews enable row level security;
revoke all on public.worker_booking_reviews from public,anon,authenticated;
grant select,insert,update on public.worker_booking_reviews to service_role;

create or replace function public.submit_my_worker_booking_review(p_booking_id uuid,p_rating integer,p_comment text default null)
returns public.worker_booking_reviews language plpgsql security definer set search_path to 'pg_catalog','public' as $$
declare actor public.profiles;booking public.worker_bookings;result public.worker_booking_reviews;
begin
  select * into actor from public.profiles where auth_id=auth.uid()::text limit 1;
  if actor is null or not public.current_actor_has_personal_workspace() then raise exception 'Personal workspace required';end if;
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5';end if;
  select * into booking from public.worker_bookings where id=p_booking_id and user_id=actor.user_id for update;
  if booking is null then raise exception 'Completed booking not found';end if;
  if booking.status<>'approved_released' then raise exception 'Review becomes available after the job is completed';end if;
  insert into public.worker_booking_reviews(booking_id,user_id,worker_id,rating,comment)
  values(booking.id,actor.user_id,booking.worker_id,p_rating,nullif(btrim(coalesce(p_comment,'')),''))
  on conflict(booking_id) do update set rating=excluded.rating,comment=excluded.comment,updated_at=now()
  where worker_booking_reviews.user_id=actor.user_id
  returning * into result;
  update public.profiles p set rating=summary.average,review_count=summary.total,updated_at=now()
  from(select round(avg(r.rating)::numeric,2) average,count(*)::int total from public.worker_booking_reviews r where r.worker_id=booking.worker_id)summary
  where p.user_id=booking.worker_id;
  return result;
end $$;

create or replace function public.get_my_worker_booking_review(p_booking_id uuid)
returns public.worker_booking_reviews language sql security definer set search_path to 'pg_catalog','public' stable as $$
 select r.* from public.worker_booking_reviews r join public.worker_bookings b on b.id=r.booking_id
 where r.booking_id=p_booking_id and public.current_profile_user_id() in(b.user_id,b.worker_id) limit 1
$$;

create or replace function public.get_public_worker_reviews(p_worker_id text,p_limit integer default 20)
returns table(id uuid,rating smallint,comment text,created_at timestamptz,reviewer_name text,service_name text) language sql security definer set search_path to 'pg_catalog','public' stable as $$
 select r.id,r.rating,r.comment,r.created_at,coalesce(p.full_name,p.username,'WeHouse customer'),coalesce(s.name,b.service_type,'Service job')
 from public.worker_booking_reviews r join public.worker_bookings b on b.id=r.booking_id join public.profiles p on p.user_id=r.user_id left join public.service_subcategories s on s.id=b.service_subcategory_id
 where r.worker_id=p_worker_id and b.status='approved_released' order by r.created_at desc limit least(greatest(coalesce(p_limit,20),1),50)
$$;
revoke all on function public.submit_my_worker_booking_review(uuid,integer,text) from public,anon;
revoke all on function public.get_my_worker_booking_review(uuid) from public,anon;
revoke all on function public.get_public_worker_reviews(text,integer) from public,anon;
grant execute on function public.submit_my_worker_booking_review(uuid,integer,text),public.get_my_worker_booking_review(uuid),public.get_public_worker_reviews(text,integer) to authenticated,service_role;

-- Paid profile presentation. Ordinary Worker posts and booking remain free.
begin;
create table public.worker_pro_featured_profiles (
  worker_id text primary key references public.profiles(user_id) on delete cascade,
  post_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint max_featured_posts check(cardinality(post_ids)<=3)
);
alter table public.worker_pro_featured_profiles enable row level security;
revoke all on public.worker_pro_featured_profiles from public,anon,authenticated;
grant all on public.worker_pro_featured_profiles to service_role;

create or replace function public.get_worker_pro_featured_posts(p_worker_id text)
returns uuid[] language sql stable security definer set search_path='pg_catalog','public' as $$
  select coalesce((select array_agg(id order by ord) from (
    select post.id,selected.ord from public.worker_pro_featured_profiles f
    cross join lateral unnest(f.post_ids) with ordinality selected(post_id,ord)
    join public.worker_showcase_posts post on post.id=selected.post_id
      and post.worker_id=f.worker_id and post.hidden_at is null and post.deleted_at is null
      and (post.expires_at is null or post.expires_at>now())
    where f.worker_id=p_worker_id and public.worker_pro_is_active(f.worker_id)
      and (coalesce((public._worker_publication_state(f.worker_id)->>'publicly_visible')::boolean,false)
        or f.worker_id=public.current_profile_user_id()
        or public.current_actor_has_workspace('creator',null))
  ) posts),'{}'::uuid[])
$$;
revoke all on function public.get_worker_pro_featured_posts(text) from public,anon;
grant execute on function public.get_worker_pro_featured_posts(text) to authenticated;

create or replace function public.set_my_worker_pro_featured_post(p_post_id uuid,p_featured boolean)
returns uuid[] language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_actor text:=public.worker_pro_current_actor(); v_posts uuid[]; v_result uuid[];
begin
  if not exists(select 1 from public.worker_showcase_posts
    where id=p_post_id and worker_id=v_actor and hidden_at is null and deleted_at is null
      and (expires_at is null or expires_at>now())) then
    raise exception 'Visible owned work post required'; end if;
  perform 1 from public.profiles where user_id=v_actor for update;
  select post_ids into v_posts from public.worker_pro_featured_profiles where worker_id=v_actor;
  v_posts:=coalesce(v_posts,'{}'::uuid[]);
  if coalesce(p_featured,false) then
    if not p_post_id=any(v_posts) then
      if cardinality(v_posts)>=3 then raise exception 'Choose up to three featured work posts'; end if;
      v_posts:=array_append(v_posts,p_post_id);
    end if;
  else
    v_posts:=array_remove(v_posts,p_post_id);
  end if;
  insert into public.worker_pro_featured_profiles(worker_id,post_ids) values(v_actor,v_posts)
  on conflict(worker_id) do update set post_ids=excluded.post_ids,updated_at=now()
  returning post_ids into v_result;
  return v_result;
end $$;
revoke all on function public.set_my_worker_pro_featured_post(uuid,boolean) from public,anon;
grant execute on function public.set_my_worker_pro_featured_post(uuid,boolean) to authenticated;
commit;

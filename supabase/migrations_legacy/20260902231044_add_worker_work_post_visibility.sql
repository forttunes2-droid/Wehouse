-- Work Posts follow a social-post visibility model: the owner can hide or
-- restore a post without deleting its media. Public viewers see only visible
-- posts from active, verified workers.

alter table public.worker_showcase_posts
  add column if not exists hidden_at timestamptz;

drop policy if exists worker_showcase_select on public.worker_showcase_posts;
create policy worker_showcase_select on public.worker_showcase_posts
for select to authenticated
using (
  deleted_at is null
  and (
    worker_id=(select p.user_id from public.profiles p where p.auth_id=(select auth.uid())::text limit 1)
    or (
      hidden_at is null
      and kind='work_post'
      and exists(
        select 1 from public.profiles p
        where p.user_id=worker_showcase_posts.worker_id
          and p.role='worker' and p.worker_status='verified'
          and coalesce(p.worker_verified,false)=true
          and coalesce(p.deleted,false)=false
          and coalesce(p.suspended,false)=false
          and coalesce(p.banned,false)=false
      )
    )
  )
);

create or replace function public.set_my_worker_work_post_hidden(
  p_post_id uuid,
  p_hidden boolean
) returns public.worker_showcase_posts
language plpgsql security definer set search_path=public
as $$
declare v_worker text; v_post public.worker_showcase_posts;
begin
  select p.user_id into v_worker from public.profiles p
  where p.auth_id=auth.uid()::text and p.role='worker'
    and coalesce(p.deleted,false)=false and coalesce(p.suspended,false)=false
    and coalesce(p.banned,false)=false limit 1;
  if v_worker is null then raise exception 'Active Worker account required'; end if;
  update public.worker_showcase_posts
    set hidden_at=case when p_hidden then coalesce(hidden_at,now()) else null end
    where id=p_post_id and worker_id=v_worker and deleted_at is null
    returning * into v_post;
  if v_post is null then raise exception 'Work Post not found'; end if;
  return v_post;
end;
$$;

revoke all on function public.set_my_worker_work_post_hidden(uuid,boolean) from public,anon;
grant execute on function public.set_my_worker_work_post_hidden(uuid,boolean) to authenticated,service_role;

create index if not exists worker_showcase_public_visible_idx
  on public.worker_showcase_posts(worker_id,created_at desc)
  where deleted_at is null and hidden_at is null and kind='work_post';

create index if not exists worker_showcase_comments_post_page
on public.worker_showcase_comments(post_id,created_at desc,id desc)
where deleted_at is null;

create or replace function public.get_worker_showcase_post_comments_page(
  p_post_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 30
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public'
as $$
declare v_actor text:=public.current_profile_user_id(); v_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
  v_rows jsonb; v_more boolean; v_cursor jsonb; v_total bigint;
begin
  if v_actor is null then raise exception 'Sign in to view comments'; end if;
  if (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid comments cursor'; end if;
  if not exists(select 1 from public.worker_showcase_posts p
    where p.id=p_post_id and p.deleted_at is null
      and (p.worker_id=v_actor or (p.hidden_at is null and (p.expires_at is null or p.expires_at>now()))))
    then raise exception 'Work post is not available'; end if;
  select count(*) into v_total from public.worker_showcase_comments
  where post_id=p_post_id and deleted_at is null;
  with page as (
    select c.id,c.user_id,c.body,c.created_at,
      coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.username),''),'WeHouse member') display_name,
      p.avatar_url
    from public.worker_showcase_comments c join public.profiles p on p.user_id=c.user_id
    where c.post_id=p_post_id and c.deleted_at is null
      and (p_before_at is null or (c.created_at,c.id)<(p_before_at,p_before_id))
    order by c.created_at desc,c.id desc limit v_limit+1
  ), numbered as (
    select page.*,row_number() over (order by created_at desc,id desc) position from page
  )
  select coalesce(jsonb_agg(to_jsonb(n)-'position' order by n.position) filter (where n.position<=v_limit),'[]'::jsonb),
    coalesce(bool_or(n.position>v_limit),false),
    (select jsonb_build_object('at',last.created_at,'id',last.id) from numbered last
      where last.position<=v_limit order by last.position desc limit 1)
  into v_rows,v_more,v_cursor from numbered n;
  return jsonb_build_object('items',v_rows,'total',v_total,'has_more',v_more,'next_cursor',v_cursor);
end
$$;
revoke all on function public.get_worker_showcase_post_comments_page(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.get_worker_showcase_post_comments_page(uuid,timestamptz,uuid,integer) to authenticated,service_role;

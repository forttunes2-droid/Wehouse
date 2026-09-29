\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,full_name) values
('76666666-0000-4000-8000-000000000011','comment-owner@example.invalid','comment-owner','worker',true,'Sani Example'),
('76666666-0000-4000-8000-000000000012','comment-reader@example.invalid','comment-reader','user',true,'Ada Example');
insert into public.worker_showcase_posts(id,worker_id,kind,media_type,storage_path,caption) values
('76666666-0000-4000-8000-000000000021','comment-owner','work_post','video','synthetic-video','Finished work'),
('76666666-0000-4000-8000-000000000022','comment-owner','work_post','image','synthetic-hidden','Private work');
update public.worker_showcase_posts set hidden_at=now() where id='76666666-0000-4000-8000-000000000022';
insert into public.worker_showcase_comments(post_id,user_id,body,created_at)
select '76666666-0000-4000-8000-000000000021','comment-reader','Comment '||g,now()+g*interval '1 microsecond'
from generate_series(1,33) g;
select set_config('request.jwt.claim.sub','76666666-0000-4000-8000-000000000012',true);
set local role authenticated;
do $$
declare first jsonb; second jsonb; cursor jsonb;
begin
  first:=public.get_worker_showcase_post_comments_page('76666666-0000-4000-8000-000000000021');
  if jsonb_array_length(first->'items')<>30 or (first->>'total')::int<>33 or first->>'has_more'<>'true'
    then raise exception 'First page/count incorrect'; end if;
  cursor:=first->'next_cursor';
  second:=public.get_worker_showcase_post_comments_page('76666666-0000-4000-8000-000000000021',(cursor->>'at')::timestamptz,(cursor->>'id')::uuid,30);
  if jsonb_array_length(second->'items')<>3 or second->>'has_more'<>'false'
    then raise exception 'Last page incorrect'; end if;
  begin
    perform public.get_worker_showcase_post_comments_page('76666666-0000-4000-8000-000000000022');
    raise exception 'Hidden work post leaked';
  exception when others then if sqlerrm='Hidden work post leaked' then raise; end if; end;
end $$;
rollback;

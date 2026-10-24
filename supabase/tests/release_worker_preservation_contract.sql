\set ON_ERROR_STOP on
begin;
-- Verify a narrowly reviewed additive-column projection. Every original field
-- and every row still participates; unrelated schema additions are not ignored.
create temporary table worker_preservation_fixture(
 worker_id text,status text,review_notes text,verification_video_url text
) on commit drop;
create temporary table worker_ignored_fields on commit drop as
select name from unnest(array['credential_requirements','credential_revision',
 'credential_context','credential_requirements_note','credential_requirements_set_at',
 'credential_requirements_set_by']) fields(name)
where not exists(select 1 from pg_attribute a
 where a.attrelid='pg_temp.worker_preservation_fixture'::regclass and a.attname=name
  and a.attnum>0 and not a.attisdropped);
create function pg_temp.worker_preservation_hash() returns text language sql as $$
 select md5(coalesce(string_agg(
  (to_jsonb(t)-array(select name from worker_ignored_fields))::text,'' order by
  (to_jsonb(t)-array(select name from worker_ignored_fields))::text),''))
 from worker_preservation_fixture t
$$;
create temporary table worker_hash_before(digest text) on commit drop;
insert into worker_hash_before values(pg_temp.worker_preservation_hash());
insert into worker_preservation_fixture values('synthetic-worker','verified','Original review','private/original.mp4');
do $$ begin
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'An insertion into an initially empty table was hidden';end if;
end $$;
update worker_hash_before set digest=pg_temp.worker_preservation_hash();
alter table worker_preservation_fixture
 add column credential_requirements jsonb,
 add column credential_revision integer not null default 0,
 add column credential_context jsonb,
 add column credential_requirements_note text,
 add column credential_requirements_set_at timestamptz,
 add column credential_requirements_set_by text;
do $$ begin
 if pg_temp.worker_preservation_hash()<>(select digest from worker_hash_before) then
  raise exception 'Reviewed additive fields changed the original record hash';end if;
 update worker_preservation_fixture set status='rejected';
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'An original approval change was hidden';end if;
 update worker_preservation_fixture set status='verified';
 update worker_preservation_fixture set verification_video_url='private/changed.mp4';
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'An original private evidence change was hidden';end if;
 update worker_preservation_fixture set verification_video_url='private/original.mp4';
 delete from worker_preservation_fixture;
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'An original record deletion was hidden';end if;
 insert into worker_preservation_fixture(worker_id,status,review_notes,verification_video_url)
  values('synthetic-worker','verified','Original review','private/original.mp4');
 insert into worker_preservation_fixture(worker_id,status) values('unexpected-worker','verified');
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'An additional record was hidden';end if;
 delete from worker_preservation_fixture where worker_id='unexpected-worker';
end $$;
-- A later deployment must preserve credential values that already exist.
delete from worker_ignored_fields;
update worker_hash_before set digest=pg_temp.worker_preservation_hash();
do $$ begin
 update worker_preservation_fixture set credential_revision=9;
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'An already deployed credential value change was hidden';end if;
 update worker_preservation_fixture set credential_revision=0;
end $$;
alter table worker_preservation_fixture add column unreviewed_new_field text;
do $$ begin
 if pg_temp.worker_preservation_hash()=(select digest from worker_hash_before) then
  raise exception 'Unreviewed schema drift was hidden';end if;
end $$;
rollback;

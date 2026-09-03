create or replace function public.submit_my_property_access_challenge(p_challenge_id uuid,p_video_path text) returns jsonb
language plpgsql security definer set search_path='pg_catalog','public','storage' as $$
declare v_actor public.profiles; v_row public.property_access_challenges;
begin
  select * into v_actor from public.profiles where auth_id=auth.uid()::text and role='property_partner'
    and not coalesce(deleted,false) and not coalesce(suspended,false) and not coalesce(banned,false) limit 1;
  if v_actor is null then raise exception 'Active Property Partner account required'; end if;
  select * into v_row from public.property_access_challenges where id=p_challenge_id and partner_id=v_actor.user_id for update;
  if v_row.id is null then raise exception 'Property access challenge not found'; end if;
  if v_row.status='submitted' and v_row.video_path is not null then
    return jsonb_build_object('success',true,'status','submitted','already_submitted',true,'video_path',v_row.video_path);
  end if;
  if v_row.status='consumed' then raise exception 'This property was already submitted'; end if;
  if v_row.status<>'prepared' then raise exception 'Create a new one-use recording code'; end if;
  if v_row.expires_at<=now() then update public.property_access_challenges set status='expired' where id=v_row.id; raise exception 'The one-use code expired. Create a new code and record again'; end if;
  if split_part(p_video_path,'/',1)<>v_actor.user_id or split_part(p_video_path,'/',2)<>p_challenge_id::text then raise exception 'Invalid private property access path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='property-access-private' and name=p_video_path) then raise exception 'Private property access recording was not found'; end if;
  update public.property_access_challenges set video_path=p_video_path,status='submitted',submitted_at=now() where id=v_row.id;
  return jsonb_build_object('success',true,'status','submitted','already_submitted',false,'video_path',p_video_path);
end $$;
revoke all on function public.submit_my_property_access_challenge(uuid,text) from public,anon;
grant execute on function public.submit_my_property_access_challenge(uuid,text) to authenticated;

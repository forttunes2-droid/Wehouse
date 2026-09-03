create or replace function public.get_my_shared_housing_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare actor text := public.current_profile_user_id(); result jsonb;
begin
  if actor is null then raise exception 'Authenticated profile required'; end if;
  if not exists(
    select 1 from public.shared_housing_members
    where group_id=p_group_id and user_id=actor
  ) then raise exception 'Shared-home access required'; end if;

  select jsonb_build_object(
    'id',g.id,
    'created_by',g.created_by,
    'conversation_id',g.conversation_id,
    'listing_id',g.listing_id,
    'status',g.status,
    'payment_phase',g.payment_phase,
    'expires_at',g.expires_at,
    'total_amount',g.total_amount,
    'reservation_fee_total',g.reservation_fee_total,
    'contract_total',g.contract_total,
    'reservation_id',g.reservation_id,
    'listing',jsonb_build_object(
      'id',l.id,'title',l.title,'price',l.price,'image',l.images[1],
      'address',l.address,'city',l.city,'state',l.state
    ),
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',m.user_id,
        'name',coalesce(p.full_name,p.username,'Roommate'),
        'invitation_status',m.invitation_status,
        'share_amount',m.share_amount,
        'payment_status',m.payment_status,
        'paid_at',m.paid_at
      ) order by m.created_at)
      from public.shared_housing_members m
      left join public.profiles p on p.user_id=m.user_id
      where m.group_id=g.id
    ),'[]'::jsonb)
  ) into result
  from public.shared_housing_groups g
  join public.listings l on l.id=g.listing_id
  where g.id=p_group_id;
  return result;
end;
$$;

revoke all on function public.get_my_shared_housing_group(uuid) from public,anon;
grant execute on function public.get_my_shared_housing_group(uuid) to authenticated,service_role;

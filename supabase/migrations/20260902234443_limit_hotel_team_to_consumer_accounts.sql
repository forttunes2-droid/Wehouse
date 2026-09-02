create or replace function public.enforce_hotel_team_consumer_account()
returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
  if not exists(select 1 from public.profiles p where p.user_id=new.member_user_id and p.account_kind='consumer' and not coalesce(p.deleted,false) and not coalesce(p.suspended,false) and not coalesce(p.banned,false)) then
    raise exception 'Hotel Manager and Hotel Staff must use an active personal WeHouse account';
  end if;
  return new;
end $$;
drop trigger if exists hotel_team_consumer_account_guard on public.hotel_team_members;
create trigger hotel_team_consumer_account_guard before insert or update of member_user_id,status on public.hotel_team_members for each row when(new.status='active') execute function public.enforce_hotel_team_consumer_account();

create index if not exists hotel_team_members_pending_member_idx
  on public.hotel_team_members(member_user_id,created_at desc)
  where status='invited';

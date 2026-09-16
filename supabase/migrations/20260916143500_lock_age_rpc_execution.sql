-- Age eligibility is a signed-in profile setup boundary, not an anonymous API.
-- The completion guard is a trigger function and should never be remotely executable.

revoke execute on function public.require_adult_before_profile_completion() from public;
revoke execute on function public.require_adult_before_profile_completion() from anon;
revoke execute on function public.require_adult_before_profile_completion() from authenticated;

revoke execute on function public.set_my_date_of_birth(date) from public;
revoke execute on function public.set_my_date_of_birth(date) from anon;
revoke execute on function public.set_my_date_of_birth(date) from authenticated;
grant execute on function public.set_my_date_of_birth(date) to authenticated;

comment on function public.set_my_date_of_birth(date)
is 'Signed-in Personal setup command for private adult-eligibility evidence. Anonymous execution is intentionally revoked.';
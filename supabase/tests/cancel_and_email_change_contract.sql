begin;
create function pg_temp.expect(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'FAILED: %', p_msg; end if; end $$;

select pg_temp.expect(to_regprocedure('public.cancel_my_paid_short_let(text)') is not null, 'short let cancel exists');
select pg_temp.expect(has_function_privilege('authenticated','public.cancel_my_paid_short_let(text)','execute'), 'guests can call cancel');
select pg_temp.expect(not has_function_privilege('anon','public.cancel_my_paid_short_let(text)','execute'), 'anon cannot cancel');
select pg_temp.expect(to_regprocedure('public.change_my_email_to_verified_identity(text)') is not null, 'email change exists');
select pg_temp.expect(has_function_privilege('authenticated','public.change_my_email_to_verified_identity(text)','execute'), 'users can call email change');
select pg_temp.expect(not has_function_privilege('anon','public.change_my_email_to_verified_identity(text)','execute'), 'anon cannot change email');

-- No session: both must refuse instead of acting.
do $$ begin
  begin perform public.cancel_my_paid_short_let('00000000-0000-0000-0000-000000000000'); raise exception 'FAILED: cancel ran without sign-in';
  exception when others then if sqlerrm like 'FAILED:%' then raise; end if; end;
  begin perform public.change_my_email_to_verified_identity('x@example.com'); raise exception 'FAILED: email change ran without sign-in';
  exception when others then if sqlerrm like 'FAILED:%' then raise; end if; end;
end $$;
rollback;

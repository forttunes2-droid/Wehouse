-- Hosts see the same current offer arithmetic as customers, through their
-- existing owned-session command. This is a preview, never an accepted booking.
create or replace function public.get_my_experience_session_discount(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.experience_host_actor();s public.experience_sessions;policy public.creator_policy_versions;pricing jsonb;
begin
 select session.* into s from public.experience_sessions session join public.experience_activities a on a.id=session.activity_id where session.id=p_session_id and a.host_user_id=actor;
 if s.id is null then raise exception 'Session unavailable' using errcode='42501';end if;
 select * into policy from public.creator_policy_versions where policy_key='commission_experience' and scope_type='global' and scope_key='*' and status='active' and effective_from<=now() and (effective_until is null or effective_until>now()) order by version desc limit 1;
 if policy.policy_version_id is not null then pricing:=private.experience_session_price(s.id,1);end if;
 return jsonb_build_object('session_id',s.id,'revision',s.discount_revision,'percent',s.discount_percent,'ends_on',s.discount_ends_on,'base_price_minor',s.price_minor,'currency',s.currency,'pricing',pricing);
end $$;
revoke all on function public.get_my_experience_session_discount(uuid) from public,anon;
grant execute on function public.get_my_experience_session_discount(uuid) to authenticated;

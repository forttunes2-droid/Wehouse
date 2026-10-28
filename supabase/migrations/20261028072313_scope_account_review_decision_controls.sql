-- Investigation access does not imply authority to decide internal Team access.
create function private.account_review_can_decide(p_user_id text,p_workspace text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_actor_has_workspace('creator',null) or (
  public.user_has_active_workspace(public.current_profile_user_id(),'admin')
  and p_workspace not in('staff','admin')
  and not (p_workspace='account' and exists(select 1 from public.workspace_role_assignments g
   where g.user_id=p_user_id and g.workspace_role in('staff','admin','creator') and g.status='active' and g.revoked_at is null))
 );
$$;
revoke all on function private.account_review_can_decide(text,text) from public,anon,authenticated,service_role;
do $controls$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.list_account_review_queue(timestamptz,uuid)'::regprocedure);
 needle:='r.version as current_version,r.restricted,';
 if strpos(definition,needle)=0 then raise exception 'Inspect account review queue capabilities';end if;
 execute replace(definition,needle,'r.version as current_version,r.restricted,private.account_review_can_decide(a.user_id,a.workspace) as can_decide,');
 definition:=pg_get_functiondef('public.decide_account_review(uuid,text,text,text,timestamptz,uuid)'::regprocedure);
 needle:=$old$ if actor=a.user_id then raise exception 'Cannot decide your own review';end if;$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect account review decision authority';end if;
 execute replace(definition,needle,$new$ if p_action in('upheld','restored','superseded') and not private.account_review_can_decide(a.user_id,a.workspace) then raise exception 'Creator must decide internal access reviews';end if;
 if actor=a.user_id then raise exception 'Cannot decide your own review';end if;$new$);
end $controls$;

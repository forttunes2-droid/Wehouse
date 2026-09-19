\set ON_ERROR_STOP on
begin;
-- Synthetic identities only. No live account, password, customer record or
-- external action is used. Every fixture and grant is rolled back.
set local session_replication_role=replica;
insert into public.profiles(auth_id,email,user_id,role,profile_complete,account_kind,assigned_state,assigned_lga)
select '77777777-1111-4111-8111-'||lpad(n::text,12,'0'),
  'workspace-contract-'||r||'@example.invalid','workspace-contract-'||r,
  r,true,'consumer','Nasarawa','Lafia'
from (values(1,'creator'),(2,'admin'),(3,'staff'),(4,'worker'),(5,'property_partner'),(6,'user')) as fixture(n,r);
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,scope_state,scope_lga,status)
select 'workspace-contract-'||r,r,
  case when r='admin' then 'branch' when r='staff' then 'state' else 'global' end,
  case when r in('admin','staff') then 'Nasarawa' end,
  case when r='admin' then 'Lafia' end,'active'
from unnest(array['creator','admin','staff','worker','property_partner']) r;
insert into public.workspace_role_assignments(user_id,workspace_role,scope_type,status)
values ('workspace-contract-user','worker','global','active'),
       ('workspace-contract-user','property_partner','global','active');
set local session_replication_role=origin;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare r text; n integer:=0; access jsonb;
begin
  foreach r in array array['creator','admin','staff','worker','property_partner','user'] loop
    n:=n+1;
    perform set_config('request.jwt.claim.sub','77777777-1111-4111-8111-'||lpad(n::text,12,'0'),true);
    access:=public.get_my_workspace_access();
    if not (access->>'personal_workspace')::boolean then
      raise exception 'Personal workspace lost for %',r;
    end if;
    if r<>'user' and (
      not public.user_has_active_workspace('workspace-contract-'||r,r)
      or not public.current_actor_has_workspace(r,null)
    ) then raise exception 'Active workspace denied for %',r; end if;
    if r in('admin','staff') then
      if not public.current_actor_in_scope('Nasarawa','Lafia') then raise exception 'Assigned location denied for %',r; end if;
      if public.current_actor_in_scope('Lagos','Ikeja')
        or public.current_actor_has_workspace(r,'Lagos') then
        raise exception 'Cross-state access accepted from legacy role for %',r;
      end if;
    end if;
    if r='admin' and (
      public.current_actor_in_scope('Nasarawa','Keffi')
      or public.current_actor_in_scope('Nasarawa',null)
      or public.current_actor_in_scope(null,'Lafia')
    ) then raise exception 'Branch Admin widened beyond explicit branch'; end if;
    if r='staff' and not public.current_actor_in_scope('Nasarawa','Keffi') then
      raise exception 'Explicit State grant incorrectly reduced to a branch';
    end if;
    if r='creator' and not public.current_actor_in_scope('Lagos','Ikeja') then
      raise exception 'Global Creator grant lost';
    end if;
    if r in('worker','property_partner','user') and public.current_actor_in_scope('Nasarawa','Lafia') then
      raise exception 'Marketplace identity received internal geographic authority';
    end if;
    if r='user' and (
      not public.current_actor_has_workspace('worker',null)
      or not public.current_actor_has_workspace('property_partner',null)
      or public.current_actor_has_workspace('creator',null)
    ) then raise exception 'Additive Personal workspaces are incorrect'; end if;
  end loop;
end;
$$;
reset role;
update public.workspace_role_assignments set status='revoked',revoked_at=now()
where user_id like 'workspace-contract-%' and status='active';
set local role authenticated;
do $$
declare r text; n integer:=0;
begin
  foreach r in array array['creator','admin','staff','worker','property_partner','user'] loop
    n:=n+1;
    perform set_config('request.jwt.claim.sub','77777777-1111-4111-8111-'||lpad(n::text,12,'0'),true);
    if public.user_has_active_workspace('workspace-contract-'||r,r)
      or public.current_actor_has_workspace(r,null)
      or public.current_actor_in_scope('Nasarawa','Lafia')
      or jsonb_array_length(public.get_my_workspace_access()->'privileged_workspaces')<>0 then
      raise exception 'Revocation bypass through legacy role for %',r;
    end if;
    if not (public.get_my_workspace_access()->>'personal_workspace')::boolean then
      raise exception 'Revoking work authority removed Personal identity';
    end if;
  end loop;
end;
$$;
reset role;
-- Active grants must also fail for suspended, banned or deleted identities.
update public.workspace_role_assignments set status='active',revoked_at=null
where user_id='workspace-contract-creator';
do $$
declare flag text;
begin
  perform set_config('request.jwt.claim.sub','77777777-1111-4111-8111-000000000001',true);
  foreach flag in array array['suspended','banned','deleted'] loop
    execute format('update public.profiles set %I=true where user_id=%L',flag,'workspace-contract-creator');
    if public.user_has_active_workspace('workspace-contract-creator','creator')
      or public.current_actor_has_workspace('creator',null)
      or public.current_actor_in_scope('Nasarawa','Lafia') then
      raise exception 'Inactive Creator retained authority through %',flag;
    end if;
    execute format('update public.profiles set %I=false where user_id=%L',flag,'workspace-contract-creator');
  end loop;
end;
$$;
rollback;

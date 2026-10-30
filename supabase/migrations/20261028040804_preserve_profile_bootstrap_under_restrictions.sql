-- A first profile is created before current_profile_user_id can resolve it.
-- Keep all existing profile/RLS/legal checks; exempt only that authenticated
-- person's ordinary initial identity, never an existing restricted identity.
do $bootstrap$declare definition text;needle text;begin
 definition:=replace(pg_get_functiondef('private.enforce_workspace_write()'::regprocedure),chr(13),'');
 needle:=$old$ if who is null then raise exception 'Active account required';end if;$old$;
 if strpos(definition,needle)=0 then raise exception 'Inspect the workspace write guard before repairing initial profile creation';end if;
 execute replace(definition,needle,$new$ if who is null and tg_table_name='profiles' and tg_op='INSERT'
  and row_data->>'auth_id'=auth.uid()::text and row_data->>'role'='user'
  and row_data->>'account_kind'='consumer' and row_data->>'worker_status' is null
  and not coalesce((row_data->>'worker_verified')::boolean,false)
  and not coalesce((row_data->>'suspended')::boolean,false)
  and not coalesce((row_data->>'banned')::boolean,false)
  and not coalesce((row_data->>'deleted')::boolean,false)
  and not exists(select 1 from public.profiles where auth_id=auth.uid()::text)
 then return new;end if;
 if who is null then raise exception 'Active account required';end if;$new$);
end $bootstrap$;

-- Expose only the revision reference needed to reuse an existing receipt.
do $receipt$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.account_review_portal(text,text,text,uuid,uuid,text,uuid)'::regprocedure);
 needle:='select a.case_id,c.case_number,a.workspace,a.explanation,c.status,c.updated_at,';
 if strpos(definition,needle)=0 then raise exception 'Inspect account review receipt projection';end if;
 execute replace(definition,needle,'select a.case_id,c.case_number,a.workspace,a.restriction_version,a.explanation,c.status,c.updated_at,');
end $receipt$;

begin;
CREATE OR REPLACE FUNCTION public.create_my_partner_pro_recurring_task(p_kind text, p_asset_id text, p_title text, p_due_on date, p_repeat_days integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare task_id uuid;
begin
 if public.current_profile_user_id() is null
  or not public.current_actor_has_workspace('property_partner',null)
  or not public.partner_pro_is_active(public.current_profile_user_id())
  or not public.partner_pro_owns_asset(p_kind,p_asset_id) then
  raise exception 'Owned active Property Partner Pro asset required';
 end if;
 if p_repeat_days is not null and (p_repeat_days not between 1 and 365 or p_due_on is null) then raise exception 'Repeating tasks need a due date and a 1 to 365 day interval'; end if;
 task_id:=public.save_my_partner_pro_task(p_kind,p_asset_id,p_title,p_due_on,null,false);
 update public.partner_pro_tasks set repeat_days=p_repeat_days where id=task_id;
 return task_id;
end $function$;
commit;

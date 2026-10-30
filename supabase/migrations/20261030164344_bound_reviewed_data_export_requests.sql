-- Extend the existing per-user/action throttle; never create a parallel limiter.
alter function public.get_my_personal_data_export_page(uuid,uuid,text,text) set schema private;
alter function private.get_my_personal_data_export_page(uuid,uuid,text,text) rename to personal_data_export_page;
revoke all on function private.personal_data_export_page(uuid,uuid,text,text) from public,anon,authenticated,service_role;

create function public.get_my_personal_data_export_page(p_conversation_id uuid,p_approval_id uuid,p_section text,p_cursor text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person text:=public.current_profile_user_id();budget jsonb;
begin
 if person is null or not public._property_document_session_active() then raise exception 'A trusted account session is required' using errcode='42501';end if;
 budget:=private.consume_user_action(person,'personal_data_export_page',120,60);
 if not coalesce((budget->>'allowed')::boolean,false) then
  raise exception 'Too many export requests. Wait % seconds before continuing.',budget->>'retry_after_seconds' using errcode='53400';
 end if;
 return private.personal_data_export_page(p_conversation_id,p_approval_id,p_section,p_cursor);
end $$;
revoke all on function public.get_my_personal_data_export_page(uuid,uuid,text,text) from public,anon;
grant execute on function public.get_my_personal_data_export_page(uuid,uuid,text,text) to authenticated;

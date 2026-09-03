-- Legacy partner-support mutators predate the scoped property pipeline APIs.
-- Keep them service-only so browser clients cannot forge system actions or assignments.

revoke all on function public.add_conversation_action(uuid,text,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.assign_field_officer(uuid,text,text)
  from public,anon,authenticated;

grant execute on function public.add_conversation_action(uuid,text,text,jsonb)
  to service_role;
grant execute on function public.assign_field_officer(uuid,text,text)
  to service_role;

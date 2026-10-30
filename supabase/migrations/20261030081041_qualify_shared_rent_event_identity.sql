-- Preserve the applied integration and its trigger OID; qualify the local key.
do $$declare definition text:=pg_get_functiondef('private.notify_shared_rent_invitation()'::regprocedure);
begin
 if position('event.event_key=event_key' in definition)=0 then raise exception 'Inspect shared invitation identity before upgrading';end if;
 definition:=replace(definition,'event_key text;','invitation_event_key text;');
 definition:=replace(definition,'event_key:=','invitation_event_key:=');
 definition:=replace(definition,'upsert_activity_event(event_key,','upsert_activity_event(invitation_event_key,');
 definition:=replace(definition,'event.event_key=event_key','event.event_key=invitation_event_key');
 execute definition;
end $$;

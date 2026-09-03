create or replace function public.normalize_notification_context()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.type='roommate_interest' then
    new.source_type:=coalesce(new.source_type,'roommate_interest');
    new.source_id:=coalesce(new.source_id,nullif(new.related_id,''));
    new.destination_route:=coalesce(new.destination_route,'roommate');
    new.destination_params:=coalesce(new.destination_params,'{}'::jsonb)||jsonb_build_object('interestId',new.related_id);
  elsif new.type='roommate_match' then
    new.source_type:=coalesce(new.source_type,'roommate_conversation');
    new.source_id:=coalesce(new.source_id,nullif(new.related_id,''));
    new.destination_route:=coalesce(new.destination_route,'messages');
    new.destination_params:=coalesce(new.destination_params,'{}'::jsonb)||jsonb_build_object('conversationId',new.related_id);
  elsif new.type in ('announcement','official_announcement') then
    new.source_type:=coalesce(new.source_type,'announcement');
    new.destination_route:=coalesce(new.destination_route,'notifications');
    new.destination_params:=coalesce(new.destination_params,'{}'::jsonb)||jsonb_build_object('announcementId',new.related_id);
  end if;
  return new;
end;
$function$;

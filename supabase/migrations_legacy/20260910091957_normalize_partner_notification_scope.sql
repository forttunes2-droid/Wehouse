-- Older lifecycle writers used the role name `property_partner`, while the
-- canonical notification workspace is `partner`. Normalize at the boundary so
-- an otherwise valid rent or handover transition cannot be rolled back by its
-- notification side effect.
create or replace function public.set_notification_workspace_scope()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  new.workspace_scope := coalesce(
    nullif(btrim(new.workspace_scope),''),
    public.infer_notification_workspace_scope(
      new.recipient_id,
      new.type,
      new.source_type,
      new.destination_route,
      new.title
    )
  );
  if new.workspace_scope = 'property_partner' then
    new.workspace_scope := 'partner';
  end if;
  if new.workspace_scope not in ('personal','worker','partner','staff','admin','creator','account') then
    raise exception 'Unsupported notification workspace scope';
  end if;
  return new;
end;
$$;

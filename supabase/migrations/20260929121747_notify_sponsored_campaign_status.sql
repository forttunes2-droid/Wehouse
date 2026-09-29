-- A verified campaign transition belongs in the owner's workspace Activity.
-- Drafts and pending checkouts do not imply payment or delivery.
create or replace function private.notify_sponsored_campaign_status()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','private' as $$
declare
  v_event_id uuid;
  v_workspace text;
  v_title text;
  v_summary text;
  v_route text;
begin
  if old.status is not distinct from new.status
     or new.status not in ('active','paused') then
    return new;
  end if;

  v_workspace := case when new.resource_type='worker' then 'worker' else 'property_partner' end;
  v_route := case when new.resource_type='worker' then 'worker_paid_tools' else 'finance' end;
  v_title := case when new.status='active'
    then 'Sponsored placement is active' else 'Sponsored placement paused' end;
  v_summary := case when new.status='active'
    then 'Your paid placement can appear in matching results until its end date.'
    else 'Open Sponsored to see the reason and the next step.' end;

  v_event_id := private.upsert_activity_event(
    'sponsored:'||new.campaign_id::text||':'||new.status||':'||new.updated_at::text,
    'sponsored_campaign_'||new.status,
    'sponsored_campaign',new.campaign_id::text,null,
    v_title,v_summary,v_route,
    jsonb_build_object('campaign_id',new.campaign_id,'resource_type',new.resource_type),
    new.updated_at
  );
  perform private.add_activity_audience(
    v_event_id,new.owner_user_id,v_workspace,'sponsored',null,false
  );
  return new;
end;
$$;

revoke all on function private.notify_sponsored_campaign_status() from public, anon, authenticated;
drop trigger if exists notify_sponsored_campaign_status on public.sponsored_campaigns;
create trigger notify_sponsored_campaign_status
after update of status on public.sponsored_campaigns
for each row execute function private.notify_sponsored_campaign_status();

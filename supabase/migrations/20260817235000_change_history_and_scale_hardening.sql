CREATE OR REPLACE FUNCTION public.creator_get_change_history(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 150)
 RETURNS TABLE(event_id text, actor_name text, actor_role text, action_label text, area_label text, subject_label text, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor public.profiles;
  v_limit integer := least(greatest(coalesce(p_limit,150),1),250);
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE auth_id=(select auth.uid())::text
    AND role='creator'
    AND coalesce(deleted,false)=false
    AND coalesce(suspended,false)=false
    AND coalesce(banned,false)=false
  LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Creator access required'; END IF;

  RETURN QUERY
  WITH human_events AS (
    SELECT a.*, actor.full_name actor_full_name, actor.username actor_username,
           actor.role actor_profile_role, target_profile.full_name target_name,
           target_profile.username target_username, ps.label setting_label
    FROM public.audit_logs a
    JOIN LATERAL (
      SELECT p.full_name,p.username,p.role
      FROM public.profiles p
      WHERE p.user_id=a.admin_id OR p.auth_id=a.admin_id
         OR (a.admin_email IS NOT NULL AND lower(p.email)=lower(a.admin_email))
      ORDER BY CASE WHEN p.user_id=a.admin_id THEN 0 WHEN p.auth_id=a.admin_id THEN 1 ELSE 2 END
      LIMIT 1
    ) actor ON true
    LEFT JOIN public.platform_settings ps
      ON a.target_type='platform_settings' AND ps.key=a.target_id
    LEFT JOIN public.profiles target_profile
      ON a.target_type='profiles' AND target_profile.user_id=a.target_id
    WHERE actor.role IN ('creator','admin','staff')
      AND upper(coalesce(a.action,'')) NOT LIKE 'STAFF_TRUST%'
      AND (
        (a.target_type='platform_settings'
          AND upper(a.action)='UPDATE'
          AND actor.role='creator'
          AND coalesce(ps.editable,false)=true
          AND lower(coalesce(a.target_id,'')) NOT LIKE '%secret%'
          AND lower(coalesce(a.target_id,'')) NOT LIKE '%password%'
          AND lower(coalesce(a.target_id,'')) NOT LIKE '%token%')
        OR
        (a.target_type='profiles' AND upper(a.action) IN
          ('ROLE_CHANGE','REASSIGN','SUSPEND','RESTORE','BAN','UNBAN','DELETE','PROMOTE','DEMOTE'))
        OR
        (a.target_type IN ('worker_verifications','listings','inspection_requests','listing_reports','withdrawals','wallets','worker_bookings')
          AND upper(a.action) IN
          ('APPROVE','REJECT','SUSPEND','RESTORE','REASSIGN','RESOLVE','DISMISS','FREEZE','UNFREEZE','RELEASE','HOLD','REFUND','CANCEL','COMPLETE'))
      )
  ), projected AS (
    SELECT
      md5(coalesce(h.id,'')||':'||h.created_at::text) AS event_id,
      coalesce(h.actor_full_name,h.actor_username,'WeHouse team')::text AS actor_name,
      h.actor_profile_role::text AS actor_role,
      CASE upper(h.action)
        WHEN 'ROLE_CHANGE' THEN 'Changed role for'
        WHEN 'REASSIGN' THEN 'Reassigned'
        WHEN 'APPROVE' THEN 'Approved'
        WHEN 'REJECT' THEN 'Rejected'
        WHEN 'SUSPEND' THEN 'Suspended'
        WHEN 'RESTORE' THEN 'Restored'
        WHEN 'BAN' THEN 'Restricted'
        WHEN 'UNBAN' THEN 'Restored'
        WHEN 'RESOLVE' THEN 'Resolved'
        WHEN 'DISMISS' THEN 'Dismissed'
        WHEN 'FREEZE' THEN 'Paused'
        WHEN 'UNFREEZE' THEN 'Restored'
        WHEN 'RELEASE' THEN 'Released'
        WHEN 'HOLD' THEN 'Placed on hold'
        WHEN 'REFUND' THEN 'Refunded'
        WHEN 'CANCEL' THEN 'Cancelled'
        WHEN 'COMPLETE' THEN 'Completed'
        WHEN 'UPDATE' THEN 'Changed'
        ELSE initcap(replace(lower(h.action),'_',' '))
      END::text AS action_label,
      CASE lower(h.target_type)
        WHEN 'platform_settings' THEN 'Settings'
        WHEN 'profiles' THEN 'Team & accounts'
        WHEN 'worker_bookings' THEN 'Worker bookings'
        WHEN 'worker_verifications' THEN 'Workers'
        WHEN 'listings' THEN 'Properties'
        WHEN 'inspection_requests' THEN 'Properties'
        WHEN 'listing_reports' THEN 'Moderation'
        WHEN 'withdrawals' THEN 'Finance'
        WHEN 'wallets' THEN 'Finance'
        ELSE 'Operations'
      END::text AS area_label,
      CASE lower(h.target_type)
        WHEN 'platform_settings' THEN coalesce(h.setting_label,'Platform setting')
        WHEN 'profiles' THEN coalesce(h.target_name,h.target_username,'WeHouse account')
        WHEN 'worker_bookings' THEN 'Worker service booking'
        WHEN 'worker_verifications' THEN 'Worker review'
        WHEN 'listings' THEN 'Property listing'
        WHEN 'inspection_requests' THEN 'Property inspection'
        WHEN 'listing_reports' THEN 'Listing report'
        WHEN 'withdrawals' THEN 'Payout request'
        WHEN 'wallets' THEN 'Wallet'
        ELSE 'Operational record'
      END::text AS subject_label,
      h.created_at AS occurred_at
    FROM human_events h
  )
  SELECT p.event_id,p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label,p.occurred_at
  FROM projected p
  WHERE nullif(trim(coalesce(p_search,'')),'') IS NULL
     OR lower(concat_ws(' ',p.actor_name,p.actor_role,p.action_label,p.area_label,p.subject_label))
        LIKE '%'||lower(trim(p_search))||'%'
  ORDER BY p.occurred_at DESC
  LIMIT v_limit;
END;
$function$


REVOKE ALL ON FUNCTION public.creator_get_change_history(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_get_change_history(text,integer) TO authenticated,service_role;

DO $$
DECLARE pol record; q text; wc text;
BEGIN
  FOR pol IN SELECT schemaname,tablename,policyname,qual,with_check FROM pg_policies
    WHERE schemaname='public' AND (coalesce(qual,'') ~ 'auth\\.(uid|jwt|role)\\(\\)' OR coalesce(with_check,'') ~ 'auth\\.(uid|jwt|role)\\(\\)')
  LOOP
    q:=pol.qual; wc:=pol.with_check;
    IF q IS NOT NULL THEN q:=replace(replace(replace(q,'auth.uid()','(select auth.uid())'),'auth.jwt()','(select auth.jwt())'),'auth.role()','(select auth.role())'); END IF;
    IF wc IS NOT NULL THEN wc:=replace(replace(replace(wc,'auth.uid()','(select auth.uid())'),'auth.jwt()','(select auth.jwt())'),'auth.role()','(select auth.role())'); END IF;
    EXECUTE format('ALTER POLICY %I ON %I.%I%s%s',pol.policyname,pol.schemaname,pol.tablename,CASE WHEN q IS NOT NULL THEN ' USING ('||q||')' ELSE '' END,CASE WHEN wc IS NOT NULL THEN ' WITH CHECK ('||wc||')' ELSE '' END);
  END LOOP;
END
$$;

DO $$
DECLARE fk record; cols text;
BEGIN
  FOR fk IN SELECT c.oid,c.conname,n.nspname schema_name,t.relname table_name,c.conkey FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.contype='f' AND n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1]=c.conkey)
  LOOP
    SELECT string_agg(quote_ident(a.attname),',' ORDER BY u.ord) INTO cols FROM unnest(fk.conkey) WITH ORDINALITY u(attnum,ord) JOIN pg_attribute a ON a.attrelid=(select conrelid from pg_constraint where oid=fk.oid) AND a.attnum=u.attnum;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',left('idx_fk_'||fk.table_name||'_'||replace(fk.conname,fk.table_name||'_',''),63),fk.schema_name,fk.table_name,cols);
  END LOOP;
END
$$;

DROP INDEX IF EXISTS public.uq_saved_listings_user_listing;
ALTER EXTENSION btree_gist SET SCHEMA extensions;

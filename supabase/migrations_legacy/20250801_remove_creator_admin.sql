-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Remove creator_admin from live database objects
-- Date: 2025-08-01
-- Source: Live pg_policies + pg_get_functiondef() only
-- Historical migrations: NOT used
-- Frontend: Commit ecb5769
-- Prerequisite: SELECT COUNT(*) FROM profiles WHERE role = 'creator_admin' = 0
-- 
-- EXECUTION: Wrapped in BEGIN/COMMIT for atomicity.
-- If any statement fails, the entire migration rolls back.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- PART 0: GUARD — Abort if any user still has creator_admin
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE role = 'creator_admin';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'BLOCKED: % user(s) still have role = creator_admin. Run UPDATE profiles SET role = ''creator'' WHERE role = ''creator_admin'' first.', v_count;
  END IF;
END $$;

-- ============================================================================
-- PART 1: RLS POLICIES — 46 policies, ALTER POLICY, token removal only
-- ============================================================================

-- 1. announcements.announcements_staff_write
ALTER POLICY "announcements_staff_write" ON announcements
  USING ((sender_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 2. audit_logs.audit_select_admin
ALTER POLICY "audit_select_admin" ON audit_logs
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'admin'::text]))))));

-- 3. bank_account_history.staff_admin_all_bank
ALTER POLICY "staff_admin_all_bank" ON bank_account_history
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 4. blue_badge_subscriptions.blue_badge_staff
ALTER POLICY "blue_badge_staff" ON blue_badge_subscriptions
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 5. chat_photo_usage.photo_usage_admin
ALTER POLICY "photo_usage_admin" ON chat_photo_usage
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'state_admin'::text, 'admin'::text, 'director'::text]))))));

-- 6. conversations.conversations_insert
ALTER POLICY "conversations_insert" ON conversations
  WITH CHECK ((participant_a = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 7. conversations.conversations_participants
ALTER POLICY "conversations_participants" ON conversations
  USING ((participant_a = (auth.uid())::text) OR (participant_b = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 8. conversations.conversations_select
ALTER POLICY "conversations_select" ON conversations
  USING ((participant_a = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (participant_b = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 9. conversations.conversations_update
ALTER POLICY "conversations_update" ON conversations
  USING ((participant_a = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (participant_b = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 10. enquiries.enquiries_owner
ALTER POLICY "enquiries_owner" ON enquiries
  USING ((user_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 11. escrow_transactions.escrow_participant
ALTER POLICY "escrow_participant" ON escrow_transactions
  USING ((payer_user_id = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (payee_user_id = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 12. financial_audit_log.audit_log_staff
ALTER POLICY "audit_log_staff" ON financial_audit_log
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 13. financial_audit_logs.audit_staff
ALTER POLICY "audit_staff" ON financial_audit_logs
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 14. listing_reports.listing_reports_policy
ALTER POLICY "listing_reports_policy" ON listing_reports
  USING ((reporter_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 15. listings.listings_staff_all
ALTER POLICY "listings_staff_all" ON listings
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 16. messages.messages_participants
ALTER POLICY "messages_participants" ON messages
  USING ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = messages.conversation_id) AND ((conversations.participant_a = (auth.uid())::text) OR (conversations.participant_b = (auth.uid())::text))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 17. messages.messages_select
ALTER POLICY "messages_select" ON messages
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((c.participant_a = ( SELECT profiles.user_id
           FROM profiles
          WHERE (profiles.auth_id = (auth.uid())::text)
         LIMIT 1)) OR (c.participant_b = ( SELECT profiles.user_id
           FROM profiles
          WHERE (profiles.auth_id = (auth.uid())::text)
         LIMIT 1)))))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 18. payment_reversals.staff_admin_reversals
ALTER POLICY "staff_admin_reversals" ON payment_reversals
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 19. payments.payments_owner
ALTER POLICY "payments_owner" ON payments
  USING (((user_id)::text = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 20. platform_settings.platform_settings_modify_creator
ALTER POLICY "platform_settings_modify_creator" ON platform_settings
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));

-- 21. rent_plans.staff_admin_manage_rent
ALTER POLICY "staff_admin_manage_rent" ON rent_plans
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 22. reservation_refunds.staff_admin_all_refunds
ALTER POLICY "staff_admin_all_refunds" ON reservation_refunds
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 23. reservations.reservations_owner
ALTER POLICY "reservations_owner" ON reservations
  USING ((user_id = (auth.uid())::text) OR (staff_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 24. reviews.reviews_owner
ALTER POLICY "reviews_owner" ON reviews
  USING (((user_id)::text = (auth.uid())::text) OR ((worker_id)::text = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 25. role_change_history.role_change_history_policy
ALTER POLICY "role_change_history_policy" ON role_change_history
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['admin'::text, 'state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 26. service_categories.service_categories_staff_manage
ALTER POLICY "service_categories_staff_manage" ON service_categories
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 27. service_subcategories.service_subcategories_staff_manage
ALTER POLICY "service_subcategories_staff_manage" ON service_subcategories
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 28. staff.staff_admin_write
ALTER POLICY "staff_admin_write" ON staff
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['admin'::text, 'state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 29. staff.staff_read
ALTER POLICY "staff_read" ON staff
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 30. staff_reviews.staff_reviews_policy
ALTER POLICY "staff_reviews_policy" ON staff_reviews
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 31. support_tickets.tickets_select_admin
ALTER POLICY "tickets_select_admin" ON support_tickets
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'state_admin'::text, 'admin'::text, 'director'::text]))))));

-- 32. support_tickets.tickets_update_admin
ALTER POLICY "tickets_update_admin" ON support_tickets
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'state_admin'::text, 'admin'::text, 'director'::text]))))));

-- 33. system_settings.system_settings_modify_creator
ALTER POLICY "system_settings_modify_creator" ON system_settings
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));

-- 34. user_activity.user_activity_owner
ALTER POLICY "user_activity_owner" ON user_activity
  USING ((user_id = (auth.uid())::text) OR (auth_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'state_admin'::text, 'assistant_state_admin'::text, 'director'::text, 'creator'::text]))))));

-- 35. user_counters.user_counters_creator
ALTER POLICY "user_counters_creator" ON user_counters
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));

-- 36. user_id_counter.user_id_counter_creator
ALTER POLICY "user_id_counter_creator" ON user_id_counter
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));

-- 37. user_ids.user_ids_creator
ALTER POLICY "user_ids_creator" ON user_ids
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text]))))));

-- 38. user_sessions.sessions_admin
ALTER POLICY "sessions_admin" ON user_sessions
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'state_admin'::text, 'admin'::text, 'director'::text]))))));

-- 39. wallet_transactions.wtx_owner
ALTER POLICY "wtx_owner" ON wallet_transactions
  USING ((user_id = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 40. wallets.wallets_staff
ALTER POLICY "wallets_staff" ON wallets
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 41. withdrawal_requests.wda_owner
ALTER POLICY "wda_owner" ON withdrawal_requests
  USING ((user_id = ( SELECT profiles.user_id
   FROM profiles
  WHERE (profiles.auth_id = (auth.uid())::text)
 LIMIT 1)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 42. withdrawals.withdrawals_staff
ALTER POLICY "withdrawals_staff" ON withdrawals
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 43. worker_verification_reviews.worker_reviews_modify_staff
ALTER POLICY "worker_reviews_modify_staff" ON worker_verification_reviews
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'admin'::text, 'staff'::text]))))));

-- 44. worker_verification_reviews.worker_reviews_select_own
ALTER POLICY "worker_reviews_select_own" ON worker_verification_reviews
  USING ((worker_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['creator'::text, 'admin'::text, 'staff'::text]))))));

-- 45. worker_verifications.worker_verifications_staff
ALTER POLICY "worker_verifications_staff" ON worker_verifications
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.auth_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['staff'::text, 'admin'::text, 'creator'::text]))))));

-- 46. objects.document_files_admin_upload
ALTER POLICY "document_files_admin_upload" ON storage.objects
  WITH CHECK ((bucket_id = 'document-files'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.user_id = (auth.uid())::text) AND (profiles.role = ANY (ARRAY['admin'::text, 'creator'::text, 'staff'::text]))))));

-- ============================================================================
-- PART 2: FUNCTIONS — 18 functions, CREATE OR REPLACE, token removal only
-- ============================================================================

-- ─── 2a. admin_ban_user ───
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_target_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role TEXT; v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  IF p_target_user_id = auth.uid()::text THEN RAISE EXCEPTION 'Cannot ban yourself'; END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator') THEN RAISE EXCEPTION 'Cannot ban Creator'; END IF;
  UPDATE public.profiles SET deleted = true, deleted_at = NOW(), worker_status = 'suspended', updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('BAN', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─── 2b. admin_reactivate_user ───
CREATE OR REPLACE FUNCTION public.admin_reactivate_user(p_target_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  UPDATE public.profiles SET deleted = false, deleted_at = NULL, worker_status = 'active', updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('REACTIVATE', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─── 2c. admin_support_inbox ───
CREATE OR REPLACE FUNCTION public.admin_support_inbox()
 RETURNS TABLE(id uuid, participant_a text, participant_b text, status text, last_message text, last_message_at timestamp with time zone, unread_a integer, unread_b integer, created_at timestamp with time zone, conversation_type text, subject text, user_name text, user_email text, user_phone text, user_state text, user_lga text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role TEXT; v_caller_state TEXT; v_caller_lga TEXT;
BEGIN
  SELECT role, assigned_state, assigned_lga INTO v_caller_role, v_caller_state, v_caller_lga FROM public.profiles WHERE auth_id = auth.uid();
  IF v_caller_role IN ('creator') THEN
    RETURN QUERY SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject, COALESCE(p.full_name, p.username, p.email) as user_name, p.email as user_email, p.phone as user_phone, p.state as user_state, COALESCE(p.local_government, p.city) as user_lga FROM public.conversations c LEFT JOIN public.profiles p ON p.user_id = c.participant_a WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support') AND c.participant_a != 'wehouse_support' ORDER BY c.last_message_at DESC NULLS LAST;
    RETURN;
  END IF;
  IF v_caller_role IN ('admin', 'staff') THEN
    RETURN QUERY SELECT c.id, c.participant_a, c.participant_b, c.status, c.last_message, c.last_message_at, c.unread_a, c.unread_b, c.created_at, c.conversation_type, c.subject, COALESCE(p.full_name, p.username, p.email) as user_name, p.email as user_email, p.phone as user_phone, p.state as user_state, COALESCE(p.local_government, p.city) as user_lga FROM public.conversations c LEFT JOIN public.profiles p ON p.user_id = c.participant_a WHERE c.conversation_type IN ('partner_support', 'partner_inspection', 'general_support') AND c.participant_a != 'wehouse_support' AND p.state = v_caller_state AND COALESCE(p.local_government, p.city) = v_caller_lga ORDER BY c.last_message_at DESC NULLS LAST;
    RETURN;
  END IF;
  RAISE EXCEPTION 'Access denied';
END;
$function$;

-- ─── 2d. admin_suspend_user ───
CREATE OR REPLACE FUNCTION public.admin_suspend_user(p_target_user_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role TEXT; v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  IF p_target_user_id = auth.uid()::text THEN RAISE EXCEPTION 'Cannot suspend yourself'; END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator') THEN RAISE EXCEPTION 'Cannot suspend Creator'; END IF;
  UPDATE public.profiles SET worker_status = 'suspended', updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('SUSPEND', 'profiles', p_target_user_id, '{}'::text, auth.uid()::text);
END;
$function$;

-- ─── 2e. admin_update_role ───
CREATE OR REPLACE FUNCTION public.admin_update_role(p_target_user_id text, p_new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role TEXT; v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid()::text;
  IF v_caller_role NOT IN ('admin','creator') THEN RAISE EXCEPTION 'Admin/Creator access required'; END IF;
  IF p_target_user_id = auth.uid()::text THEN RAISE EXCEPTION 'Cannot modify your own role'; END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role IN ('creator') THEN RAISE EXCEPTION 'Cannot modify Creator role'; END IF;
  IF p_new_role NOT IN ('user','worker','property_partner','staff','admin','creator') THEN RAISE EXCEPTION 'Invalid role: %', p_new_role; END IF;
  UPDATE public.profiles SET role = p_new_role, updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id)
  VALUES ('ROLE_CHANGE', 'profiles', p_target_user_id, jsonb_build_object('new_role', p_new_role)::text, auth.uid()::text);
END;
$function$;

-- ─── 2f. creator_reassign_branch ───
CREATE OR REPLACE FUNCTION public.creator_reassign_branch(p_target_user_id text, p_new_state text, p_new_lga text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller_role TEXT; v_target_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE auth_id = auth.uid();
  IF v_caller_role NOT IN ('creator') THEN RAISE EXCEPTION 'Only Creator can reassign branches'; END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE user_id = p_target_user_id;
  IF v_target_role NOT IN ('admin', 'staff') THEN RAISE EXCEPTION 'Can only reassign Admin or Staff. Target is: %', v_target_role; END IF;
  UPDATE public.profiles SET assigned_state = p_new_state, assigned_lga = p_new_lga, state = p_new_state, local_government = p_new_lga, city = p_new_lga, updated_at = NOW() WHERE user_id = p_target_user_id;
  INSERT INTO public.audit_logs (action, target_type, target_id, details, admin_id) VALUES ('REASSIGN', 'profiles', p_target_user_id, jsonb_build_object('new_branch', p_new_state || ' / ' || p_new_lga)::text, auth.uid()::text);
  RETURN TRUE;
END;
$function$;

-- ─── 2g. credit_wallet ───
CREATE OR REPLACE FUNCTION public.credit_wallet(p_wallet_id uuid, p_amount numeric, p_description text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance NUMERIC;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = p_wallet_id FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet is frozen');
  END IF;

  v_new_balance := v_wallet.available_balance + p_amount;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE id = p_wallet_id;

  INSERT INTO wallet_transactions (
    user_id, transaction_type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    v_wallet.owner_id, 'credit', p_amount, p_description,
    p_reference, 'wallet_credit', v_new_balance
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$function$;

-- ─── 2h. current_user_is_staff ───
CREATE OR REPLACE FUNCTION public.current_user_is_staff()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_id = auth.uid()::text
      AND role IN ('staff','admin','state_admin','assistant_state_admin','director','creator')
  );
$function$;

-- ─── 2i. customer_confirm_payment ───
CREATE OR REPLACE FUNCTION public.customer_confirm_payment(p_booking_id uuid, p_user_id text, p_paystack_ref text, p_paystack_tx_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN RETURN FALSE; END IF;

  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  -- Require server-verified payment reference
  IF NOT EXISTS (
    SELECT 1 FROM verified_paystack_references WHERE paystack_reference = p_paystack_ref
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE worker_bookings SET
    status = 'confirmed',
    paystack_reference = p_paystack_ref,
    paystack_transaction_id = p_paystack_tx_id,
    updated_at = NOW()
  WHERE id = p_booking_id AND user_id = p_user_id AND status = 'waiting_payment';

  RETURN FOUND;
END;
$function$;

-- ─── 2j. is_staff_or_creator ───
CREATE OR REPLACE FUNCTION public.is_staff_or_creator(uid text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_id = uid
      AND role IN ('staff','admin','state_admin','assistant_state_admin','creator')
  );
$function$;

-- ─── 2k. process_withdrawal ───
CREATE OR REPLACE FUNCTION public.process_withdrawal(p_withdrawal_id uuid, p_paystack_transfer_code text, p_paystack_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_withdrawal RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Withdrawal not pending');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE id = v_withdrawal.wallet_id;
  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  UPDATE withdrawals SET
    status = 'processing',
    paystack_transfer_code = p_paystack_transfer_code,
    paystack_transfer_reference = p_paystack_reference,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', true, 'status', 'processing');
END;
$function$;

-- ─── 2l. record_bank_account_change ───
CREATE OR REPLACE FUNCTION public.record_bank_account_change(p_user_id text, p_bank_name text, p_bank_code text, p_bank_account_number text, p_bank_account_name text, p_verified_account_name text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed_by TEXT;
  v_changed_by_role TEXT;
BEGIN
  -- ── AUTH ──
  SELECT user_id, role INTO v_changed_by, v_changed_by_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  -- Self or staff only
  IF v_changed_by != p_user_id AND v_changed_by_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  -- ── This function ONLY inserts into bank_account_history ──
  -- It does NOT modify wallets, withdrawals, or withdrawal_requests.
  -- Changing the bank account on a pending withdrawal requires
  -- a separate workflow (cancel + re-create, or admin override).

  INSERT INTO bank_account_history (
    user_id, bank_name, bank_code, bank_account_number,
    bank_account_name, verified_account_name,
    is_verified, changed_by
  ) VALUES (
    p_user_id, p_bank_name, p_bank_code, p_bank_account_number,
    p_bank_account_name, p_verified_account_name,
    p_verified_account_name IS NOT NULL, v_changed_by
  );

  INSERT INTO financial_audit_logs (
    event_type, user_id, reference_id, reference_type, description
  ) VALUES (
    'bank_account_change', p_user_id, p_user_id, 'profile',
    'Bank changed to: ' || p_bank_name || ' / ' || p_bank_account_number
  );

  RETURN TRUE;
END;
$function$;

-- ─── 2m. record_worker_verification_payment ───
CREATE OR REPLACE FUNCTION public.record_worker_verification_payment(p_user_id text, p_reference text, p_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller TEXT;
  v_caller_role TEXT;
  v_expected_amount NUMERIC;
  v_payment_id UUID;
  v_verified_ref RECORD;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Only the user themselves or staff can record
  IF v_caller != p_user_id AND v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  IF p_reference IS NULL OR p_reference = '' THEN
    RETURN FALSE;
  END IF;

  -- ── REQUIRE: reference must have been independently server-verified ──
  -- This function CONSUMES verification state, never creates it.
  SELECT * INTO v_verified_ref
  FROM verified_paystack_references
  WHERE paystack_reference = p_reference;

  IF v_verified_ref IS NULL THEN
    RETURN FALSE; -- Reference was never server-verified
  END IF;

  -- ── Ownership: verified reference must belong to this user ──
  SELECT bp.user_id INTO v_payment_id FROM booking_payments bp
  WHERE bp.id = v_verified_ref.booking_payment_id;

  -- Note: booking_payments row must exist with correct payer_user_id
  IF NOT EXISTS (
    SELECT 1 FROM booking_payments
    WHERE id = v_verified_ref.booking_payment_id
    AND (payer_user_id = p_user_id OR user_id = p_user_id)
  ) THEN
    RETURN FALSE; -- Verified reference belongs to another user
  END IF;

  -- ── Derive expected amount from settings (NOT browser) ──
  SELECT COALESCE(NULLIF(value, '')::NUMERIC, 0) INTO v_expected_amount
  FROM platform_settings WHERE key = 'worker_verification_fee';

  IF v_expected_amount <= 0 THEN
    RETURN FALSE;
  END IF;

  -- ── Idempotency: already recorded? ──
  IF EXISTS (
    SELECT 1 FROM booking_payments
    WHERE paystack_reference = p_reference AND purpose = 'worker_verification'
  ) THEN
    RETURN TRUE;
  END IF;

  -- ── Record payment in booking_payments ──
  INSERT INTO booking_payments (
    payment_reference, user_id, type,
    payer_user_id, payee_user_id,
    amount, amount_total, commission_amount, net_amount,
    currency, status, purpose,
    paystack_reference,
    paid_at, webhook_processed,
    metadata
  ) VALUES (
    'WHWV_' || p_reference, p_user_id, 'worker_subscription',
    p_user_id, p_user_id,
    v_expected_amount, v_expected_amount, 0, v_expected_amount,
    'NGN', 'completed', 'worker_verification',
    p_reference,
    NOW(), TRUE,
    jsonb_build_object('recorded_by', v_caller, 'expected_amount', v_expected_amount, 'submitted_amount', p_amount, 'verified_by', v_verified_ref.verified_by, 'verified_at', v_verified_ref.verified_at)
  )
  RETURNING id INTO v_payment_id;

  -- ── Audit log ──
  INSERT INTO financial_audit_logs (
    event_type, user_id, amount, reference_id, reference_type, description
  ) VALUES (
    'worker_verification_payment', p_user_id, v_expected_amount,
    v_payment_id::text, 'booking_payment',
    'Worker verification payment recorded (post-verify): ' || p_reference
  );

  RETURN TRUE;
END;
$function$;

-- ─── 2n. refund_escrow ───
CREATE OR REPLACE FUNCTION public.refund_escrow(p_escrow_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_escrow RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  SELECT * INTO v_escrow FROM escrow_transactions WHERE id = p_escrow_id FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow not found');
  END IF;

  IF v_escrow.status NOT IN ('holding', 'disputed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Escrow cannot be refunded');
  END IF;

  UPDATE escrow_transactions SET
    status = 'refunded',
    updated_at = NOW()
  WHERE id = p_escrow_id;

  RETURN jsonb_build_object('success', true, 'amount_refunded', v_escrow.amount_total);
END;
$function$;

-- ─── 2o. release_escrow ───
CREATE OR REPLACE FUNCTION public.release_escrow(p_booking_id uuid, p_released_by text DEFAULT 'system'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_escrow RECORD;
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
  v_new_balance NUMERIC;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN FALSE;
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_escrow
  FROM escrow_transactions
  WHERE booking_id = p_booking_id AND status = 'holding'
  FOR UPDATE;

  IF v_escrow IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_wallet
  FROM wallets
  WHERE owner_id = v_escrow.payee_user_id
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_wallet.is_frozen THEN
    RETURN FALSE;
  END IF;

  -- Amount derived server-side from escrow.amount_payee
  v_new_balance := v_wallet.available_balance + v_escrow.amount_payee;

  UPDATE wallets SET
    available_balance = v_new_balance,
    updated_at = NOW()
  WHERE id = v_wallet.id;

  UPDATE escrow_transactions SET
    status = 'released',
    released_at = NOW(),
    released_by = COALESCE(p_released_by, v_caller),
    updated_at = NOW()
  WHERE id = v_escrow.id;

  INSERT INTO wallet_transactions (
    user_id, transaction_type, amount, description,
    reference_id, reference_type, balance_after
  ) VALUES (
    v_wallet.owner_id, 'escrow_release', v_escrow.amount_payee,
    'Escrow released for booking ' || p_booking_id::text,
    v_escrow.id::text, 'escrow', v_new_balance
  );

  RETURN TRUE;
END;
$function$;

-- ─── 2p. reverse_payment ───
CREATE OR REPLACE FUNCTION public.reverse_payment(p_payment_id uuid, p_reversal_type text, p_reason text DEFAULT NULL::text, p_reversal_reference text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment RECORD;
  v_processed_by TEXT;
  v_processed_by_role TEXT;
  v_net NUMERIC;
BEGIN
  -- ── AUTH ──
  SELECT user_id, role INTO v_processed_by, v_processed_by_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  -- Staff/admin/creator only
  IF v_processed_by_role NOT IN ('staff','admin','creator') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_payment FROM booking_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.status IN ('refunded', 'disputed') THEN RAISE EXCEPTION 'Already reversed'; END IF;

  v_net := 0;

  INSERT INTO payment_reversals (
    original_payment_id, original_reference, reversal_type,
    original_amount, reversal_amount, net_after_reversal,
    reason, processed_by, reversal_reference
  ) VALUES (
    p_payment_id, v_payment.paystack_reference, p_reversal_type,
    COALESCE(v_payment.amount_total, v_payment.amount, 0),
    COALESCE(v_payment.amount_total, v_payment.amount, 0),
    v_net, p_reason, v_processed_by, p_reversal_reference
  );

  UPDATE booking_payments
  SET status = 'refunded', updated_at = NOW()
  WHERE id = p_payment_id;

  UPDATE commission_ledger
  SET status = 'refunded', updated_at = NOW()
  WHERE payment_id = p_payment_id;

  RETURN TRUE;
END;
$function$;

-- ─── 2q. set_setting_v2 ───
CREATE OR REPLACE FUNCTION public.set_setting_v2(p_key text, p_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                        DECLARE
                                          v_role TEXT;
                                          BEGIN
                                            -- Validate caller is creator
                                              SELECT role INTO v_role FROM profiles WHERE user_id = auth.uid()::text;
                                                IF v_role NOT IN ('creator') THEN
                                                    RAISE EXCEPTION 'Only Creator can modify settings';
                                                      END IF;
                                                        
                                                          INSERT INTO platform_settings (key, value, updated_at)
                                                            VALUES (p_key, p_value, NOW())
                                                              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                                                                RETURN TRUE;
                                                                END;
                                                                $function$;

-- ─── 2r. unfreeze_wallet ───
CREATE OR REPLACE FUNCTION public.unfreeze_wallet(p_wallet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet RECORD;
  v_caller TEXT;
  v_caller_role TEXT;
BEGIN
  -- ── AUTH: Identify caller ──
  SELECT user_id, role INTO v_caller, v_caller_role
  FROM profiles WHERE auth_id = auth.uid()::text;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  -- ── AUTHORIZATION: staff/admin/creator only ──
  IF v_caller_role NOT IN ('staff','admin','creator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  UPDATE wallets SET
    is_frozen = FALSE,
    frozen_reason = NULL,
    frozen_by = NULL,
    frozen_at = NULL,
    updated_at = NOW()
  WHERE id = p_wallet_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- PART 3: POST-MIGRATION VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_policy_count INTEGER;
  v_func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE qual::text LIKE '%creator_admin%' OR with_check::text LIKE '%creator_admin%';

  IF v_policy_count > 0 THEN
    RAISE WARNING 'Verification FAILED: % RLS policy(s) still reference creator_admin', v_policy_count;
  ELSE
    RAISE NOTICE 'Verification PASSED: Zero RLS policies reference creator_admin';
  END IF;

  SELECT COUNT(*) INTO v_func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND pg_get_functiondef(p.oid) LIKE '%creator_admin%';

  IF v_func_count > 0 THEN
    RAISE WARNING 'Verification FAILED: % function(s) still reference creator_admin', v_func_count;
  ELSE
    RAISE NOTICE 'Verification PASSED: Zero functions reference creator_admin';
  END IF;
END $$;

-- ============================================================================

COMMIT;

-- ============================================================================
-- PART 4: POST-COMMIT MANUAL VERIFICATION (run these queries after applying)
-- ============================================================================

-- 4a. Verify zero RLS policies still reference creator_admin:
--   SELECT schemaname, tablename, policyname
--   FROM pg_policies
--   WHERE qual::text LIKE '%creator_admin%' OR with_check::text LIKE '%creator_admin%';
--   Expected: 0 rows

-- 4b. Verify zero functions still reference creator_admin:
--   SELECT n.nspname, p.proname
--   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
--   WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
--     AND pg_get_functiondef(p.oid) LIKE '%creator_admin%';
--   Expected: 0 rows

-- 4c. Verify no user has creator_admin:
--   SELECT COUNT(*) FROM profiles WHERE role = 'creator_admin';
--   Expected: 0

-- 4d. Verify no unexpected role values exist (whitelist check):
--   SELECT DISTINCT role FROM profiles
--   WHERE role NOT IN ('user','worker','property_partner','staff','admin','creator');
--   Expected: 0 rows (creator_admin and any other non-canonical roles absent)

-- 4e. Verify canonical role distribution:
--   SELECT role, COUNT(*) FROM profiles GROUP BY role ORDER BY role;
--   Expected: user, worker, property_partner, staff, admin, creator
--             (no creator_admin row)

-- ============================================================================
-- PART 5: ROLLBACK NOTES
-- ============================================================================
-- To rollback: re-run the archived original definitions captured
-- before this migration via pg_get_functiondef() and pg_policies.

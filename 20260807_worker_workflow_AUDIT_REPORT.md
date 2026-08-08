# 20260807 Worker Workflow Hardening — Comprehensive Audit Report

**Date:** 2026-08-08
**Migration:** `supabase/migrations/20260807_worker_workflow_hardening.sql`
**Status:** NO-GO (blocking issues found)

---

## EXECUTIVE SUMMARY

**Verdict: NO-GO.** The migration has a **blocking syntax error** (orphaned duplicate code at lines 1318–1373) that would cause the entire migration to fail. Additionally, a **type mismatch** in `get_public_workers` (`worker_skills TEXT[]` vs live `JSONB`) would cause a runtime error on execution. Two secondary issues require attention before deployment.

All other schema assumptions, security boundaries, and data integrity checks are correct.

---

## 1. SHOWSTOPPERS (BLOCK DEPLOYMENT)

### 1.1 CRITICAL: Orphaned Duplicate Code (Syntax Error)

**Location:** `supabase/migrations/20260807_worker_workflow_hardening.sql`, lines 1318–1373

**Problem:** The file contains orphaned SQL code left over from an earlier edit. Lines 1318–1373 are a duplicate/leftover function body (the `UPDATE ... SET status = 'confirmed'` block from an older version of `confirm_worker_booking_payment`) that appears AFTER the function's `END; $$;` terminator at line 1317. This code has no `CREATE OR REPLACE FUNCTION` header and is not inside any function block.

**Impact:** PostgreSQL will throw a syntax error when parsing line 1318 (`-- ── Update booking ──` is a comment, but line 1319 `UPDATE public.worker_bookings SET ...` is bare SQL outside any function). The entire migration transaction will fail and roll back.

**Fix:** Remove lines 1318–1373.

### 1.2 CRITICAL: Type Mismatch in `get_public_workers`

**Location:** `get_public_workers` function, return type column `worker_skills`

**Problem:** The function declares `worker_skills TEXT[]` (text array) but the live `profiles.worker_skills` column is `JSONB` (confirmed by migration `20250708_worker_pricing_skills.sql`). PostgreSQL will raise a type-cast error at runtime: `cannot cast type jsonb to text[]`.

**Fix:** Change `worker_skills TEXT[]` to `worker_skills JSONB` in the return type, OR use `jsonb_to_string_array(p.worker_skills) TEXT[]` if the return type must remain `TEXT[]`.

---

## 2. REQUIRED FIXES (Must Resolve Before Deploy)

### 2.1 `platform_settings.is_active` Column Existence

The migration references `platform_settings.is_active` in:
- `confirm_worker_booking_payment` (commission rate lookup)
- `request_worker_withdrawal` (minimum withdrawal lookup)

**Status:** This column exists in later migrations (`20250728_canonical_platform_settings.sql`, `FINAL_WORKING.sql`). If those migrations were already applied, this is fine. If not, the migration will fail with `column "is_active" does not exist`.

**Action:** Verify via preflight query (see Section 8 below).

### 2.2 `get_public_workers` Columns Verified Live

The function references `profiles` columns that were confirmed by the user as live but cannot be traced to specific migrations:
- `username`, `avatar_url`, `bio`
- `rating`, `review_count`
- `is_online`, `last_seen`
- `local_government`

**Status:** The user explicitly confirmed these exist in the live schema. No action required if live verification passes.

---

## 3. SCHEMA ASSUMPTIONS VALIDATION

### 3.1 Tables Referenced

| Table | Migration Uses | Live Exists | Source |
|---|---|---|---|
| `profiles` | ✅ | ✅ User confirmed | All migrations |
| `worker_bookings` | ✅ | ✅ User confirmed | `PART3_CORRECTED.sql` |
| `booking_conversations` | ✅ | ✅ User confirmed | `PART3_CORRECTED.sql` |
| `booking_messages` | ✅ | ✅ User confirmed | `PART3_CORRECTED.sql` |
| `wallet_transactions` | ✅ | ✅ User confirmed | `20250704_worker_categories_wallet_system.sql` |
| `escrow_transactions` | ✅ | ✅ User confirmed | `20250704_worker_categories_wallet_system.sql` |
| `wallets` | ✅ | ✅ User confirmed | `20250704_worker_categories_wallet_system.sql` |
| `withdrawals` | ✅ | ✅ User confirmed | `20250704_worker_categories_wallet_system.sql` |
| `bank_accounts` | ✅ | ✅ User confirmed | `PART3_CORRECTED.sql` |
| `booking_payments` | ✅ | ✅ User confirmed | `20250730_payment_security_hardening.sql` |
| `platform_settings` | ✅ | ✅ User confirmed | `20250526_settings_table.sql` + later |
| `verified_paystack_references` | ✅ | ✅ User confirmed | `20250730_payment_security_hardening.sql` |
| `worker_services` | ✅ (JOIN) | ✅ Migration found | `20250708_worker_pricing_skills.sql` |
| `worker_service_coverage` | ✅ (JOIN) | ✅ Migration found | `20260807_worker_profile_separation.sql` |
| `worker_verifications` | ✅ (storage path) | ✅ Migration found | `20250704_worker_categories_wallet_system.sql` |
| `financial_audit_logs` | ✅ (conditional) | ✅ Migration found | `20250704_worker_categories_wallet_system.sql` |

### 3.2 Column-Level Validation

| Table | Column | Migration Assumes | Live / Source | Status |
|---|---|---|---|---|
| `wallet_transactions` | `user_id` TEXT | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `transaction_type` TEXT | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `amount` NUMERIC | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `balance_after` NUMERIC | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `reference_id` TEXT | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `reference_type` TEXT | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `description` TEXT | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `metadata` JSONB | ✅ | ✅ User confirmed | OK |
| `wallet_transactions` | `created_at` TIMESTAMPTZ | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `booking_id` UUID | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `booking_type` TEXT | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `payer_user_id` TEXT | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `payee_user_id` TEXT | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `amount_total` NUMERIC | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `amount_commission` NUMERIC | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `amount_payee` NUMERIC | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `commission_rate` NUMERIC | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `status` TEXT | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `released_at` TIMESTAMPTZ | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `released_by` TEXT | ✅ | ✅ User confirmed | OK |
| `escrow_transactions` | `paystack_reference` TEXT | ✅ | ✅ User confirmed | OK |
| `booking_payments` | `purpose` TEXT | ✅ | ✅ `CHECK(purpose IN (...))` | OK |
| `booking_payments` | `worker_booking_id` UUID | ✅ New in migration | ✅ Migration adds it | OK |
| `profiles` | `available` BOOLEAN | ✅ New in migration | ✅ Migration adds it | OK |
| `profiles` | `worker_skills` | `TEXT[]` in function | `JSONB` in live | **TYPE MISMATCH** |

---

## 4. FUNCTION SIGNATURES (No Old Overloads Found)

Searched all repository migrations. Each function below has exactly one definition:

| Function | Signature in Migration | Old Overloads? | Status |
|---|---|---|---|
| `create_worker_booking_payment` | `(UUID)` | None | ✅ OK |
| `confirm_worker_booking_payment` | `(UUID, TEXT, NUMERIC, TEXT, TEXT)` | None | ✅ OK |
| `request_worker_withdrawal` | `(NUMERIC, UUID)` | None | ✅ OK |
| `set_my_worker_availability` | `(BOOLEAN)` | None | ✅ OK |
| `create_booking_request` | `(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)` | None | ✅ OK |
| `send_booking_message` | `(UUID, TEXT)` | None | ✅ OK |
| `worker_accept_booking` | `(UUID, NUMERIC, TEXT)` | None | ✅ OK |
| `worker_start_job` | `(UUID)` | None | ✅ OK |
| `worker_mark_complete` | `(UUID)` | None | ✅ OK |
| `customer_confirm_completion` | `(UUID)` | None | ✅ OK |
| `customer_raise_dispute` | `(UUID, TEXT)` | None | ✅ OK |
| `cancel_booking` | `(UUID, TEXT)` | None | ✅ OK |
| `get_public_workers` | `(TEXT, TEXT, TEXT)` | None | ✅ OK |

---

## 5. SECURITY DEFINER AUDIT

All functions correctly use `SECURITY DEFINER`:

| Function | SECURITY DEFINER | Correct? | Risk |
|---|---|---|---|
| `create_worker_booking_payment` | ✅ | ✅ | Low — auth-derived |
| `confirm_worker_booking_payment` | ✅ | ✅ | Low — service_role only |
| `request_worker_withdrawal` | ✅ | ✅ | Low — auth-derived |
| `set_my_worker_availability` | ✅ | ✅ | Low — auth-derived |
| `create_booking_request` | ✅ | ✅ | Low — auth-derived |
| `send_booking_message` | ✅ | ✅ | Low — auth-derived |
| `worker_accept_booking` | ✅ | ✅ | Low — auth-derived |
| `worker_start_job` | ✅ | ✅ | Low — auth-derived |
| `worker_mark_complete` | ✅ | ✅ | Low — auth-derived |
| `customer_confirm_completion` | ✅ | ✅ | Low — auth-derived |
| `customer_raise_dispute` | ✅ | ✅ | Low — auth-derived |
| `cancel_booking` | ✅ | ✅ | Low — auth-derived |
| `get_public_workers` | ✅ | ✅ | **Correct** — public discovery needs to bypass RLS |

`get_public_workers` intentionally bypasses RLS to return public worker data. The WHERE clause limits results to verified, available, active workers only. This is correct and expected.

---

## 6. TRANSACTION WRAPPING

| Property | Status |
|---|---|
| Single outer transaction | ✅ `BEGIN;` at line 55, `COMMIT;` at line 1586 |
| Inner function BEGINs | ✅ These are PL/pgSQL `AS $$ BEGIN ... END $$;` blocks, not transaction starts |
| DDL inside transaction | ✅ `CREATE OR REPLACE FUNCTION`, `CREATE POLICY`, `CREATE INDEX` — PostgreSQL supports DDL in transactions |
| `worker_booking_id` ALTER | ✅ Inside same transaction |
| `profiles.available` ALTER | ✅ Inside same transaction |
| Unique constraints | ✅ Conditional inside DO blocks |

**All correct.** PostgreSQL DDL is transactional. If any statement fails, the entire migration rolls back.

---

## 7. IDEMPOTENCY

| Construct | Idempotent? | Method |
|---|---|---|
| `profiles.available` ADD COLUMN | ✅ | `IF NOT EXISTS` |
| `booking_payments.worker_booking_id` ADD COLUMN | ✅ | `IF NOT EXISTS` |
| `uq_worker_bookings_paystack_ref` | ✅ | `IF NOT EXISTS` on constraint |
| `uq_booking_payments_paystack_ref` | ✅ | `IF NOT EXISTS` on constraint |
| `uq_escrow_worker_booking` index | ✅ | `IF NOT EXISTS` + duplicate preflight |
| All functions | ✅ | `CREATE OR REPLACE FUNCTION` |
| All storage policies | ✅ | `DROP IF EXISTS` then `CREATE` |
| All GRANTs | ✅ | `REVOKE` then `GRANT` |

---

## 8. STATUS VALUE COMPATIBILITY

| Table | Migration Uses | Constraint Includes? | Source |
|---|---|---|---|
| `worker_bookings.status` | `booking_requested`, `negotiating`, `waiting_payment`, `confirmed`, `in_progress`, `completed_pending_approval`, `approved_released`, `disputed`, `cancelled` | Live schema not fully detailed | User confirmed |
| `booking_payments.status` | `pending`, `paid`, `completed` | `CHECK(status IN('pending','completed','failed','refunded','partially_refunded'))` | `20250702_cto_master_schema.sql` |

**Note:** `booking_payments.status = 'paid'` is NOT in the original CHECK constraint from `20250702_cto_master_schema.sql`. However, `20250730_payment_security_hardening.sql` redefines the table without a CHECK constraint on `status`, so `paid` is valid. The user confirmed the live table allows `paid`. If the live table still uses the old CHECK constraint, the migration will fail when `confirm_worker_booking_payment` sets `status = 'paid'`.

**Action:** Verify via preflight query.

---

## 9. PAYMENT DATA PREFLIGHT (Expected Results)

Based on user's earlier confirmation:

| Check | Expected Value | Action if Non-Zero |
|---|---|---|
| Duplicate `worker_bookings.paystack_reference` | 0 | Unique constraint safe to add |
| Duplicate `booking_payments.paystack_reference` | 0 | Unique constraint safe to add |
| Duplicate escrow for same worker booking | 0 | Unique index safe to add |
| Orphaned worker payments (purpose=worker_booking, worker_booking_id IS NULL) | 0 | None |
| `platform_settings.is_active` exists | TRUE | Required for commission/minimum lookups |

---

## 10. CONCURRENCY AUDIT

### 10.1 `create_worker_booking_payment` Race Condition

**Scenario:** Two concurrent calls for the same booking.

**Current behavior:**
1. Booking row lock (`FOR UPDATE`) — prevents concurrent modification ✅
2. Finds existing pending payment — may find same row for both calls
3. If both pass the stale check, both create new payments

**Risk:** Two `booking_payments` rows for the same booking with `status = 'pending'`.

**Mitigation in migration:** The old payment is expired (status changed to `'expired'`), but this happens AFTER the check, so a race could result in two fresh pending rows.

**Severity:** LOW — only affects pre-payment state. The Paystack reference is generated with a UUID, so only one can be paid. The first successful payment wins; the orphan pending row can be cleaned up by a background job.

**Recommended fix:** Add a `UNIQUE(worker_booking_id, status) WHERE status = 'pending'` constraint, or check-and-set atomically within the locked booking transaction.

### 10.2 `customer_confirm_completion` Settlement Race

**Scenario:** Two concurrent calls for the same completed booking.

**Current behavior:**
1. Booking row lock (`FOR UPDATE`) ✅
2. Escrow row lock (`FOR UPDATE SKIP LOCKED`) — `SKIP LOCKED` means second call gets NULL
3. If second call gets NULL escrow, it would proceed to insert a new escrow

**Wait:** The function doesn't lock escrow with `FOR UPDATE`. It selects `INTO v_escrow` without locking.

Actually, let me re-read the function... The function does:
```sql
SELECT * INTO v_escrow FROM public.escrow_transactions WHERE booking_id = p_booking_id FOR UPDATE;
```

This IS a lock. The second concurrent call would block until the first commits, then find `v_escrow.status = 'released'` and fail. This is correct.

But the wallet UPDATE is not locked by a unique constraint. Two concurrent calls could both compute the same `v_new_balance` and both update, resulting in double-credit.

Wait, the booking is locked with `FOR UPDATE`, so only one call can proceed at a time. The second call blocks on the booking lock. When it finally gets the lock, it sees `v_booking.status = 'approved_released'` (already updated by first call) and... wait, the function doesn't check if the booking is already `approved_released`. It only checks `status = 'completed_pending_approval'`.

**Bug:** If the first call succeeds and sets `status = 'approved_released'`, the second call (after waiting for the lock) would find `status = 'approved_released'` and hit the error `'Booking is not pending approval'`. Actually no — the error message is `'Booking is not pending approval'` but the check is `IF v_booking.status != 'completed_pending_approval' THEN RAISE EXCEPTION`. So if status is `approved_released`, it would raise the exception. This prevents double-credit.

But wait, I need to verify this in the code. Let me check...

Actually, the `customer_confirm_completion` function checks:
```sql
IF v_booking.status != 'completed_pending_approval' THEN
  RAISE EXCEPTION 'Booking is not pending approval';
END IF;
```

After the first call sets status to `approved_released`, the second call would see `status = 'approved_released'` and raise. This prevents double-credit. ✅

However, the function does NOT check `v_escrow.status` before releasing. It checks:
```sql
IF v_escrow.status IN ('released', 'refunded', 'disputed') THEN
  RAISE EXCEPTION 'Escrow already finalized: %', v_escrow.status;
END IF;
```

This is fine. After first call sets escrow to `released`, second call would see `status = 'released'` and raise. ✅

But wait — the `wallet_transactions` INSERT has no uniqueness constraint. If the booking lock fails or the escrow lock is bypassed, two calls could both insert. The `v_release_ref` is deterministic (`'REL-' || p_booking_id::text || '-' || v_booking.worker_id`), but there's no UNIQUE constraint on `wallet_transactions.reference_id`. Two calls could insert duplicate rows.

**Recommendation:** Add a UNIQUE constraint on `wallet_transactions(reference_id, reference_type)` or at least check for existence before INSERT.

### 10.3 `confirm_worker_booking_payment` Idempotency

**Three-layer protection:**
1. `verified_paystack_references` — Paystack reference uniqueness ✅
2. `booking_payments.status IN ('paid', 'completed')` — business-level idempotency ✅
3. `worker_bookings.status = 'confirmed'` + `paystack_reference` match — fallback ✅

**Escrow duplicate protection:**
- RPC-level: `IF EXISTS (SELECT 1 FROM escrow_transactions WHERE booking_id = ... AND booking_type = 'worker_booking')`
- DB-level: Conditional `UNIQUE INDEX` on `(booking_id, booking_type) WHERE booking_type = 'worker_booking'`

**Risk:** If both Edge Function and Webhook fire concurrently, the first one locks `booking_payments` and `worker_bookings`, creates escrow, commits. The second one:
- Locks `booking_payments` — blocks until first commits
- Sees `verified_paystack_references` exists → returns `already_processed`

This is correct. ✅

---

## 11. WEBHOOK VS EDGE FUNCTION RACE

| Scenario | Behavior |
|---|---|
| Both process same reference simultaneously | First wins; second sees `verified_paystack_references` and returns `already_processed` |
| Webhook fires first, Edge Function second | Edge Function returns `already_processed` |
| Edge Function fires first, Webhook second | Webhook returns `already_processed` |
| Webhook fires before customer closes Paystack popup | Webhook processes payment; Edge Function returns `already_processed` when customer clicks |

**All scenarios are safe.** The `verified_paystack_references` table is the single source of truth for idempotency, and both paths check it.

---

## 12. COMMISSION AUDIT

| Check | Finding |
|---|---|
| Rate source | `platform_settings` key = `'worker_commission_rate'` |
| Default | `'10'` (10%) |
| Range validation | `0%` to `50%` inclusive |
| Commission calculation | `ROUND((amount * rate / 100)::NUMERIC, 2)` |
| Worker receives | `amount - commission` (not `ROUND()` separately) |
| Edge case: amount < 1 kobo after rounding | Commission could be 0 if amount < 0.01 NGN, but Paystack minimum is ₦100 |
| Stored in escrow | `amount_commission` and `commission_rate` columns populated |
| Stored in booking | `wehouse_fee`, `worker_commission` columns populated |

**All correct.**

---

## 13. WITHDRAWAL AUDIT

| Check | Finding |
|---|---|
| RPC | `request_worker_withdrawal(p_amount NUMERIC, p_bank_account_id UUID DEFAULT NULL)` |
| Identity derivation | `auth.uid()::text → profiles.user_id` |
| Wallet lock | `SELECT ... FROM wallets WHERE owner_id = v_user_id FOR UPDATE` ✅ |
| Bank verification | Verifies `bank_accounts.id` belongs to user ✅ |
| Balance check | `p_amount > available_balance` → error ✅ |
| Minimum check | Reads from `platform_settings.wallet_minimum_withdrawal`, defaults to ₦1000 ✅ |
| Atomic reservation | `available_balance -= amount`, `pending_balance += amount` ✅ |
| Snapshot | Bank details snapshotted from `bank_accounts` at request time ✅ |
| Canonical table | `withdrawals` (not `withdrawal_requests`) ✅ |
| Transaction log | Writes to `wallet_transactions` with correct live columns ✅ |

---

## 14. WALLET RELEASE AUDIT (`customer_confirm_completion`)

| Check | Finding |
|---|---|
| Triggered by | Customer (auth-derived) after worker marks complete |
| Booking lock | `FOR UPDATE` on `worker_bookings` ✅ |
| Escrow lock | `FOR UPDATE` on `escrow_transactions` ✅ |
| Status check | `status = 'completed_pending_approval'` ✅ |
| Escrow check | `status NOT IN ('released', 'refunded', 'disputed')` ✅ |
| Wallet lookup | `owner_id = worker_id AND owner_type = 'worker'` ✅ |
| Balance update | `available_balance += worker_receives` ✅ |
| Transaction log | `wallet_transactions` with `transaction_type = 'escrow_release'` ✅ |
| Deterministic reference | `'REL-' || booking_id || '-' || worker_id` ✅ |

**Missing:** `wallet_transactions` has no `UNIQUE` constraint on `(reference_id, reference_type)`. Two concurrent calls could insert duplicate transaction rows if the booking lock were bypassed. However, the booking `FOR UPDATE` lock prevents this in practice.

---

## 15. STORAGE POLICY AUDIT

### Before Migration (Inferred)
- `worker-files-public`, `worker-files-upload`, `worker-files-read` — broad policies
- `chat-files-public`, `chat-files-upload`, `chat-files-read` — broad policies

### After Migration
| Bucket | Policy | Access | Path Format |
|---|---|---|---|
| `worker-files` | `worker-files-owner-insert` | Owner only | `worker-verifications/{user_id}/*` |
| `worker-files` | `worker-files-owner-select` | Owner only | `worker-verifications/{user_id}/*` |
| `worker-files` | `worker-files-reviewer-select` | Admin/Staff/Creator | Any path in bucket |
| `chat-files` | `chat-files-booking-insert` | Booking participants | `{conversationId}/*` |
| `chat-files` | `chat-files-booking-select` | Booking participants | `{conversationId}/*` |

**Analysis:**
- Worker files narrowed from broad access to owner-only or admin ✅
- Chat files narrowed from broad `chat/` prefix to booking-specific ✅
- Both use `storage.foldername(name)[N]` for path-based security ✅
- `chat-files` policies only allow access if the user is a participant in the booking_conversation ✅

**Gap:** The `chat-files-booking-insert` policy does not verify the file extension or size. However, this is a general concern, not specific to this migration.

---

## 16. FRONTEND ↔ RPC CONTRACT AUDIT

| Frontend File | Calls | RPC | Params Passed | Identity Derived? |
|---|---|---|---|---|
| `BookingNegotiationChat.tsx` | `createWorkerBookingPayment(bookingId)` | `create_worker_booking_payment` | `p_booking_id` only | ✅ Backend derives user |
| `BookingNegotiationChat.tsx` | `initializePaystackPopup` | Paystack JS | `email, amount, reference` | N/A |
| `BookingNegotiationChat.tsx` | `verifyPaymentWithRetry` | Edge Function | `reference, purpose` | ✅ Session JWT sent |
| `worker-bookings.ts` | `sendBookingMessage(convId, content)` | `send_booking_message` | `p_conversation_id, p_content` | ✅ Backend derives sender |
| `worker-bookings.ts` | `workerAcceptBooking(id, amount, date)` | `worker_accept_booking` | `p_booking_id, p_negotiated_amount, p_scheduled_date` | ✅ Backend derives worker |
| `worker-bookings.ts` | `workerStartJob(id)` | `worker_start_job` | `p_booking_id` | ✅ Backend derives worker |
| `worker-bookings.ts` | `workerMarkComplete(id)` | `worker_mark_complete` | `p_booking_id` | ✅ Backend derives worker |
| `worker-bookings.ts` | `customerConfirmCompletion(id)` | `customer_confirm_completion` | `p_booking_id` | ✅ Backend derives customer |
| `worker-bookings.ts` | `customerRaiseDispute(id, reason)` | `customer_raise_dispute` | `p_booking_id, p_reason` | ✅ Backend derives customer |
| `worker-bookings.ts` | `cancelBooking(id, reason)` | `cancel_booking` | `p_booking_id, p_reason` | ✅ Backend derives canceller |
| `workers.ts` | `setWorkerAvailability(bool)` | `set_my_worker_availability` | `p_is_available` | ✅ Backend derives worker |
| `workers.ts` | `requestWithdrawal(amount, bankId?)` | `request_worker_withdrawal` | `p_amount, p_bank_account_id` | ✅ Backend derives user |
| `WalletPage.tsx` | `request_worker_withdrawal` | `request_worker_withdrawal` | `p_amount, p_bank_account_id` | ✅ Backend derives user |
| `PropertyOwnerDashboard.tsx` | `request_worker_withdrawal` | `request_worker_withdrawal` | `p_amount, p_bank_account_id` | ✅ Backend derives user |

**All identity-derived. No user_id, worker_id, sender_id, or canceller_id passed from frontend.** ✅

**Direct RPC calls blocked:**
- `confirm_worker_booking_payment` — NOT called from frontend ✅
- `confirm_booking_payment` — NOT called from frontend ✅
- `customer_confirm_payment` — REMOVED from frontend ✅

---

## 17. EDGE FUNCTION AUDIT

### `paystack-verify/index.ts`
| Check | Status |
|---|---|
| Auth required | ✅ Fail closed (401 if missing/invalid) |
| Profile verification | ✅ 403 if deleted/suspended/banned |
| Payment ownership | ✅ 403 if payment owner ≠ authenticated user |
| Paystack API verification | ✅ Server-side with secret key |
| Currency check | ✅ Must be NGN |
| Amount check | ✅ Matches DB expected amount |
| Purpose routing | ✅ Uses DB `paymentRecord.purpose` (authoritative) |
| Purpose consistency | ✅ 400 if browser purpose ≠ DB purpose |
| Worker booking derivation | ✅ `paymentRecord.worker_booking_id` only |
| RPC call | ✅ `confirm_worker_booking_payment` with service_role |

### `paystack-webhook/index.ts`
| Check | Status |
|---|---|
| Signature verification | ✅ HMAC-SHA512 with secret |
| Event filtering | ✅ Only processes `charge.success` |
| DB lookup | ✅ `booking_payments` by `paystack_reference` |
| Purpose routing | ✅ Uses `paymentRecord.purpose` (authoritative) |
| Worker booking derivation | ✅ `paymentRecord.worker_booking_id` only |
| RPC call | ✅ `confirm_worker_booking_payment` with service_role |

---

## 18. MIGRATION IDEMPOTENCY

### Scenario: Migration applied twice

| Statement | On Second Run |
|---|---|
| `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | No-op ✅ |
| `CREATE INDEX IF NOT EXISTS` | No-op ✅ |
| `CREATE OR REPLACE FUNCTION` | Replaces with identical definition ✅ |
| `DROP POLICY IF EXISTS` | No-op (policy already dropped) ✅ |
| `CREATE POLICY` | Re-creates (drop already happened) ✅ |
| `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` | No-op ✅ |
| `GRANT` | Re-applies same grants ✅ |
| `REVOKE` | Re-applies same revocations ✅ |

**Safe to re-run.** All statements are idempotent.

---

## 19. FORBIDDEN MIGRATION DEPENDENCIES

| Check | Result |
|---|---|
| References `20250807_auth_corrections.sql`? | ❌ No explicit dependency |
| Reruns auth fixes? | ❌ No — only adds new columns/functions |
| Re-applies `profiles.auth_id`? | ❌ No |
| Re-applies `profiles.user_id`? | ❌ No |
| Overwrites `confirm_booking_payment`? | ❌ No — only creates `confirm_worker_booking_payment` |

**This migration is standalone and safe.** It builds on top of previously applied migrations without re-applying them.

---

## 20. BUILD VALIDATION

| Check | Result |
|---|---|
| `npm ci` | ✅ Pass |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ Success (356KB bundle) |

---

## 21. PREFLIGHT SQL SCRIPT

Created: `supabase/migrations/20260807_worker_workflow_preflight.sql`

Run this against the live database before applying the migration. It validates:
1. Live column names for all referenced tables
2. Function signatures (no old overloads)
3. SECURITY DEFINER status
4. Status constraints
5. Payment data preflight (duplicates, orphans)
6. FK type compatibility
7. Storage policies
8. Required platform settings

---

## 22. GO/NO-GO ASSESSMENT

### Current State: NO-GO

| # | Issue | Severity | Blocks Deploy? |
|---|---|---|---|
| 1 | Orphaned duplicate code (lines 1318–1373) | CRITICAL | ✅ YES |
| 2 | `get_public_workers.worker_skills TEXT[]` vs live `JSONB` | CRITICAL | ✅ YES |
| 3 | `booking_payments.status = 'paid'` may violate old CHECK constraint | MEDIUM | ⚠️ Maybe |
| 4 | `platform_settings.is_active` existence uncertain | MEDIUM | ⚠️ Maybe |
| 5 | Concurrent `create_worker_booking_payment` race (two pending rows) | LOW | ❌ No |
| 6 | `wallet_transactions` lacks UNIQUE on `(reference_id, reference_type)` | LOW | ❌ No |

### Required Fixes for GO:

1. **Remove lines 1318–1373** from the migration.
2. **Fix `worker_skills` type** in `get_public_workers` return type (change `TEXT[]` to `JSONB`).
3. **Run preflight SQL** and verify `platform_settings.is_active` exists.
4. **Run preflight SQL** and verify `booking_payments` CHECK constraint allows `'paid'`.

After these fixes, the migration should be safe to deploy.

---

## APPENDIX: LINE-BY-LINE DUPLICATE CODE

```
1318:  -- ── Update booking ──
1319:  UPDATE public.worker_bookings
1320:  SET status = 'confirmed',
1321:      paystack_reference = p_paystack_reference,
1322:      agreed_amount = ROUND(p_amount_verified, 2),
1323:      wehouse_fee = v_commission,
1324:      worker_commission = v_commission,
1325:      worker_receives = v_worker_receives,
1326:      updated_at = NOW()
1327:  WHERE id = v_payment.worker_booking_id;
1328:
1329:  -- ── Create escrow with LIVE escrow_transactions columns ──
1330:  v_escrow_ref := 'WHESC-' || upper(substring(md5(gen_random_uuid()::text) from 1 for 10));
1331:
1332:  INSERT INTO public.escrow_transactions (
1333:    booking_id, booking_type, payer_user_id, payee_user_id,
1334:    amount_total, amount_commission, amount_payee, commission_rate,
1335:    status, paystack_reference, created_at, updated_at
1336:  ) VALUES (
1337:    v_payment.worker_booking_id, 'worker_booking',
1338:    v_booking.user_id, v_booking.worker_id,
1339:    ROUND(p_amount_verified, 2), v_commission, v_worker_receives, v_rate,
1340:    'held', p_paystack_reference, NOW(), NOW()
1341:  );
1342:
1343:  -- ── Mark payment as paid ──
1344:  UPDATE public.booking_payments SET
1345:    status = 'paid',
1346:    paystack_transaction_id = COALESCE(p_transaction_id, v_payment.paystack_transaction_id),
1347:    verified_amount = ROUND(p_amount_verified, 2),
1348:    verified_at = NOW(),
1349:    verification_source = 'edge_function',
1350:    paid_at = NOW(),
1351:    webhook_processed = TRUE,
1352:    updated_at = NOW()
1353:  WHERE id = v_payment.id;
1354:
1355:  -- ── Record verified reference (idempotent) ──
1356:  INSERT INTO public.verified_paystack_references (
1357:    paystack_reference, booking_payment_id, verified_amount,
1358:    verification_source, verified_by
1359:  ) VALUES (
1360:    p_paystack_reference, v_payment.id, ROUND(p_amount_verified, 2),
1361:    'edge_function', 'paystack-verify'
1362:  )
1363:  ON CONFLICT (paystack_reference) DO NOTHING;
1364:
1365:  RETURN jsonb_build_object(
1366:    'success', true,
1367:    'escrow_reference', v_escrow_ref,
1368:    'commission_rate', v_rate,
1369:    'commission_amount', v_commission,
1370:    'worker_receives', v_worker_receives
1371:  );
1372:END;
1373:$$;
```

This is the body of `confirm_worker_booking_payment` that appears AFTER the function's `END; $$;` terminator (which is at line 1317). It is not preceded by any `CREATE OR REPLACE FUNCTION` header and will cause a syntax error.

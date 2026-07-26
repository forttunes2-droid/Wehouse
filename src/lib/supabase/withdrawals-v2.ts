// ═══════════════════════════════════════════════════════════
// Withdrawal System v2 — Atomic Available Balance
// All financial validation is server-side.
// ═══════════════════════════════════════════════════════════

import { supabase } from './client';

// ─── Request withdrawal (atomic: validate + reserve funds) ───
export async function requestWithdrawalV2(
  walletId: string,
  amount: number,
  bankDetails: {
    bank_account_number: string;
    bank_code: string;
    bank_name: string;
    account_name: string;
  }
) {
  const { data, error } = await supabase.rpc('request_withdrawal_v2', {
    p_wallet_id: walletId,
    p_amount: amount,
    p_bank_account_number: bankDetails.bank_account_number,
    p_bank_code: bankDetails.bank_code,
    p_bank_name: bankDetails.bank_name,
    p_account_name: bankDetails.account_name,
  });
  return { withdrawalId: data, error };
}

// ─── Approve withdrawal (admin/staff only) ───
export async function approveWithdrawalV2(
  withdrawalId: string,
  approvedByUserId: string
) {
  const { data, error } = await supabase.rpc('approve_withdrawal_v2', {
    p_withdrawal_id: withdrawalId,
    p_approved_by: approvedByUserId,
  });
  return { success: data, error };
}

// ─── Reject withdrawal (releases reserved funds) ───
export async function rejectWithdrawalV2(
  withdrawalId: string,
  reason?: string
) {
  const { data, error } = await supabase.rpc('reject_withdrawal_v2', {
    p_withdrawal_id: withdrawalId,
    p_reason: reason || null,
  });
  return { success: data, error };
}

// ─── Get wallet with available balance breakdown ───
export async function getWalletWithAvailableBalance(userId: string) {
  const { data, error } = await supabase
    .from('wallets')
    .select('id, owner_user_id, available_balance, reserved_balance, pending_balance, total_earned, total_withdrawn, bank_name, bank_account_number, bank_account_name')
    .eq('owner_user_id', userId)
    .single();
  return { wallet: data, error };
}

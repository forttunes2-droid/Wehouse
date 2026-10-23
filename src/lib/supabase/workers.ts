import { supabase } from './client';
import type { ServiceCategory, ServiceSubcategory, Wallet, WalletTransaction, PaymentProtectionTransaction, Withdrawal, FinancialAuditLog } from '@/types';

// ═══════════════════════════════════════════════════════════════
// WORKER DISCOVERY — Find workers by filters
// ═══════════════════════════════════════════════════════════════

// Worker: Toggle availability (accepting new bookings)
// ═══════════════════════════════════════════════════════════════
// SERVICE CATEGORIES — Database-Driven
// ═══════════════════════════════════════════════════════════════

export async function getServiceCategories(includeInactive = false) {
  let query = supabase.from('service_categories').select('*');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('sort_order', { ascending: true });
  return { categories: data as ServiceCategory[] | null, error };
}

export async function getServiceSubcategories(categoryId?: string, includeInactive = false) {
  let query = supabase.from('service_subcategories').select('*');
  if (categoryId) query = query.eq('category_id', categoryId);
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('sort_order', { ascending: true });
  return { subcategories: data as ServiceSubcategory[] | null, error };
}

export async function getCategoryWithSubcategories() {
  const { categories, error: catError } = await getServiceCategories();
  if (catError || !categories) return { categories: null, error: catError };

  const { data: subcategories, error: subError } = await supabase
    .from('service_subcategories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (subError) return { categories: null, error: subError };

  const enriched = categories.map((cat: ServiceCategory) => ({
    ...cat,
    subcategories: (subcategories as ServiceSubcategory[] || []).filter((s: ServiceSubcategory) => s.category_id === cat.id),
  }));

  return { categories: enriched, error: null };
}

// Creator: Create category
export async function createServiceCategory(name: string, icon = '', sortOrder = 0) {
  const { data, error } = await supabase
    .from('service_categories')
    .insert({ name, icon, sort_order: sortOrder })
    .select()
    .single();
  return { category: data as ServiceCategory | null, error };
}

// Creator: Update category
export async function updateServiceCategory(id: string, updates: Partial<ServiceCategory>) {
  const { data, error } = await supabase
    .from('service_categories')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  return { category: data as ServiceCategory | null, error };
}

// Creator: Create subcategory
export async function createServiceSubcategory(categoryId: string, name: string, icon = '', sortOrder = 0) {
  const { data, error } = await supabase
    .from('service_subcategories')
    .insert({ category_id: categoryId, name, icon, sort_order: sortOrder })
    .select()
    .single();
  return { subcategory: data as ServiceSubcategory | null, error };
}

// Creator: Update subcategory
export async function updateServiceSubcategory(id: string, updates: Partial<ServiceSubcategory>) {
  if (typeof updates.name === 'string') {
    const { data, error } = await supabase.rpc('rename_service_subcategory', {
      p_subcategory_id: id,
      p_name: updates.name,
    });
    if (error || !data || Object.keys(updates).length === 1)
      return { subcategory: data as ServiceSubcategory | null, error };
  }
  const { data, error } = await supabase
    .from('service_subcategories')
    .update({ ...updates, name: undefined })
    .eq('id', id)
    .select()
    .single();
  return { subcategory: data as ServiceSubcategory | null, error };
}

// Creator: Delete category (uses RPC to handle cascade)
export async function deleteServiceCategory(id: string) {
  const { error } = await supabase.rpc('delete_service_category', {
    p_category_id: id,
  });
  return { error };
}

// Creator: Delete subcategory
export async function deleteServiceSubcategory(id: string) {
  const { error } = await supabase.rpc('delete_service_subcategory', {
    p_subcategory_id: id,
  });
  return { error };
}

// Seed default subcategories for a category
export async function seedSubcategoriesForCategory(categoryId: string, categoryName: string) {
  const { DEFAULT_SUBCATEGORIES } = await import('@/types');
  const subs = DEFAULT_SUBCATEGORIES[categoryName];
  if (!subs || subs.length === 0) return { error: null };

  const inserts = subs.map((name, i) => ({
    category_id: categoryId,
    name,
    sort_order: i + 1,
    is_active: true,
  }));

  const { error } = await supabase.from('service_subcategories').insert(inserts);
  return { error };
}

// ═══════════════════════════════════════════════════════════════
// WALLETS
// ═══════════════════════════════════════════════════════════════

export async function getWallet(ownerId: string, ownerType: 'worker' | 'property_partner') {
  // Wallets are created by the server when the first earning arrives; the client only reads.
  const { data: existing, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('owner_type', ownerType)
    .maybeSingle();
  return { wallet: (existing as Wallet | null) ?? null, error };
}

export async function getWalletTransactions(walletId: string, limit = 50) {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { transactions: data as WalletTransaction[] | null, error };
}

// Money is credited and bank details are saved only by server code (payout-account function,
// payment-protection release). The client exposes no wallet writes.

// ═══════════════════════════════════════════════════════════════
// PAYMENT PROTECTION
// ═══════════════════════════════════════════════════════════════

export async function getPaymentProtectionForBooking(bookingId: string) {
  const { data, error } = await supabase
    .from('payment_protection_transactions')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  return { transaction: data as PaymentProtectionTransaction | null, error };
}

// ═══════════════════════════════════════════════════════════════
// WITHDRAWALS — Automatic via Paystack
// ═══════════════════════════════════════════════════════════════

// Withdrawal requests use useWalletWithdrawal, which persists an intent ID
// and reconciles the same canonical withdrawal after a lost response.

export async function getWithdrawals(walletId?: string, status?: Withdrawal['status']) {
  let query = supabase.from('withdrawals').select('*').order('created_at', { ascending: false });
  if (walletId) query = query.eq('wallet_id', walletId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  return { withdrawals: data as Withdrawal[] | null, error };
}

// ═══════════════════════════════════════════════════════════════
// FINANCIAL AUDIT LOGS
// ═══════════════════════════════════════════════════════════════

export async function logFinancialEvent(log: Omit<FinancialAuditLog, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('financial_audit_logs')
    .insert(log)
    .select()
    .single();
  return { log: data as FinancialAuditLog | null, error };
}

export async function getFinancialAuditLogs(filters?: {
  eventType?: FinancialAuditLog['event_type'];
  userId?: string;
  limit?: number;
  offset?: number;
}) {
  let query = supabase
    .from('financial_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (filters?.eventType) query = query.eq('event_type', filters.eventType);
  if (filters?.userId) query = query.eq('user_id', filters.userId);
  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error, count } = await query;
  return { logs: data as FinancialAuditLog[] | null, error, count };
}

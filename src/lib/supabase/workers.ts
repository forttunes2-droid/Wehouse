import { supabase } from './client';
import type { Profile, ServiceCategory, ServiceSubcategory, WorkerVerification, BlueBadgeSubscription, Wallet, WalletTransaction, EscrowTransaction, Withdrawal, FinancialAuditLog } from '@/types';

// ═══════════════════════════════════════════════════════════════
// WORKER DISCOVERY — Find workers by filters
// ═══════════════════════════════════════════════════════════════

export async function getWorkers(filters?: { city?: string; occupation?: string; status?: string }) {
  let query = supabase.from('profiles').select('*').eq('role', 'worker');
  if (filters?.city) query = query.eq('city', filters.city);
  if (filters?.occupation) query = query.eq('worker_occupation', filters.occupation);
  if (filters?.status) query = query.eq('worker_status', filters.status);
  // No status filter = show all workers (pending + verified + suspended)
  const { data, error } = await query.order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

// Parse worker status from profile
export function parseWorkerStatus(profile: Profile): string {
  const match = profile.bio?.match(/🛠️STATUS:(\w+)🛠️/);
  if (match) return match[1];
  if (profile.worker_status) return profile.worker_status;
  return 'pending';
}

export async function getAllWorkers() {
  // Use RPC to bypass RLS
  const { data, error } = await supabase.rpc('admin_get_all_workers');
  return { workers: data as Profile[] | null, error };
}

export async function getPendingWorkers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'worker')
    .eq('worker_status', 'pending')
    .order('created_at', { ascending: false });
  return { workers: data as Profile[] | null, error };
}

export async function updateWorkerStatus(userId: string, status: 'pending' | 'verified' | 'suspended' | 'rejected') {
  const { data: row } = await supabase
    .from('profiles')
    .select('bio')
    .eq('user_id', userId)
    .maybeSingle();

  const bio = row?.bio || '';
  const cleanBio = bio.replace(/🛠️STATUS:\w+🛠️/g, '').trim();
  const newBio = `🛠️STATUS:${status}🛠️ ${cleanBio}`.trim();

  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ bio: newBio })
    .eq('user_id', userId)
    .select();

  if (!error && (!updated || updated.length === 0)) {
    return { error: { message: `Update succeeded but 0 rows changed for user ${userId}` } as any };
  }

  if (!error) {
    try {
      await supabase
        .from('profiles')
        .update({ worker_status: status, worker_verified: status === 'verified', updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } catch { /* columns may not exist, bio is the source of truth */ }
  }

  return { error };
}

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
  const { data, error } = await supabase
    .from('service_subcategories')
    .update(updates)
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
// WORKER VERIFICATION VIDEO UPLOAD
// ═══════════════════════════════════════════════════════════════

export async function uploadWorkerVerificationVideo(file: File, workerId: string) {
  // Validate file
  const validTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
  if (!validTypes.includes(file.type)) {
    return { url: null, error: { message: 'Only MP4, MOV, or WebM videos are allowed' } as any };
  }

  // Max 100MB for skill demonstration videos (2-3 minutes)
  if (file.size > 100 * 1024 * 1024) {
    return { url: null, error: { message: 'Video must be under 100MB' } as any };
  }

  const ext = file.name.split('.').pop() || 'mp4';
  const path = `worker-verifications/${workerId}/skill-demo-${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from('worker-files')
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) return { url: null, error };

  const { data: urlData } = supabase.storage.from('worker-files').getPublicUrl(data.path);
  return { url: urlData.publicUrl, error: null };
}

// ═══════════════════════════════════════════════════════════════
// WORKER VERIFICATION
// ═══════════════════════════════════════════════════════════════

export async function submitWorkerVerification(verification: {
  worker_id: string;
  gov_id_type?: string | null;
  gov_id_number?: string | null;
  gov_id_photo_url?: string | null;
  selfie_photo_url?: string | null;
  verification_video_url?: string | null;
  years_of_experience?: number;
  service_category_id?: string | null;
  service_subcategory_id?: string | null;
}) {
  const { data, error } = await supabase
    .from('worker_verifications')
    .upsert(
      { ...verification, status: 'pending', updated_at: new Date().toISOString() },
      { onConflict: 'worker_id' }
    )
    .select()
    .single();
  return { verification: data as WorkerVerification | null, error };
}

export async function getWorkerVerification(workerId: string) {
  const { data, error } = await supabase
    .from('worker_verifications')
    .select('*, service_category:service_categories(*), service_subcategory:service_subcategories(*)')
    .eq('worker_id', workerId)
    .maybeSingle();
  return { verification: data as WorkerVerification | null, error };
}

export async function getVerificationsByStatus(status?: WorkerVerification['status']) {
  let query = supabase
    .from('worker_verifications')
    .select('*, service_category:service_categories(*), service_subcategory:service_subcategories(*), worker:profiles(*)')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  return { verifications: data as (WorkerVerification & { worker: Profile })[] | null, error };
}

// Staff: Review a verification
export async function reviewWorkerVerification(
  verificationId: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
  notes?: string
) {
  const { data, error } = await supabase
    .from('worker_verifications')
    .update({
      status,
      reviewed_by: reviewedBy,
      review_notes: notes || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId)
    .select()
    .single();

  if (!error && data) {
    // Also update the worker's profile status
    const workerId = data.worker_id;
    const newStatus = status === 'approved' ? 'verified' : 'rejected';
    await updateWorkerStatus(workerId, newStatus);
  }

  return { verification: data as WorkerVerification | null, error };
}

// ═══════════════════════════════════════════════════════════════
// BLUE BADGE SUBSCRIPTION
// ═══════════════════════════════════════════════════════════════

export async function getBlueBadgeSubscription(workerId: string) {
  const { data, error } = await supabase
    .from('blue_badge_subscriptions')
    .select('*')
    .eq('worker_id', workerId)
    .maybeSingle();
  return { subscription: data as BlueBadgeSubscription | null, error };
}

export async function createBlueBadgeSubscription(
  workerId: string,
  paystackReference: string,
  amountPaid: number
) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + 1); // Monthly subscription

  const { data, error } = await supabase
    .from('blue_badge_subscriptions')
    .upsert(
      {
        worker_id: workerId,
        status: 'active',
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        paystack_reference: paystackReference,
        amount_paid: amountPaid,
        updated_at: now.toISOString(),
      },
      { onConflict: 'worker_id' }
    )
    .select()
    .single();
  return { subscription: data as BlueBadgeSubscription | null, error };
}

export async function cancelBlueBadgeSubscription(workerId: string) {
  const { data, error } = await supabase
    .from('blue_badge_subscriptions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('worker_id', workerId)
    .select()
    .single();
  return { subscription: data as BlueBadgeSubscription | null, error };
}

// ═══════════════════════════════════════════════════════════════
// WALLETS
// ═══════════════════════════════════════════════════════════════

export async function getOrCreateWallet(ownerId: string, ownerType: 'worker' | 'property_partner') {
  // Try to get existing
  const { data: existing } = await supabase
    .from('wallets')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('owner_type', ownerType)
    .maybeSingle();

  if (existing) return { wallet: existing as Wallet, error: null };

  // Create new wallet
  const { data, error } = await supabase
    .from('wallets')
    .insert({ owner_id: ownerId, owner_type: ownerType })
    .select()
    .single();
  return { wallet: data as Wallet | null, error };
}

export async function getWallet(ownerId: string) {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle();
  return { wallet: data as Wallet | null, error };
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

// Credit wallet (when escrow is released)
export async function creditWallet(walletId: string, amount: number, description: string, reference?: string) {
  // Use RPC for atomic operation
  const { data, error } = await supabase.rpc('credit_wallet', {
    p_wallet_id: walletId,
    p_amount: amount,
    p_description: description,
    p_reference: reference || null,
  });
  return { result: data, error };
}

// Update bank details
export async function updateWalletBankDetails(
  walletId: string,
  bankDetails: { bank_name: string; bank_account_number: string; bank_account_name: string; paystack_recipient_code?: string }
) {
  const { data, error } = await supabase
    .from('wallets')
    .update({
      ...bankDetails,
      updated_at: new Date().toISOString(),
    })
    .eq('id', walletId)
    .select()
    .single();
  return { wallet: data as Wallet | null, error };
}

// ═══════════════════════════════════════════════════════════════
// ESCROW
// ═══════════════════════════════════════════════════════════════

export async function createEscrowTransaction(escrow: Omit<EscrowTransaction, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('escrow_transactions')
    .insert(escrow)
    .select()
    .single();
  return { transaction: data as EscrowTransaction | null, error };
}

export async function getEscrowForBooking(bookingId: string) {
  const { data, error } = await supabase
    .from('escrow_transactions')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  return { transaction: data as EscrowTransaction | null, error };
}

// Release escrow to wallet (called when job is completed)
export async function releaseEscrow(escrowId: string, walletId: string) {
  const { data, error } = await supabase.rpc('release_escrow', {
    p_escrow_id: escrowId,
    p_wallet_id: walletId,
  });
  return { result: data, error };
}

// Refund escrow to customer
export async function refundEscrow(escrowId: string, reason?: string) {
  const { data, error } = await supabase.rpc('refund_escrow', {
    p_escrow_id: escrowId,
    p_reason: reason || null,
  });
  return { result: data, error };
}

// ═══════════════════════════════════════════════════════════════
// WITHDRAWALS — Automatic via Paystack
// ═══════════════════════════════════════════════════════════════

export async function requestWithdrawal(walletId: string, amount: number) {
  // Get wallet to check balance and bank details
  const { data: wallet } = await supabase
    .from('wallets')
    .select('*')
    .eq('id', walletId)
    .single();

  if (!wallet) return { withdrawal: null, error: { message: 'Wallet not found' } as any };
  if (wallet.available_balance < amount) return { withdrawal: null, error: { message: 'Insufficient balance' } as any };
  if (!wallet.bank_account_number || !wallet.bank_name) {
    return { withdrawal: null, error: { message: 'Bank details not set up' } as any };
  }

  const { data, error } = await supabase
    .from('withdrawals')
    .insert({
      wallet_id: walletId,
      amount,
      bank_name: wallet.bank_name,
      bank_account_number: wallet.bank_account_number,
      bank_account_name: wallet.bank_account_name,
      status: 'pending',
    })
    .select()
    .single();
  return { withdrawal: data as Withdrawal | null, error };
}

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

// ═══════════════════════════════════════════════════════════════
// WORKER DASHBOARD DATA
// ═══════════════════════════════════════════════════════════════

export async function getWorkerDashboardData(workerId: string) {
  // Get wallet
  const { wallet } = await getOrCreateWallet(workerId, 'worker');

  // Get verification
  const { verification } = await getWorkerVerification(workerId);

  // Get blue badge
  const { subscription: blueBadge } = await getBlueBadgeSubscription(workerId);

  // Get recent transactions
  const transactionsPromise = wallet
    ? getWalletTransactions(wallet.id, 10)
    : Promise.resolve({ transactions: [], error: null });

  // Get pending withdrawals
  const withdrawalsPromise = wallet
    ? getWithdrawals(wallet.id)
    : Promise.resolve({ withdrawals: [], error: null });

  const [{ transactions }, { withdrawals }] = await Promise.all([
    transactionsPromise,
    withdrawalsPromise,
  ]);

  return {
    wallet: wallet || null,
    verification: verification || null,
    blueBadge: blueBadge || null,
    transactions: transactions || [],
    withdrawals: withdrawals || [],
  };
}

// ═══════════════════════════════════════════════════════════════
// CREATOR: STATS
// ═══════════════════════════════════════════════════════════════

export async function getWorkerSystemStats() {
  const { data: workers } = await supabase
    .from('profiles')
    .select('worker_status')
    .eq('role', 'worker');

  const { data: verifications } = await supabase
    .from('worker_verifications')
    .select('status');

  const { data: badges } = await supabase
    .from('blue_badge_subscriptions')
    .select('status');

  const { data: walletsData } = await supabase
    .from('wallets')
    .select('available_balance,owner_type');

  const { data: withdrawalsData } = await supabase
    .from('withdrawals')
    .select('status,amount');

  return {
    workers: {
      total: workers?.length || 0,
      pending: workers?.filter(w => w.worker_status === 'pending').length || 0,
      verified: workers?.filter(w => w.worker_status === 'verified').length || 0,
      suspended: workers?.filter(w => w.worker_status === 'suspended').length || 0,
    },
    verifications: {
      pending: verifications?.filter(v => v.status === 'pending').length || 0,
      under_review: verifications?.filter(v => v.status === 'under_review').length || 0,
      approved: verifications?.filter(v => v.status === 'approved').length || 0,
      rejected: verifications?.filter(v => v.status === 'rejected').length || 0,
    },
    blueBadges: {
      active: badges?.filter(b => b.status === 'active').length || 0,
      total: badges?.length || 0,
    },
    wallets: {
      totalBalance: walletsData?.reduce((sum, w) => sum + (w.available_balance || 0), 0) || 0,
      workerWallets: walletsData?.filter(w => w.owner_type === 'worker').length || 0,
      partnerWallets: walletsData?.filter(w => w.owner_type === 'property_partner').length || 0,
    },
    withdrawals: {
      pending: withdrawalsData?.filter(w => w.status === 'pending').length || 0,
      totalAmount: withdrawalsData?.filter(w => w.status === 'successful').reduce((sum, w) => sum + (w.amount || 0), 0) || 0,
    },
  };
}

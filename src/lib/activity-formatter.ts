// ═══════════════════════════════════════════════════════════════
// Shared Activity Formatter
// 
// audit_logs.admin_id stores auth.uid()::text (Supabase UUID)
// Resolution path: audit_logs.admin_id → profiles.auth_id → username + role
// 
// Used by: CreatorHome (Recent Activity), AnalyticsPage (ActivityTab)
// ═══════════════════════════════════════════════════════════════

// ─── Activity Label Mapper ─────────────────────────────
const ACTIVITY_LABELS: Record<string, string> = {
  commission_apartment: 'Apartment Commission',
  apartment_commission_percent: 'Apartment Commission',
  apartment_reservation_fee: 'Apartment Reservation Fee',
  max_withdrawal: 'Maximum Withdrawal',
  min_withdrawal: 'Minimum Withdrawal',
  late_payment_rules: 'Late Payment Rules',
  grace_period_days: 'Grace Period',
  security_deposit_rules: 'Security Deposit Rules',
  default_security_deposit: 'Security Deposit',
  rent_plans_enabled: 'Rent Plans',
  min_rent_duration: 'Min Rent Duration',
  max_rent_duration: 'Max Rent Duration',
  worker_verification_fee: 'Worker Verification Fee',
  commission_worker: 'Worker Commission',
  worker_verification_video_length: 'Verification Video Length',
  worker_required_documents: 'Required Documents',
  hotel_reservation_fee: 'Hotel Reservation Fee',
  allow_hotel_reservation: 'Hotel Reservations',
  commission_hotel: 'Hotel Commission',
  email_notifications: 'Email Notifications',
  push_notifications: 'Push Notifications',
  maintenance_mode: 'Maintenance Mode',
  registration_open: 'Registration',
  company_name: 'Company Name',
  support_email: 'Support Email',
  support_phone: 'Support Phone',
  support_whatsapp: 'Support WhatsApp',
  support_telegram: 'Support Telegram',
  office_address: 'Office Address',
  cac_number: 'CAC Number',
  privacy_policy: 'Privacy Policy',
  terms_of_service: 'Terms of Service',
  refund_policy: 'Refund Policy',
  refund_policy_text: 'Refund Policy',
  payment_gateway: 'Payment Gateway',
  withdrawal_bank_account: 'Withdrawal Account',
  automatic_paystack_transfer: 'Auto Paystack Transfer',
  transfer_fee: 'Transfer Fee',
  deposit_rules: 'Deposit Rules',
  deposit_is_percentage: 'Deposit Type',
};

// ─── Commission keys: display with % ──────────────────
const COMMISSION_KEYS = ['commission_apartment', 'commission_hotel', 'commission_worker', 'apartment_commission_percent'];

// ─── Currency keys: display with ₦ ────────────────────
const CURRENCY_KEYS = [
  'apartment_reservation_fee', 'hotel_reservation_fee', 'worker_verification_fee',
  'max_withdrawal', 'min_withdrawal', 'default_security_deposit', 'transfer_fee',
];

// ─── Boolean keys ─────────────────────────────────────
const BOOLEAN_KEYS = [
  'rent_plans_enabled', 'allow_hotel_reservation', 'email_notifications',
  'push_notifications', 'maintenance_mode', 'registration_open',
  'automatic_paystack_transfer', 'deposit_is_percentage',
];

// ─── Role labels ──────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  creator: 'Creator',
  creator_admin: 'Creator Admin',
  admin: 'Admin',
  staff: 'Staff',
  worker: 'Worker',
  property_partner: 'Property Partner',
  user: 'User',
};

export function getRoleLabel(role: string): string {
  return ROLE_LABELS[role] || role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' ');
}

export function getActivityLabel(targetId: string): string {
  return ACTIVITY_LABELS[targetId] || targetId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getActionVerb(action: string): string {
  if (action === 'UPDATE' || action === 'ROLE_CHANGE') return 'changed';
  if (action === 'INSERT') return 'created';
  if (action === 'DELETE') return 'removed';
  if (action === 'BAN') return 'banned';
  if (action === 'SUSPEND') return 'suspended';
  if (action === 'REACTIVATE') return 'reactivated';
  if (action === 'APPROVE') return 'approved';
  if (action === 'REJECT') return 'rejected';
  return action.toLowerCase();
}

// ─── Format a value based on its key ──────────────────
function formatValue(value: string, key: string): string {
  if (COMMISSION_KEYS.includes(key)) return `${value}%`;
  if (CURRENCY_KEYS.includes(key)) return `₦${Number(value).toLocaleString()}`;
  if (BOOLEAN_KEYS.includes(key)) {
    return value === 'true' || value === '1' ? 'Enabled' : 'Disabled';
  }
  return value;
}

export function parseAuditDetails(details: string | null, key?: string): { oldValue?: string; newValue?: string } {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    const oldVal = parsed?.old_value?.value;
    const newVal = parsed?.new_value?.value;
    const targetKey = key || parsed?.new_value?.key || parsed?.old_value?.key || '';
    return {
      oldValue: oldVal !== undefined ? formatValue(String(oldVal), targetKey) : undefined,
      newValue: newVal !== undefined ? formatValue(String(newVal), targetKey) : undefined,
    };
  } catch {
    return {};
  }
}

// ─── Main formatter ───────────────────────────────────
export function formatActivityItem(item: any): {
  title: string;
  subtitle: string | null;
  meta: string;
} {
  const label = getActivityLabel(item.target_id || '');
  const verb = getActionVerb(item.action);
  const key = item.target_id || '';
  const { oldValue, newValue } = parseAuditDetails(item.details, key);
  const changed = oldValue !== undefined && newValue !== undefined && oldValue !== newValue;

  const title = `${label} ${verb}`;
  const subtitle = changed ? `${oldValue} → ${newValue}` : null;

  // Resolve actor identity
  let who: string;
  if (!item.admin_id) {
    who = 'WeHouse System';
  } else if (item.profiles?.username) {
    const roleLabel = getRoleLabel(item.profiles.role || '');
    who = `@${item.profiles.username} · ${roleLabel}`;
  } else {
    who = 'Unknown account';
  }

  const date = new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = new Date(item.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const meta = `${who} · ${date}, ${time}`;

  return { title, subtitle, meta };
}

// ─── Query shape for Supabase join ────────────────────
// Use this in both CreatorHome and AnalyticsPage:
// .select(`
//   action, target_type, target_id, details, admin_id, created_at,
//   profiles:admin_id (username, role)
// `)

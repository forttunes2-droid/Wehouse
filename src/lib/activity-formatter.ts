const ACTIVITY_LABELS: Record<string, string> = {
  commission_apartment: 'Apartment Commission',
  apartment_reservation_fee: 'Apartment Reservation Fee',
  max_withdrawal: 'Maximum Withdrawal',
  min_withdrawal: 'Minimum Withdrawal',
  late_payment_rules: 'Late Payment Rules',
  grace_period_days: 'Grace Period',
  security_deposit_rules: 'Security Deposit Rules',
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
  default_security_deposit: 'Security Deposit',
  payment_gateway: 'Payment Gateway',
  withdrawal_bank_account: 'Withdrawal Account',
  automatic_paystack_transfer: 'Auto Paystack Transfer',
  transfer_fee: 'Transfer Fee',
  refund_policy_text: 'Refund Policy Text',
  deposit_rules: 'Deposit Rules',
  deposit_is_percentage: 'Deposit Type',
  apartment_commission_percent: 'Apartment Commission',
};

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

export function parseAuditDetails(details: string | null): { oldValue?: string; newValue?: string } {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    const oldVal = parsed?.old_value?.value;
    const newVal = parsed?.new_value?.value;
    return {
      oldValue: oldVal !== undefined ? String(oldVal) : undefined,
      newValue: newVal !== undefined ? String(newVal) : undefined,
    };
  } catch {
    return {};
  }
}

export function formatActivityItem(item: any): {
  title: string;
  subtitle: string | null;
  meta: string;
} {
  const label = getActivityLabel(item.target_id || '');
  const verb = getActionVerb(item.action);
  const { oldValue, newValue } = parseAuditDetails(item.details);
  const changed = oldValue !== undefined && newValue !== undefined && oldValue !== newValue;

  const title = `${label} ${verb}`;
  const subtitle = changed ? `${oldValue} → ${newValue}` : null;

  const who = item.profiles?.username
    ? item.profiles.username
    : item.admin_id
      ? 'Admin'
      : 'System';

  const date = new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = new Date(item.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const meta = `${who} · ${date} · ${time}`;

  return { title, subtitle, meta };
}

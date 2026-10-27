import type { PaymentReceipt } from './supabase/receipts';

const settled = new Set(['paid', 'completed', 'refunded', 'partially_refunded']);
const invalid = () => new Error('The payment receipt could not be confirmed. Please try again.');

/** Unknown or pending payments must never become a Paid receipt. */
export function assertPaymentReceipt(value: unknown): asserts value is PaymentReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const row = value as Record<string, unknown>;
  if (['id', 'reference', 'purpose', 'payer_name', 'merchant_name', 'description'].some(key =>
    typeof row[key] !== 'string' || !(row[key] as string).trim()) ||
    typeof row.status !== 'string' || !settled.has(row.status) ||
    typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0 ||
    typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency) ||
    typeof row.paid_at !== 'string' || !Number.isFinite(Date.parse(row.paid_at)) ||
    ![null, 'test', 'live'].includes(row.environment as string | null)) throw invalid();
  for (const key of ['stay_amount', 'deposit_amount', 'nights', 'guests']) {
    const amount = row[key];
    if (amount != null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) throw invalid();
  }
  if(row.booking_type==='experience'){
    if(!Number.isInteger(row.participants)||Number(row.participants)<1||Number(row.participants)>100||typeof row.session_timezone!=='string'||
      typeof row.session_starts_at!=='string'||!Number.isFinite(Date.parse(row.session_starts_at))||typeof row.session_ends_at!=='string'||Date.parse(row.session_ends_at)<=Date.parse(row.session_starts_at)||!Number.isFinite(Date.parse(row.session_ends_at)))throw invalid();
    try{new Intl.DateTimeFormat(undefined,{timeZone:row.session_timezone});}catch{throw invalid();}
  }
  if (row.cancellation_snapshot != null) {
    const terms = row.cancellation_snapshot as Record<string, unknown>;
    if (typeof terms !== 'object' || Array.isArray(terms) ||
      typeof terms.refundable !== 'boolean' || typeof terms.timezone !== 'string' ||
      typeof terms.refund_amount_ngn !== 'number' || !Number.isFinite(terms.refund_amount_ngn) || terms.refund_amount_ngn < 0 ||
      (terms.deadline !== null && (typeof terms.deadline !== 'string' || !Number.isFinite(Date.parse(terms.deadline))))) throw invalid();
    try { new Intl.DateTimeFormat(undefined, { timeZone: terms.timezone }); } catch { throw invalid(); }
  }
}

export function paymentReceiptStatus(status: string) {
  if (status === 'refunded') return { label: 'Refunded', refunded: true };
  if (status === 'partially_refunded') return { label: 'Partial refund', refunded: true };
  if (status === 'paid' || status === 'completed') return { label: 'Paid', refunded: false };
  return { label: 'Status unavailable', refunded: false };
}

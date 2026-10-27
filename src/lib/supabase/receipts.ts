import { withTimeout } from "@/lib/withTimeout";
import { supabase } from "./client";
import { assertPaymentReceipt } from '../paymentReceiptContract';

export type PaymentReceipt = {
  id: string; reference: string; purpose: string; amount: number; currency: string;
  paid_at: string; status: string; refund_processed_at?: string | null;
  environment: "test" | "live" | null; payer_name: string; merchant_name: string;
  description: string; package_name?: string | null; booking_id?: string | null;
  booking_type?: "hotel" | "service" | "housing" | "experience" | null;
  session_starts_at?: string | null; session_ends_at?: string | null; session_timezone?: string | null; participants?: number | null;
  check_in?: string | null; check_out?: string | null; nights?: number | null;
  cancellation_snapshot?: {refundable:boolean;deadline:string|null;timezone:string;refund_amount_ngn:number} | null;
  guests?: number | null; stay_amount?: number | null; deposit_amount?: number | null;
};

export async function getPaymentReceipts(reference?: string, subjectType?: string, subjectId?: string) {
  const { data, error } = await withTimeout(supabase.rpc("get_my_payment_receipts", {
    p_reference: reference || null, p_subject_type: subjectType || null, p_subject_id: subjectId || null,
  }), 15000, "Receipts took too long to load. Please try again.");
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Receipts could not be loaded. Please try again.');
  data.forEach(assertPaymentReceipt);
  if (reference && data.some(row => row.reference !== reference)) {
    throw new Error('The receipt does not match this payment reference. Please try again.');
  }
  return data as PaymentReceipt[];
}

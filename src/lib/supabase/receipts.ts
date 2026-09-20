import { withTimeout } from "@/lib/withTimeout";
import { supabase } from "./client";

export type PaymentReceipt = {
  id: string; reference: string; purpose: string; amount: number; currency: string;
  paid_at: string; status: string; refund_processed_at?: string | null;
  environment: "test" | "live" | null; payer_name: string; merchant_name: string;
  description: string; package_name?: string | null; booking_id?: string | null;
  booking_type?: "hotel" | "service" | "housing" | null;
  check_in?: string | null; check_out?: string | null; nights?: number | null;
  guests?: number | null; stay_amount?: number | null; deposit_amount?: number | null;
};

export async function getPaymentReceipts(reference?: string, subjectType?: string, subjectId?: string) {
  const { data, error } = await withTimeout(supabase.rpc("get_my_payment_receipts", {
    p_reference: reference || null, p_subject_type: subjectType || null, p_subject_id: subjectId || null,
  }), 15000, "Receipts took too long to load. Please try again.");
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as PaymentReceipt[];
}

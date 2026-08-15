import { supabase } from './client';

export async function initializeApartmentRentPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_apartment_rent_payment', {
    p_reservation_id: reservationId,
  });
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid) return { result: bootstrap, error: null };

  const reference = String(bootstrap.reference || '');
  if (!reference) return { result: { success: false, error: 'Rent payment reference is missing' }, error: null };

  const { data, error } = await supabase.functions.invoke('payment-init', {
    body: { reference },
  });
  return {
    result: data as {
      success?: boolean;
      already_paid?: boolean;
      reference?: string;
      purpose?: string;
      authorization_url?: string;
      access_code?: string;
      existing?: boolean;
      error?: string;
    } | null,
    error,
  };
}

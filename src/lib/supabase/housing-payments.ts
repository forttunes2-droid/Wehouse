import { supabase } from './client';

type PaymentInitResult = {
  success?: boolean;
  already_paid?: boolean;
  reference?: string;
  purpose?: string;
  authorization_url?: string;
  access_code?: string;
  existing?: boolean;
  error?: string;
};

async function initializePaymentReference(reference: string) {
  const { data, error } = await supabase.functions.invoke('payment-init', {
    body: { reference },
  });
  return { result: data as PaymentInitResult | null, error };
}

export async function initializeApartmentRentPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_apartment_rent_payment', {
    p_reservation_id: reservationId,
  });
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid) return { result: bootstrap as PaymentInitResult, error: null };

  const reference = String(bootstrap.reference || '');
  if (!reference) return { result: { success: false, error: 'Rent payment reference is missing' }, error: null };
  return initializePaymentReference(reference);
}

export async function getRentPlanForReservation(reservationId: string) {
  const { data: plan, error: planError } = await supabase
    .from('rent_plans')
    .select('*')
    .eq('reservation_id', reservationId)
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError || !plan) return { plan: plan || null, contributions: [] as any[], error: planError };

  const { data: contributions, error: contributionError } = await supabase
    .from('rent_plan_contributions')
    .select('*')
    .eq('rent_plan_id', plan.id)
    .order('target_year', { ascending: true })
    .order('installment_number', { ascending: true });

  return {
    plan,
    contributions: contributions || [],
    error: contributionError,
  };
}

export async function initializeRentContributionPayment(contributionId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_rent_plan_contribution_payment', {
    p_contribution_id: contributionId,
  });
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid) return { result: bootstrap as PaymentInitResult, error: null };

  const reference = String(bootstrap.reference || '');
  if (!reference) return { result: { success: false, error: 'Contribution payment reference is missing' }, error: null };
  return initializePaymentReference(reference);
}

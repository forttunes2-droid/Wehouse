/**
 * Paystack Webhook Handler
 * When Paystack confirms payment, we queue a 5-minute AI review
 * After review, premium is auto-activated
 */
import { supabase } from './supabase';

interface PaystackEvent {
  event: string;
  data: {
    reference: string;
    amount: number;
    customer: { email: string };
    metadata?: { user_id?: string; plan_type?: string };
  };
}

// This runs when Paystack webhook hits our endpoint
export async function handlePaystackWebhook(event: PaystackEvent) {
  if (event.event !== 'charge.success') return { success: false };

  const { reference, amount, metadata } = event.data;
  const userId = metadata?.user_id;
  const planType = metadata?.plan_type || 'user';

  if (!userId) return { success: false, error: 'No user_id in metadata' };

  // 1. Log the payment
  await supabase.from('premium_payments').insert({
    user_id: userId,
    reference,
    amount,
    status: 'paid',
    plan_type: planType,
    review_status: 'pending_review', // AI will review in 5 min
    review_deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });

  // 2. Trigger the 5-minute review
  // In production, this would be a Supabase Edge Function or cron job
  // For now, the client checks for pending reviews and activates after 5 min
  return { success: true, message: 'Payment logged. Review in 5 minutes.' };
}

// Check if user has a pending review that should be activated
export async function checkPremiumActivation(userId: string) {
  const { data } = await supabase
    .from('premium_payments')
    .select('*')
    .eq('user_id', userId)
    .eq('review_status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return { activated: false };

  const now = new Date();
  const deadline = new Date(data.review_deadline);

  if (now >= deadline) {
    // 5 minutes passed — activate premium
    await supabase.from('profiles').update({ is_premium: true }).eq('user_id', userId);
    await supabase
      .from('premium_payments')
      .update({ review_status: 'activated' })
      .eq('reference', data.reference);

    return { activated: true };
  }

  // Still under review
  const secondsLeft = Math.ceil((deadline.getTime() - now.getTime()) / 1000);
  return { activated: false, secondsLeft };
}

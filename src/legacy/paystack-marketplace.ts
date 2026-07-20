import { supabase } from '@/lib/supabase';

/**
 * PAYSTACK MARKETPLACE PAYMENT UTILITIES
 * 
 * How the split works:
 * 1. Booking amount = ₦20,000
 * 2. Commission rate = 10% (from Settings, not hardcoded)
 * 3. Commission = ₦2,000 (goes to WeHouse master account)
 * 4. Worker gets = ₦18,000 (via their Paystack subaccount)
 * 
 * Paystack config:
 * - subaccount: Worker's Paystack subaccount code
 * - transaction_charge: Commission amount in kobo
 * - bearer: "subaccount" (worker bears the charge)
 * 
 * This means:
 * - Customer pays ₦20,000
 * - ₦2,000 commission goes to WeHouse
 * - ₦18,000 settles to worker's bank account
 */

interface PaystackConfig {
  publicKey: string;
  testMode: boolean;
  commissionBearer: 'subaccount' | 'account';
}

interface PaymentInit {
  email: string;
  amount: number; // in naira
  reference: string;
  workerUserId: string;
  workerName: string;
  bookingType: 'worker' | 'partner' | 'hotel';
  bookingId: string;
  metadata?: Record<string, any>;
  onSuccess?: (reference: string) => void;
  onCancel?: () => void;
}

// Load Paystack config from platform settings (no hardcoding)
async function loadConfig(): Promise<PaystackConfig> {
  const { data: pk } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_public_key' });
  const { data: tm } = await supabase.rpc('get_setting_v2', { p_key: 'payment_test_mode' });
  const { data: cb } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_commission_bearer' });
  
  return {
    publicKey: pk || '',
    testMode: tm === 'true',
    commissionBearer: (cb === 'account' ? 'account' : 'subaccount') as 'subaccount' | 'account',
  };
}

// Generate a unique payment reference
export function generatePaymentReference(): string {
  return `WH_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

// Create booking payment record in DB (before Paystack init)
export async function createPaymentRecord(init: PaymentInit): Promise<{
  success: boolean;
  paymentData?: {
    reference: string;
    amountKobo: number;
    commissionKobo: number;
    subaccountCode: string | null;
    publicKey: string;
  };
  error?: string;
}> {
  try {
    // 1. Load Paystack config from settings
    const config = await loadConfig();
    if (!config.publicKey) {
      return { success: false, error: 'Paystack not configured. Add your public key in Settings > Payment.' };
    }

    // 2. Create payment record in database
    const reference = init.reference || generatePaymentReference();
    const { data: paymentResult, error: dbError } = await supabase.rpc('create_booking_payment', {
      p_booking_id: init.bookingId,
      p_booking_type: init.bookingType,
      p_payer_user_id: init.email, // We'll use the actual user_id from auth
      p_payee_user_id: init.workerUserId,
      p_amount_total: init.amount,
      p_paystack_reference: reference,
    });

    if (dbError) {
      console.error('[Paystack] create_booking_payment error:', dbError);
      return { success: false, error: 'Failed to create payment record' };
    }

    const result = typeof paymentResult === 'string' ? JSON.parse(paymentResult) : paymentResult;
    
    // 3. Return data for Paystack initialization
    const amountKobo = Math.round(init.amount * 100);
    const commissionKobo = Math.round((result.commission_rate || 10) * init.amount);

    return {
      success: true,
      paymentData: {
        reference,
        amountKobo,
        commissionKobo,
        subaccountCode: result.subaccount_code,
        publicKey: config.publicKey,
      },
    };
  } catch (e: any) {
    console.error('[Paystack] createPaymentRecord error:', e);
    return { success: false, error: e.message || 'Unknown error' };
  }
}

// Initialize Paystack popup with marketplace split
export function initializePaystackPopup(
  config: {
    publicKey: string;
    email: string;
    amountKobo: number;
    reference: string;
    subaccountCode?: string | null;
    commissionKobo?: number;
    bearer?: 'subaccount' | 'account';
    metadata?: Record<string, any>;
    onSuccess?: (reference: string) => void;
    onCancel?: () => void;
  }
): void {
  // @ts-ignore — Paystack is loaded from CDN script
  const handler = window.PaystackPop || window.PaystackEmbed;
  
  if (!handler) {
    // Load Paystack script dynamically
    loadPaystackScript().then(() => {
      openPaystackPopup(config);
    }).catch(() => {
      alert('Failed to load Paystack. Please try again.');
    });
    return;
  }
  
  openPaystackPopup(config);
}

function openPaystackPopup(config: any): void {
  // Build Paystack config
  const paystackConfig: any = {
    key: config.publicKey,
    email: config.email,
    amount: config.amountKobo,
    ref: config.reference,
    currency: 'NGN',
    metadata: {
      custom_fields: [
        { display_name: 'Booking Reference', variable_name: 'booking_ref', value: config.reference },
        ...(config.metadata ? Object.entries(config.metadata).map(([k, v]) => ({
          display_name: k,
          variable_name: k,
          value: String(v),
        })) : []),
      ],
    },
    callback: (response: any) => {
      console.log('[Paystack] Payment callback:', response.reference);
      // Verify payment on backend
      verifyPaymentOnFrontend(response.reference).then(() => {
        config.onSuccess?.(response.reference);
      });
    },
    onClose: () => {
      console.log('[Paystack] Payment cancelled');
      config.onCancel?.();
    },
  };

  // Add subaccount split if available
  if (config.subaccountCode) {
    paystackConfig.subaccount = config.subaccountCode;
    
    // Add transaction charge (commission) if available
    if (config.commissionKobo && config.commissionKobo > 0) {
      paystackConfig.transaction_charge = config.commissionKobo;
    }
    
    // Set bearer (who pays the commission)
    paystackConfig.bearer = config.bearer || 'subaccount';
  }

  // @ts-ignore
  const popup = new window.PaystackPop();
  popup.newTransaction(paystackConfig);
}

// Load Paystack inline script
function loadPaystackScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('paystack-script')) { resolve(); return; }
    const script = document.createElement('script');
    script.id = 'paystack-script';
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.onload = () => resolve();
    script.onerror = () => reject();
    document.head.appendChild(script);
  });
}

// Verify payment from frontend (backup to webhook)
async function verifyPaymentOnFrontend(reference: string): Promise<boolean> {
  try {
    // Call the database confirm function
    const { data, error } = await supabase.rpc('confirm_booking_payment', {
      p_reference: reference,
    });
    
    if (error) {
      console.error('[Paystack] Frontend verify error:', error);
      return false;
    }
    
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    console.log('[Paystack] Frontend verify result:', result);
    return result?.success === true;
  } catch (e) {
    console.error('[Paystack] Frontend verify exception:', e);
    return false;
  }
}

// Full marketplace payment flow
export async function initiateMarketplacePayment(init: PaymentInit): Promise<{
  success: boolean;
  reference?: string;
  error?: string;
}> {
  // Step 1: Create payment record
  const { success, paymentData, error } = await createPaymentRecord(init);
  if (!success || !paymentData) {
    return { success: false, error: error || 'Failed to initialize' };
  }

  // Step 2: Open Paystack popup with split
  initializePaystackPopup({
    publicKey: paymentData.publicKey,
    email: init.email,
    amountKobo: paymentData.amountKobo,
    reference: paymentData.reference,
    subaccountCode: paymentData.subaccountCode,
    commissionKobo: paymentData.commissionKobo,
    metadata: {
      worker_name: init.workerName,
      booking_type: init.bookingType,
      booking_id: init.bookingId,
      ...init.metadata,
    },
    onSuccess: init.onSuccess,
    onCancel: init.onCancel,
  });

  return { success: true, reference: paymentData.reference };
}

// Get commission summary for Creator dashboard
export async function getCommissionSummary(period?: 'today' | 'week' | 'month') {
  let startDate: string | null = null;
  const now = new Date();
  
  if (period === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  } else if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    startDate = d.toISOString();
  } else if (period === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    startDate = d.toISOString();
  }
  
  const { data, error } = await supabase.rpc('get_commission_summary', {
    p_start_date: startDate,
    p_end_date: null,
  });
  
  if (error) {
    console.error('[Commission] Summary error:', error);
    return { total_collected: 0, total_settled: 0, total_pending: 0, total_payments: 0 };
  }
  
  return typeof data === 'string' ? JSON.parse(data) : data;
}

import { supabase } from './client';

// ═══════════════════════════════════════════════════════════════
// CANONICAL PAYSTACK INITIALIZATION
// (Moved from src/legacy/paystack-marketplace.ts)
// ═══════════════════════════════════════════════════════════════

interface PaystackPopupConfig {
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
  onError?: (message: string) => void;
}

export function initializePaystackPopup(config: PaystackPopupConfig): void {
  // @ts-ignore — Paystack is loaded from CDN script
  const handler = window.PaystackPop || window.PaystackEmbed;

  if (!handler) {
    loadPaystackScript().then(() => {
      openPaystackPopup(config);
    }).catch(() => {
      config.onError?.('Failed to load Paystack. Please try again.');
    });
    return;
  }

  openPaystackPopup(config);
}

function openPaystackPopup(config: PaystackPopupConfig): void {
  const paystackConfig: any = {
    key: config.publicKey,
    email: config.email,
    amount: config.amountKobo,
    reference: config.reference,
    currency: 'NGN',
    metadata: {
      custom_fields: [
        { display_name: 'Reference', variable_name: 'reference', value: config.reference },
        ...(config.metadata ? Object.entries(config.metadata).map(([k, v]) => ({
          display_name: k,
          variable_name: k,
          value: String(v),
        })) : []),
      ],
    },
    onSuccess: (transaction: any) => {
      config.onSuccess?.(transaction?.reference || config.reference);
    },
    onCancel: () => {
      config.onCancel?.();
    },
    onError: (error: any) => {
      config.onError?.(error?.message || 'Paystack could not start this payment.');
    },
  };

  if (config.subaccountCode) {
    paystackConfig.subaccount = config.subaccountCode;
    if (config.commissionKobo && config.commissionKobo > 0) {
      paystackConfig.transaction_charge = config.commissionKobo;
    }
    if (config.bearer) {
      paystackConfig.bearer = config.bearer;
    }
  }

  // @ts-ignore
  const popup = new window.PaystackPop();
  popup.newTransaction(paystackConfig);
}

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

// ═══════════════════════════════════════════════════════════════
// COMMISSION SUMMARY
// ═══════════════════════════════════════════════════════════════

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
    return { total_collected: 0, total_settled: 0, total_pending: 0, total_payments: 0 };
  }

  return typeof data === 'string' ? JSON.parse(data) : data;
}

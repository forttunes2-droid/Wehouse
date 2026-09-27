import { hasLiveSession, hasActiveWorkspace } from "../_shared/liveSession.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  try {
    const authHeader = req.headers.get('authorization');
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!authHeader) return json({ success: false, error: 'Authorization required' }, 401);
    if (!url || !anonKey || !serviceKey || !paystackSecret) {
      return json({ success: false, error: 'Subscription server configuration is incomplete' }, 503);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: 'Invalid or expired session' }, 401);
    if (!await hasLiveSession(admin, user.id, token)) return json({success:false,error:'Session ended. Sign in again.'},401);
    const { data: creator } = await admin.from('profiles').select('user_id,role,deleted,suspended,banned')
      .eq('auth_id', user.id).maybeSingle();
    if (!creator || !await hasActiveWorkspace(admin,creator.user_id,'creator') || creator.deleted || creator.suspended || creator.banned) {
      return json({ success: false, error: 'Creator access required' }, 403);
    }

    const requestBody = await req.json().catch(() => ({}));
    const billingPeriod = String(requestBody?.billing_period || 'monthly').toLowerCase();
    if (!['monthly', 'yearly'].includes(billingPeriod)) {
      return json({ success: false, error: 'Choose monthly or yearly billing' }, 400);
    }
    const isYearly = billingPeriod === 'yearly';
    const priceKey = isYearly ? 'worker_pro_yearly_price_ngn' : 'worker_pro_monthly_price_ngn';
    const planCodeKey = isYearly
      ? 'worker_pro_web_paystack_yearly_plan_code'
      : 'worker_pro_web_paystack_plan_code';
    const paystackInterval = isYearly ? 'annually' : 'monthly';

    const { data: settings, error: settingsError } = await admin.from('platform_settings')
      .select('key,value').in('key', [priceKey, planCodeKey, 'worker_pro_product_name']);
    if (settingsError) return json({ success: false, error: settingsError.message }, 500);
    const values = new Map((settings || []).map((setting) => [setting.key, String(setting.value || '')]));
    const price = Number(values.get(priceKey) || 0);
    const existingCode = values.get(planCodeKey) || '';
    const productName = (values.get('worker_pro_product_name') || 'WeHouse Works').trim().slice(0, 40) || 'WeHouse Works';
    if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
      return json({ success: false, error: `Set a valid ${billingPeriod} price before syncing Paystack` }, 409);
    }

    const body = {
      name: `${productName} ${isYearly ? 'Yearly' : 'Monthly'}`,
      amount: Math.round(price * 100),
      interval: paystackInterval,
      currency: 'NGN',
      description: `Optional ${billingPeriod} business tools for WeHouse Workers`,
      update_existing_subscriptions: false,
    };
    const endpoint = existingCode
      ? `https://api.paystack.co/plan/${encodeURIComponent(existingCode)}`
      : 'https://api.paystack.co/plan';
    const response = await fetch(endpoint, {
      method: existingCode ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${paystackSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.status) {
      return json({ success: false, error: payload?.message || 'Paystack plan could not be synchronized' }, 502);
    }
    const code = String(payload?.data?.plan_code || existingCode || '');
    if (!/^PLN_[A-Za-z0-9]+$/.test(code)) return json({ success: false, error: 'Paystack returned an invalid plan code' }, 502);

    const verifyResponse = await fetch(`https://api.paystack.co/plan/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const verifyPayload = await verifyResponse.json().catch(() => null);
    const plan = verifyPayload?.data;
    if (!verifyResponse.ok || !verifyPayload?.status || !plan
      || String(plan.interval || '').toLowerCase() !== paystackInterval
      || String(plan.currency || 'NGN').toUpperCase() !== 'NGN'
      || Math.round(Number(plan.amount || 0)) !== Math.round(price * 100)) {
      return json({ success: false, error: `Paystack did not confirm the requested ${billingPeriod} price` }, 502);
    }

    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const saved = await userClient.rpc('creator_set_worker_pro_setting', {
      p_key: planCodeKey,
      p_value: code,
    });
    if (saved.error) return json({ success: false, error: 'Plan was synced but its code could not be recorded safely' }, 500);
    return json({
      success: true,
      billing_period: billingPeriod,
      plan_code: code,
      price_ngn: price,
      existing_plan: Boolean(existingCode),
    });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'Paystack plan sync failed' }, 500);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: cors });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return new Response(JSON.stringify({ success: false, error: 'Authorization required' }), { status: 401, headers: cors });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return new Response(JSON.stringify({ success: false, error: 'Server configuration incomplete' }), { status: 500, headers: cors });

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), { status: 401, headers: cors });

    const { data: profile } = await admin.from('profiles').select('user_id, role, deleted, suspended, banned').eq('auth_id', user.id).maybeSingle();
    if (!profile || profile.deleted || profile.suspended || profile.banned || !['staff', 'admin', 'creator'].includes(profile.role)) {
      return new Response(JSON.stringify({ success: false, error: 'Authorized WeHouse staff required' }), { status: 403, headers: cors });
    }

    const body = await req.json();
    const action = String(body?.action || '');
    const paymentId = String(body?.payment_id || '');
    if (!paymentId) return new Response(JSON.stringify({ success: false, error: 'payment_id is required' }), { status: 400, headers: cors });

    let rpc = '';
    const args: Record<string, unknown> = { p_payment_id: paymentId };
    if (action === 'release') {
      rpc = 'release_property_partner_earning';
      args.p_release_event = String(body?.release_event || '');
    } else if (action === 'hold') {
      rpc = 'hold_property_partner_earning';
      args.p_reason = String(body?.reason || '');
    } else if (action === 'reverse_pending') {
      rpc = 'reverse_pending_property_partner_earning';
      args.p_reason = String(body?.reason || '');
    } else {
      return new Response(JSON.stringify({ success: false, error: 'Unsupported action' }), { status: 400, headers: cors });
    }

    const caller = createClient(url, serviceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await caller.rpc(rpc, args);
    if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 400, headers: cors });
    return new Response(JSON.stringify({ success: true, result: data }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Internal error' }), { status: 500, headers: cors });
  }
});
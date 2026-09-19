import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors';

const headers = {
  ...corsHeaders,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

// Retired legacy endpoint. It previously issued relay credentials to any
// authenticated account without proving participation in a specific call.
// All private calls must use private-call-ice, which binds temporary TURN
// credentials to the caller/callee of one active ringing/accepted call.
Deno.serve((request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: 'Legacy TURN credential endpoint retired',
      replacement: 'private-call-ice',
    }),
    { status: 410, headers },
  );
});

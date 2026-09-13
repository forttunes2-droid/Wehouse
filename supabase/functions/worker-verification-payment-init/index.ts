import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });

  return new Response(
    JSON.stringify({
      success: false,
      fee_waived: true,
      retired: true,
      error: "Worker registration, professional evidence submission and WeHouse review are free. No verification payment can be initialized.",
    }),
    { status: 410, headers },
  );
});

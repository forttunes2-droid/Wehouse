import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() =>
  new Response(
    JSON.stringify({
      success: false,
      retired: true,
      error: 'Government/external identity verification is no longer used by WeHouse. Use the WeHouse professional verification flow instead.',
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  ),
);

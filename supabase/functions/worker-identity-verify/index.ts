import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() =>
  new Response(
    JSON.stringify({
      success: false,
      retired: true,
      error: 'This retired endpoint cannot verify identity. Government ID verification is not connected. Use the current WeHouse provider verification flow; do not send identity documents to this endpoint.',
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

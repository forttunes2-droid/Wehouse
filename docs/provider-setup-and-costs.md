# WeHouse existing provider setup and launch costs

Verified 2026-09-19. These are starting USD list prices, not an invoice or a capacity
promise. No subscription was purchased by this change.

## Existing configuration

- Vercel team is already Pro.
- Supabase organization is Free with separate production and Test projects.
- Production Google sign-in is enabled. This is an existing Google Cloud setup.
- Production has `PAYSTACK_SECRET_KEY`; the owner identifies the configured
  account as Paystack Test. Secret values were not exposed or reclassified by name.
- Production Cloudflare secrets exist as `Cloud_turntokenid` and
  `Cloud_turnApitoken`. `private-call-ice` now recognizes these existing names,
  preferring `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` when supplied.
  No permanent credential is sent to the browser. This wiring fix still needs a
  real two-device call test.
- Leaked-password protection is off and the dashboard says Pro or above is required.
- Test provider credentials and OAuth callbacks require separate configuration;
  production configuration is not evidence of a functioning Test environment.
- Live charges, transfers and manual payouts stay deferred until legal readiness.

## Starting monthly cost

| Item | USD/month |
| --- | ---: |
| Supabase Pro, including one Micro project after compute credit | 25 |
| Second active Micro project for Test | 10 |
| Production authentication custom domain | 10 |
| Supabase subtotal with both projects and branded auth | **45** |
| Vercel Pro, one developer seat baseline; already on Pro | 20 |
| Combined baseline | **65** |

Without the auth custom domain, the combined baseline is $55. The new Supabase
subscription would be $35, or $45 with the domain. Tax, additional seats, usage,
domain renewal, payment fees and other provider charges are extra. Confirm the
upgrade checkout estimate before purchasing; larger database compute costs more.

Sources: [Supabase pricing](https://supabase.com/pricing),
[Vercel pricing](https://vercel.com/pricing),
[password protection](https://supabase.com/docs/guides/auth/password-security).
Cloudflare standalone TURN costs $0.05 per outbound real-time GB; actual call
charges depend on relayed traffic, not registered account count. See
[Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/).

## Show WeHouse in the Google sign-in experience

Two settings matter: Google app branding and the authentication callback domain.
The proposed production domain is `auth.wehouse.com.ng`. Merely changing the
website button or the Supabase project name does not replace the callback domain.

1. Upgrade Supabase with the reviewed budget and enable leaked-password protection.
   Verify the saved setting and test rejection of a known compromised fixture
   password on Test, without logging or retaining any real password.
2. Use the existing Google Cloud OAuth app. Set the application display name to
   WeHouse and use the actual WeHouse logo and verified website/support details.
   Complete any Google branding/domain verification required by the console.
3. Before activating the Supabase custom domain, retain the existing Google redirect
   `https://rkrhnkhppeihvmuwvsvn.supabase.co/auth/v1/callback` and add
   `https://auth.wehouse.com.ng/auth/v1/callback` to the existing OAuth client.
4. Configure DNS and certificate verification using the records returned by
   Supabase. Do not invent DNS values or activate before Google accepts both URLs.
5. Activate the custom domain, then test production Google login, cancellation,
   signup verification, new-device verification and password recovery.
   Keep the existing backend URL until custom-domain compatibility across Auth and
   Storage is verified; do not blindly replace every Supabase URL in source.

[Supabase custom-domain sequence](https://supabase.com/docs/guides/platform/custom-domains)
and [Google provider branding](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Growth target

Keep the existing stack and measure realistic workloads before changing platforms.
Registered accounts, monthly active users and simultaneous users are different
capacity targets. The $65 baseline is a starting configuration, not a million-user
capacity guarantee. For illustration, 1,000,000 monthly active Auth users at current
Supabase list pricing would add $2,925 in Auth overage alone above the 100,000
included; database compute, traffic and media are additional. Expand in measured
stages using query latency, errors, concurrent requests, media traffic and a
successful backup restoration test as release evidence.

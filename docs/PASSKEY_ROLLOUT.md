# WeHouse passkey rollout

## Current status

The web client now contains an **optional, disabled-by-default** passkey sign-in and Account → Access & security enrollment/removal flow. It uses Supabase Auth's experimental JavaScript passkey API. The installed `@supabase/supabase-js` version meets the documented minimum, but the feature stays hidden unless `VITE_PASSKEYS_ENABLED=true` is explicitly set for that web deployment.

This code change does not enable passkeys in a hosted Supabase project. Do not set the Vercel flag until the matching Supabase Auth project's passkey configuration has been checked and tested. Keep email and existing social sign-in available as recovery choices.

## Before enabling the Test web project

1. In that Supabase project's Authentication → Passkeys settings, enable passkeys and configure the WeHouse display name, relying-party ID, and exact HTTPS origin(s).
2. Use the stable WeHouse domain as the relying-party ID (for example `wehouse.com.ng`) and only origins whose hostnames belong to that domain. Do not use a one-off Vercel preview hostname as the relying-party ID.
3. Treat the relying-party ID as permanent. Supabase documents that changing it invalidates passkeys enrolled under the previous ID.
4. Set `VITE_PASSKEYS_ENABLED=true` only on the matching Test web deployment. Keep it unset/false in production until Test has passed.
5. Test a verified existing account: add a passkey, sign out, sign in with it, test cancellation/unavailable browser behavior, verify new-device confirmation still runs, remove a lost passkey, and sign in through the fallback method. Use disposable Test accounts.

After successful Test evidence, configure the production Supabase Auth project independently, validate its exact production origin, then enable the production Vercel flag. Never copy project-specific Auth settings from Test without checking the production domain.

## Platform boundary

The flow in this branch is web-only. The app uses Capacitor, not a Flutter client, and this change does not add native iOS or Android passkey ceremonies. Native passkeys need a separate implementation and testing pass against the production application identifiers, Apple Associated Domains / Android origin configuration, and the supported native Supabase SDK path. A browser passkey button must not appear in the native shell.

## Security behavior

- Passkey enrollment requires a signed-in account with a confirmed email. This matches the existing email-based confirmation for sign-ins from new devices; phone-only passkey enrollment remains unavailable until that recovery path supports phone confirmation end to end.
- Passkey sign-in loads the existing WeHouse profile and uses the existing device-registration flow. Pending devices still need the current device-confirmation process.
- Passkeys are an optional additional sign-in method; they do not replace account recovery, Creator step-up, workspace permissions, or server authorization.
- Passkey APIs are experimental in Supabase Auth and may change. Keep the feature flag off if the hosted project or deployed client cannot support the same API.

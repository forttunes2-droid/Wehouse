# WeHouse native packages

The `ios/` Xcode project uses the same web application as Android. All roles and
workspaces are in that app. Capacitor 8 is pinned in `package-lock.json`.

## Build configuration

Use two distinct Supabase projects. Export both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` from the chosen project before running:

| Target | Command | Project guard |
| --- | --- | --- |
| iOS test | `npm run prepare:ios:test` | Rejects the production Supabase URL |
| Android test | `npm run prepare:android:test` | Rejects the production Supabase URL |
| iOS release | `npm run prepare:ios:release` | Requires the production Supabase URL |
| Android release | `npm run prepare:android:release` | Requires the production Supabase URL |

These commands build the web bundle and sync it into the native project. Build
and sign the iOS app with Xcode on macOS; build and sign the Android AAB with
the Android toolchain. The iOS project has not yet passed an Xcode simulator or
device build in this Linux workspace.

## Account providers

Register `com.wehouse.app://auth-callback/` as an allowed redirect in each
Supabase Auth project used for native testing or releases. Configure the Google
and Apple provider with the matching application identifiers and callback in
their consoles. The app uses a PKCE code callback and exchanges the code in the
packaged app. `VITE_APPLE_SIGN_IN_ENABLED=true` exposes the Apple buttons only
after the provider works end to end. Test existing account sign in, private
relay identity linking, failed/cancelled callbacks, and password recovery on a
real iOS device before enabling it. New Apple account registration and native
Authentication Services remain a separate launch gate.

## Paid features

Do not enable native Worker Pro or other digital purchases by routing them to
the web checkout. Native store purchases need StoreKit and Play Billing flows,
server verified transactions, restoration, entitlement reconciliation, and
refund/cancellation handling. Existing web checkout remains web only until
those paths pass store sandbox tests.

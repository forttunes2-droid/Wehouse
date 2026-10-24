# Account recovery and device confirmation

**Updated 20 October 2026 (C-065).** Email-code recovery is the default implementation. A previously linked Google/Apple identity remains an explicitly labelled alternative. Ordinary provider sign-in is never device approval or password-reset authority. Email signup accepts its separate Auth confirmation link/code and does not require a Google account.

## Email-code contract

`email-account-security` handles `device_confirmation` and `password_recovery` as distinct purposes. Each cryptographically random eight-digit code is HMAC-bound to the challenge ID, Auth account and purpose, expires in ten minutes and allows five guesses. Device proof also binds the exact pending WeHouse session, Auth session and device identifier. A service-only table stores the hash, lifecycle and recovery receipt; no raw code or password is persisted or logged. The existing account, device and credential authorities are retained.

Atomic claims serialize completion. A wrong code consumes an attempt. An expired, consumed, different-purpose or different-account proof cannot promote a device. Provider tokens are not accepted as the email proof: Supabase's magic-link/recovery token pool must not be mistaken for separate WeHouse code purposes. Device success trusts only the pending login. Recovery updates credentials server-side, revokes Auth sessions globally and closes WeHouse device records; incomplete cleanup reports the partial outcome and retains the unusable processing claim for Operations review.

## Email transport activation

The current transport adapter uses Resend; it creates no provider account and incurs no sends while disabled. Configure these **server secrets**, never `VITE_` values:

- `RESEND_API_KEY`: restricted sending credential for the approved mail account.
- `EMAIL_SECURITY_FROM`: approved verified sender address/domain.
- `EMAIL_SECURITY_HMAC_KEY`: separate random secret of at least 32 characters; rotating it invalidates outstanding codes.
- `EMAIL_SECURITY_CODES_ENABLED=true`: enable only after sender/domain configuration and end-to-end delivery/recovery verification.

The endpoint deliberately has gateway JWT verification disabled because forgotten-password initiation is public. Every device action still authenticates its bearer, checks actual Auth liveness and binds the owned pending session; recovery completion requires its purpose-bound proof. Network/account send throttles apply before delivery. Unknown/ineligible recovery accounts receive a uniform conditional receipt; no destination address or provider response is disclosed. Missing mail configuration returns 503, not a fake sent state. Delivery is **not configured or exercised on Test** at this checkpoint.

Required delivery evidence: inbox/spam receipt, expiry, wrong code, resend, fifth/sixth guess, account/purpose substitution, replay, concurrent completion, sender failure, lost response, new-password sign-in, old-session denial, two-device notice/rejection, web/native resume and both themes. SQL/browser fixtures cannot replace this evidence. The existing service purge also expires challenge material after two days; verify its scheduler and monitor unresolved proof-verified processing attempts before activation.

## Optional linked-provider alternative

- Google is the only recovery provider exposed today.
- Apple may be exposed only after Apple Sign In is configured and the Apple
  identity is linked to the existing Auth user.
- Adding Apple changes the provider button, not the authorization rules.
- Email/password accounts use the separate email-code route and do not need to link a provider.

## Linked-provider authorization contract

1. `begin_identity_provider_password_recovery` returns an opaque attempt ID
   with the same response shape for unknown, unlinked and rate-limited users.
2. A real attempt expires after ten minutes.
3. OAuth must return the exact Auth user and provider stored on that attempt.
4. The attempt is bound to that OAuth session ID and can be claimed once.
5. Only `provider-password-recovery`, running with the service role, changes
   the password. The browser never calls `auth.updateUser` for recovery.
6. Success closes WeHouse device-session records and revokes Supabase refresh
   sessions globally. The person signs in again deliberately.

An ordinary Google or Apple login is therefore not a password-reset grant. It
must be preceded by, and match, a live recovery attempt.

## Release order

Do not release the recovery UI before all of these steps are complete:

1. Replay and apply the database migration.
2. Deploy `provider-password-recovery` with JWT verification enabled.
3. In Supabase Auth password settings, enable **Require current password when
   changing password**. This protects the ordinary signed-in Auth endpoint;
   the recovery Edge Function uses its separate server authorization.
4. Set the production password-strength policy and enable leaked-password
   protection where the project plan supports it.
5. Exercise the real Google callback, wrong-Google rejection, expired attempt,
   replay rejection, password login with the new credential, and revocation of
   an older device session.

Apple must pass the same end-to-end cases before its button is shown.

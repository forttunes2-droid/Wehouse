# Identity-provider password recovery

WeHouse does not send password-reset links or recovery codes. Recovery is a
separate, short-lived action confirmed by an identity provider already linked
to the same WeHouse Auth user.

## Current and future providers

- Google is the only recovery provider exposed today.
- Apple may be exposed only after Apple Sign In is configured and the Apple
  identity is linked to the existing Auth user.
- Adding Apple changes the provider button, not the authorization rules.
- Email-and-password remains a login method; possession of an email inbox is
  not the WeHouse password-recovery proof.

## Authorization contract

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

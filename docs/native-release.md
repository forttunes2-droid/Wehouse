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
device build in this Windows workspace.

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

## Native configuration checkpoint - 20 October 2026

Android now matches the installed Capacitor 8 baseline: minimum SDK 24, compile/target SDK 36, Android Gradle Plugin 8.13.0, Gradle 8.14.3 and the documented AndroidX dependencies. These are configuration changes, not a successful native build. The local Gradle probe fails because Java/JAVA_HOME is unavailable. Install/configure the Java and Android toolchain, build and inspect a signed AAB, exercise physical-device journeys, and prove supported-device compatibility before submission.

iOS still needs a macOS/Xcode build, signing and physical-device evidence. Apple requires Xcode 26 or later with the iOS 26 SDK for current submissions. Capacitor 8.5 still supports AppDelegate; building with Xcode 27 requires UIScene migration. Project deployment target 15.0 does not prove the selected build SDK.

Store preparation also requires verified account deletion (in-app and required web route), privacy/data-safety declarations, permissions and SDK inventory, UGC reporting/blocking and operator review, review-account access, accessible responsive journeys, deep-link/auth callbacks, and store-sandbox digital purchases/restoration/refund reconciliation. Real-world housing/service payments remain distinct from digital Pro purchases. Provider credentials, signing accounts and review approval are external; implementation and device verification remain engineering work.

Sources: https://capacitorjs.com/docs/updating/8-0 ; https://capacitorjs.com/docs/updating/8-5 ; https://developer.apple.com/news/upcoming-requirements/ ; https://support.google.com/googleplay/android-developer/answer/11926878

## Native push activation and verification

The pinned @capacitor/push-notifications 8.1.3 plugin is synced into Android and iOS. iOS forwards registration callbacks and has aps-environment entitlements (development Debug, production Release). Android declares notification permission and uses a white notification icon and the wehouse_updates channel. No signed native build is claimed.

Server secrets: NATIVE_PUSH_ENABLED=true only for the environment being exercised; FCM_SERVICE_ACCOUNT_JSON for Android; APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY, APNS_TOPIC=com.wehouse.app, and APNS_ENVIRONMENT=sandbox or production for iOS. PUSH_WORKER_SECRET must be at least 32 random characters. Keep provider private keys on the server. Add matching native_push_project_url and native_push_worker_secret secrets to Supabase Vault; the scheduler resolves them at runtime and otherwise does nothing. Never put credentials in cron command text, client env variables or chat. Configure Firebase google-services.json for the Android application and enable Push Notifications in the matching Apple provisioning profile. These are app-owner delivery credentials, separate from Google/Apple user login.

Deploy the native-push function, apply the three recorded migrations and verify the scheduler in the isolated Test project first. Exercise permission grant/denial, token refresh, both platform environments, background and terminated app, offline/delayed delivery, tap after sign-out/account switch, off cancellation and revoked session. Verify the resulting Inbox and existing message/Activity permissions; inventory which message writers actually emit the canonical audience event. The current transport covers canonical Activity emissions; full chat and durable-reminder coverage is not yet proved. Browser tests cover the real setting and popup/select layout at 320/768/1440 px in both themes, with controlled native adapter responses. They cannot prove native delivery.

Push acceptance is not a guarantee of phone delivery or a read receipt. The queue uses leases and stable collapse identifiers; uncertain provider responses can be retried. Start with the bounded 25-job invocation and measure backlog/latency before increasing throughput. No global notification-capacity claim is established.

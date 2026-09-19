# Payment environment configuration

`payment-init` and `worker-pro-payment-init` require an explicit server-side
`APP_URL`. Checkout return URLs never come from the request body or Origin header.
The existing payment amount, ownership, verification and marketplace launch gates
continue to apply. Reaching the return URL does not settle a payment.

| Setting | WeHouse Test | Production release |
| --- | --- | --- |
| Supabase project | `qoobnkedfyosnizrlttt` | `rkrhnkhppeihvmuwvsvn` |
| `APP_URL` | `https://wehouse-git-codex-harden-main-00d893-forttunes2-6534s-projects.vercel.app` | `https://www.wehouse.com.ng` |
| `PAYSTACK_SECRET_KEY` | Provider-issued test key only | Appropriate production provider key; marketplace live gate still required |
| Backend credentials | Test project credentials | Production project credentials |

Set values in the matching Supabase project's Edge Function secrets, not Vercel
browser variables or source control. Do not paste private keys into chat or the PR.
`APP_URL` must be an HTTPS origin with no credentials, custom port, path, query or
fragment. Production requires an official WeHouse host. Other projects reject
official production hosts and live Paystack keys.

Set and verify production `APP_URL` **before deploying these functions there**.
Missing or mismatched settings return 503 without contacting the payment provider.
The shared dependency `_shared/payment-return.ts` must be included in both bundles.
Keep JWT verification enabled.

For Test, configure Paystack's test webhook to the Test project's deployed
`paystack-webhook`. Use fresh synthetic bookings and provider test payment methods.
Do not copy production payments, cached checkout URLs or credentials into Test.
Previously initialized provider checkouts retain the callback chosen when created;
this repair controls newly initialized sessions and does not rewrite provider state.

Release evidence still required: actual provider checkout return, verified webhook
and reconciliation, duplicate delivery, cancellation, supplier release, withdrawal
success/failure/reversal, and matching ledger state. Automated handler tests replace
external provider/database I/O; they do not constitute those end-to-end results.

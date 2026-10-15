# WeHouse documentation index

If two documents disagree, the one **higher in this list wins**. Anyone writing
code should start here. Anything not listed below is not authoritative; if it is
found elsewhere (old reports, dated notes), delete it or move it to git history.

## 1. What WeHouse is (product authority)

| Order | Document | Use it for |
|---|---|---|
| 1 | [DECISION_LOG.md](./DECISION_LOG.md) | Accepted owner decisions and open questions |
| 2 | [PRODUCT_RULES.md](./PRODUCT_RULES.md) | Accepted product rules |
| 3 | [../WEHOUSE_MASTER_PLAN.md](../WEHOUSE_MASTER_PLAN.md) and [../WEHOUSE_ARCHITECTURE_CONTRACT.md](../WEHOUSE_ARCHITECTURE_CONTRACT.md) | Language, ownership and route boundaries |
| 4 | [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md), [LIFECYCLES.md](./LIFECYCLES.md), [PAYMENTS_AND_MONEY.md](./PAYMENTS_AND_MONEY.md), [NAVIGATION.md](./NAVIGATION.md), [NOTIFICATIONS_AND_ACTIVITY.md](./NOTIFICATIONS_AND_ACTIVITY.md), [CHAT_AND_COMMUNICATION.md](./CHAT_AND_COMMUNICATION.md), [COMMUNICATION_AND_SAVED_CANONICAL_2026-09-12.md](./COMMUNICATION_AND_SAVED_CANONICAL_2026-09-12.md), [DATA_MODEL.md](./DATA_MODEL.md), [GLOBAL_DESTINATION_AND_LANGUAGE_MODEL.md](./GLOBAL_DESTINATION_AND_LANGUAGE_MODEL.md) | Detail per area |
| 5 | [PRODUCT_MASTER.md](./PRODUCT_MASTER.md) | Historical implementation audit (11 Sep). Context only |

Accepted decisions with their own record: [D-002 hotel capability](./DECISION_D002_HOTEL_CAPABILITY_AUTHORITY_2026-09-12.md), [D-010 money authority](./DECISION_D010_MONEY_AUTHORITY_2026-09-12.md), [D-014 post-publication edits](./DECISION_D014_POST_PUBLICATION_EDIT_BOUNDARY_2026-09-12.md).

## 2. What is left to do (release authority)

| Document | Use it for |
|---|---|
| [WEHOUSE_RELEASE_ROADMAP.md](./WEHOUSE_RELEASE_ROADMAP.md) | What "finished" means, stages, owners, evidence. **The plan to follow** |
| [WEHOUSE_OPERATING_MODEL_R1_R11.md](./WEHOUSE_OPERATING_MODEL_R1_R11.md) | The R1–R11 checklist and operating rules |
| [WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md](./WEHOUSE_PRODUCT_COHERENCE_AUDIT_20261012.md) | Current findings with evidence |
| [KNOWN_INCONSISTENCIES.md](./KNOWN_INCONSISTENCIES.md) | Defect register (High/Medium/Low) |
| [PRODUCT_READINESS_AUDIT_2026-10-12.md](./PRODUCT_READINESS_AUDIT_2026-10-12.md) | Readiness audit and remaining-work table |

## 3. Operating, legal and release procedures

- Database and deploy: [MAIN_PROTECTION_ROLLOUT.md](./MAIN_PROTECTION_ROLLOUT.md), [main-protection-and-emergency-path.md](./main-protection-and-emergency-path.md), [payment-environment-configuration.md](./payment-environment-configuration.md), [provider-setup-and-costs.md](./provider-setup-and-costs.md), [IDENTITY_PROVIDER_PASSWORD_RECOVERY.md](./IDENTITY_PROVIDER_PASSWORD_RECOVERY.md), [PASSKEY_ROLLOUT.md](./PASSKEY_ROLLOUT.md)
- Capacity: [LAUNCH_CAPACITY_ACCEPTANCE_2026-09-27.md](./LAUNCH_CAPACITY_ACCEPTANCE_2026-09-27.md), [capacity-validation.md](./capacity-validation.md)
- Hotel PMS: [HOTEL_PMS_CERTIFICATION_AND_LAUNCH.md](./HOTEL_PMS_CERTIFICATION_AND_LAUNCH.md)
- Native apps: [native-release.md](./native-release.md), [native-store-release.md](./native-store-release.md)
- Legal: [LEGAL_LAUNCH_REGISTER_NIGERIA_2026-09-13.md](./LEGAL_LAUNCH_REGISTER_NIGERIA_2026-09-13.md), [WEHOUSE_LAWYER_REVIEW_PACK.md](./WEHOUSE_LAWYER_REVIEW_PACK.md), [WEHOUSE_PUBLIC_LEGAL_PACK_DRAFT.md](./WEHOUSE_PUBLIC_LEGAL_PACK_DRAFT.md), [legal-review-and-preview-status.md](./legal-review-and-preview-status.md)
- Branches: [BRANCH_CLEANUP_AUDIT.md](./BRANCH_CLEANUP_AUDIT.md)
- Security reporting: [../SECURITY.md](../SECURITY.md)

## Rules for keeping this true

1. **SQL:** only `supabase/migrations` is executable. `supabase/migrations_legacy` is history; never run it.
2. **One plan:** release status lives only in the roadmap. Do not add new `*_REPORT.md`, `STAGE*` or `PHASE*` files; update the roadmap and audit instead.
3. A pull request that changes behavior updates the matching document above in the same PR.
4. A new document must be added to this index, or it should not be merged.

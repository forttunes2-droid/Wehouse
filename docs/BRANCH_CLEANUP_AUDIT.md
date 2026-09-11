# Codex Branch Cleanup Audit

Audit date: 2026-09-11

Comparison base: `main` at `6158af0782bf9986ca9df76803902fc2cbd4fb53`

Scope: the 17 remote heads matching `refs/heads/codex/*`. This is a read-only classification. No branch was deleted, rebased, force-pushed, or otherwise changed.

## Result

All 17 requested branch heads are fully integrated or superseded by `main`:

- 11 branch-tip commits have the same stable Git patch ID as a commit on `main`.
- 6 multi-commit branch heads have exactly the same repository tree as the corresponding squash commit on `main`; in each case, that squash commit's first parent is the branch merge base.
- 0 branches contain unique effective work at their audited head.
- 0 branches are uncertain under this comparison.

The branches are not Git ancestors of current `main` because GitHub's merge/squash history produced different commit identities. An ancestor-only test would incorrectly report them as unmerged. Patch and tree equivalence are the relevant evidence.

## Safe cleanup list

“Safe after head recheck” means the audited head can be removed once the owner approves cleanup and the remote SHA is confirmed unchanged.

| Branch | Audited head | Evidence on `main` | Classification |
|---|---:|---:|---|
| `codex/align-lifecycle-migration-history` | `91feb44a` | exact tree at squash `83614ed` | Safe after head recheck |
| `codex/align-supabase-migration-history` | `6b670b86` | patch-equivalent `f2e81df2` | Safe after head recheck |
| `codex/apartment-media-modernization` | `7dd5cb52` | exact tree at squash `d6861cb` | Safe after head recheck |
| `codex/canonical-activity-hotel-operations` | `577ee4ce` | exact tree at squash `964d768` | Safe after head recheck |
| `codex/canonical-activity-security-creator` | `4f4f3882` | exact tree at squash `091ba09` | Safe after head recheck |
| `codex/creator-structure-activity-security` | `ff9a3933` | patch-equivalent `fc78e512` | Safe after head recheck |
| `codex/finish-supabase-history-alignment` | `384b807a` | patch-equivalent `9b1a5882` | Safe after head recheck |
| `codex/login-security-popup` | `8da89e2b` | patch-equivalent `1aaa08fb` | Safe after head recheck |
| `codex/map-address-and-communication` | `66dff007` | patch-equivalent `b7ac9174` | Safe after head recheck |
| `codex/prevent-location-conflict-20260904` | `e8c3f31e` | patch-equivalent `f87f0074` | Safe after head recheck |
| `codex/remove-worker-duplication-google-recovery` | `55948460` | patch-equivalent `88f6fb78` | Safe after head recheck |
| `codex/repair-structural-journeys` | `c8f8e397` | patch-equivalent `1f3863b9` | Safe after head recheck |
| `codex/restore-worker-inbox-label` | `51a25e6b` | patch-equivalent `c8790589` | Safe after head recheck |
| `codex/roommate-location-activity-20260904` | `4bd9f446` | patch-equivalent `ba20f645` | Safe after head recheck |
| `codex/structural-lifecycle-fixes` | `381a6576` | exact tree at squash `8b456b3` | Safe after head recheck |
| `codex/unify-creator-activity-property` | `55c5781b` | exact tree at squash `ed4c8e0` | Safe after head recheck |
| `codex/worker-job-inbox-device-confirmation` | `dae0ac20` | patch-equivalent `67d4987f` | Safe after head recheck |

## Unique work worth preserving

None among the 17 audited heads. This conclusion concerns effective repository content at each head. Branch-local intermediate commits may still be useful as historical explanation, but their final content does not add anything absent from `main`.

## Uncertain branches

None among the 17 audited heads. This classification becomes stale if any remote head moves after the SHA shown above.

## Excluded similarly named branch

`origin/codex-lifecycle-inbox-20260910` does not match `refs/heads/codex/*` because it has no slash after `codex`. It was not included in the requested 17-branch cleanup classification and must not be deleted on the strength of this report.

## Cleanup guardrails

Before any later deletion:

1. Fetch remote heads again and require every branch SHA to equal the audited SHA in the table.
2. Require `main` to still contain each evidence commit.
3. Confirm there is still no open pull request or protected deployment pointing at the branch.
4. Optionally create an archive tag or export the branch-head list if historical retention is desired.
5. Delete only the explicitly approved remote branch names; do not use a wildcard.
6. Record the cleanup date and actor in [DECISION_LOG.md](./DECISION_LOG.md).

## Reproduction method

The audit fetched each remote `codex/*` head into its remote-tracking ref, then used three checks:

- `git merge-base --is-ancestor <branch> main` to detect ordinary merges;
- `git cherry main <branch>` and stable patch IDs to map rewritten single commits;
- exact `git diff --quiet <branch-head> <main-squash-commit>` tree comparison, plus squash-parent/merge-base equality, for multi-commit branches.

No branch is a literal ancestor of `main`; all are nevertheless integrated through one of the two content-equivalence proofs above.

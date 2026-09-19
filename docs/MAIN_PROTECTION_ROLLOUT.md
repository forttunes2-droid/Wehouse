# Enforce WeHouse main protection

These JSON files are importable GitHub repository rulesets. Committing or merging
them does **not** activate protection. An administrator must create the active
rulesets in GitHub Settings or through the repository rules API.

## Required behavior

| Rule | Normal changes | Emergency changes |
| --- | --- | --- |
| Pull request | Required | Required |
| Force push or branch deletion | Blocked | Blocked |
| Resolve review conversations | Required | Required |
| WeHouse Build Check | Required from GitHub Actions | Owner may explicitly bypass on a PR |
| Consolidation Validation | Required from GitHub Actions | Owner may explicitly bypass on a PR |
| Up-to-date branch | Required | Owner may explicitly bypass the checks rule on a PR |

`main-integrity.json` has no bypass actors. `main-checks.json` allows only
`forttunes2-droid` (GitHub user ID `287019455`) to bypass, and only through a pull
request. It does not grant bypass to contributors, automation apps, deploy keys,
or every future repository administrator. Both target literal `main` and the
default branch. GitHub Actions app ID `15368` is bound to both check contexts.

Zero approving reviews preserves the existing single-maintainer workflow. It
does not remove the PR requirement. Require one independent approval once a
second trusted maintainer is available. The current owner remains capable of
editing repository settings; no repository rule can remove that ultimate admin
authority. Restrict account access and review rule-change history.

## Rollout and verification

1. Let this isolated PR publish both stable check names. The consolidation gate
   uses `always()` and succeeds only when both its build/test job and its empty
   database migration replay succeeded. It fails on failed, cancelled, or skipped
   prerequisites. Neither required workflow uses path filters.
2. Import `main-integrity.json` as an **Active** branch ruleset. Do not select
   "Restrict updates": that would prevent ordinary checked PR merges too.
3. Import `main-checks.json` as an **Active** branch ruleset. Review the exact
   owner-only PR bypass, both check names and GitHub Actions source before saving.
4. Read back both rulesets, including their bypass lists, and the effective rules
   for `main`. Confirm the branch now reports protection. Record the returned
   rule IDs and time. A committed JSON file is not evidence of enforcement.
5. Merge this PR normally only after its checks pass. Keep PR #74 draft; this
   rollout does not certify its product changes. When PR #74 is updated from
   main, preserve its stronger validation jobs and one final gate with the same
   required context name.
6. On a harmless future PR, verify merge is blocked while checks are missing or
   failing and normal merge is available after they pass. Check Rules Insights
   for enforcement and bypass records. Do not force-push or delete production
   main as a test, and do not use an emergency bypass to merge a test failure.

Read-only API verification with an authorized GitHub CLI session:

```sh
gh api repos/forttunes2-droid/Wehouse/rulesets
gh api repos/forttunes2-droid/Wehouse/rules/branches/main
gh api repos/forttunes2-droid/Wehouse/branches/main
```

For each returned rule ID, also read `repos/forttunes2-droid/Wehouse/rulesets/ID`
with repository administration access to verify the full bypass list. Preserve
existing unrelated rules; never disable them merely to match these files.

## Emergency procedure

1. Open `EMERGENCY: <incident>` against main with the smallest necessary patch.
2. Record the incident, customer impact, why waiting for the named check is unsafe,
   exact commit, manual validation, rollback plan, and owner making the decision.
3. Prefer passing checks. If necessary, only the owner explicitly bypasses the
   required-check ruleset through that PR. Never disable the integrity ruleset,
   push directly, force push, delete main, or grant an app a permanent bypass.
4. Keep the PR and GitHub rule-evaluation record as the audit trail. Run the full
   checks afterwards and record remediation; fix or revert through another PR.

GitHub enforces the actor and PR-only path. The incident reason and post-incident
review are operational requirements; GitHub does not infer whether an incident
is a genuine emergency from its title.

## Evidence as of 2026-09-19

- Main: `d5ddf61429d6d76307816e0a89ff67fc2c12dc3e`, unprotected; zero rulesets.
- PR #74 head: `bc05ab8e3a46b7ab3dba8082d478e38144a01389`; both requested check
  names exist and succeeded there, but main still used generic job names.
- Current connector has no repository-settings write operation. Browser sign-in
  was rejected because the account does not support password login. Enforcement
  remains pending authenticated administrator access; no protection is claimed.

Official references:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset

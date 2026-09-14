# Main protection and emergency path

Repository workflow files can define checks, but they cannot stop a direct push by themselves. GitHub must enforce the following active branch ruleset against the default branch (`main`).

## Required `main` ruleset

- Require a pull request before merging.
- Require `WeHouse Build Check` to pass.
- Require `Consolidation Validation` to pass. This final gate depends on both the consolidation build and an empty-database migration replay.
- Require the branch to be up to date before merging.
- Require all review conversations to be resolved.
- Block force pushes and branch deletion.
- Do not allow normal collaborators to bypass the ruleset.
- Use zero required approvals only while the repository has a single maintainer. As soon as a second maintainer is available, require one approval and dismiss stale approvals.

Set this in **Repository Settings → Rules → Rulesets → New branch ruleset**. Target the default branch and set enforcement to **Active**. The stable check names first appear on the pull request that introduces this policy.

## Emergency changes

An emergency still uses a pull request; it never uses a direct push to `main`.

1. Name the pull request `EMERGENCY: <incident>` and describe the customer or production impact.
2. Link the incident or issue, state why the normal checks cannot complete, and list the exact files changed.
3. Prefer a GitHub ruleset bypass actor configured as **For pull requests only** and limited to the repository administrator or emergency team.
4. If the GitHub plan does not support pull-request-only bypass, a repository administrator may temporarily relax only the blocked check, merge the emergency pull request, and immediately restore the rule. Do not disable force-push or pull-request requirements.
5. Run the full checks after the incident and open a follow-up pull request for any cleanup.

This keeps an auditable commit, pull request, author, reason, and recovery trail even during an emergency.

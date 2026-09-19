# PR #74 coordinated release

The production baseline has 518 migration records, ending at
`20260913181317`. The PR adds 39. A frontend-only merge would leave the live
application calling an older database and older Edge Functions.

## Existing-account protection

Two migrations in this unreleased PR originally cancelled professional reviews
or approvals while introducing biometric checks. Later migrations make those
checks optional. The production-unapplied migrations have been corrected to
preserve professional approvals, submitted reviews and reviewer notes.

Older browser-score identity passes become pending independent identity review;
they retain the captured evidence and timestamps. A separate professional
approval stays intact. The release refuses to proceed if biometric enforcement
is enabled. These DML corrections have no affected records in the empty Test
project, which previously replayed the older version of this sequence.

The upgrade test starts at the current production baseline with an approved
worker, a submitted review, historical identity evidence and a non-zero wallet.
It runs the exact release in rollback mode, then commits it, then checks that a
repeat is a no-op. This is required by Consolidation Validation in addition to
the empty-database replay and the application/SQL contracts.

## Release execution

The existing manual database workflow is now **Supabase coordinated release**.
It no longer rewrites migration history or pushes directly to main. It uses the
existing database secret, read-only GitHub permissions, the owner account, an
exact reviewed commit SHA and both required checks from GitHub Actions.

1. Run `check` for the passing PR head. It executes the complete upgrade against
   the live database inside one transaction, verifies preserved records and
   rolls everything back. No preview accounts are copied into production.
2. Inspect its result. `apply` runs the identical transaction and checks before
   committing. Original migration versions are recorded only after their SQL
   executes; history and schema commit together. Partial/unexpected history
   stops the release. Lock timeouts avoid waiting behind busy live operations.
3. Deploy matching reviewed Edge Functions with their existing authentication
   requirements and production-only provider configuration.
4. Enable the production Before User Created hook after its new compatible
   function exists. Unpublished legal documents must not close registration.
5. Merge PR #74 through the protected branch. Vercel must build using Production
   variables. Never promote a preview bundle that embeds the Test database.
6. Verify the production commit, database target, public signup/legal pages and
   existing-account login. The owner completes real account/device testing.

The transaction compares existing profiles, professional reviews, private
identity evidence, Auth identities, wallets, ledgers and payment records inside
the database. Row contents and database error details are not printed into
production logs or uploaded as artifacts. Migration filenames, hashes, commit,
actor and success/failure remain in GitHub's run history.

On a failure before commit, PostgreSQL rolls back the batch. On a connection
failure or uncertain result, inspect migration history before retrying. After a
successful commit, application rollback alone does not roll back the database;
keep writes paused during recovery and use a reviewed forward repair or an
independently verified backup restore. This process does not constitute a
complete disaster-recovery exercise or proof of million-user capacity.

Current execution evidence must be recorded here after the workflow completes.

References: [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[PostgreSQL psql transaction/error behavior](https://www.postgresql.org/docs/current/app-psql.html).

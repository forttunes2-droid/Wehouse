"""Execute the reviewed post-baseline migration batch atomically.

Uses the existing GitHub database secret via libpq environment variables. No
credentials, customer rows, schema dumps or database error details are logged.
check executes the same batch and assertions as apply, then rolls it all back.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "20260913181317"
# Completed, verified production releases. Later releases must still start from
# a complete repository prefix; an interrupted batch remains an error.
# 20260922020000: protected apply run 35699398426, followed by an independent
# Production history check (all 598 versions match the repository prefix).
# 20260922170000: read-only verification 2026-09-24: 600 versions, exact
# repository prefix; ordered-version MD5 10c8de036205d63648e3c7876c45ad0e.
COMPLETED_RELEASES = {BASELINE, "20260919181136", "20260920032704", "20260920072341", "20260920080946", "20260920141020", "20260920163100", "20260920174906", "20260920190517", "20260921121000", "20260921235500", "20260922020000", "20260922170000", "20260926064500"}
# These 12 property migrations were applied to Production under different
# timestamps. Their stored SQL is byte-identical to the repository files. Keep
# the real Production records; never replay the same DDL or rewrite history.
PRODUCTION_ALIASES = {
    "20260926065007": "20260926061000",
    "20260926065011": "20260926062000",
    "20260926065028": "20260926062100",
    "20260926065030": "20260926062300",
    "20260926065033": "20260926062400",
    "20260926065036": "20260926062500",
    "20260926065039": "20260926062600",
    "20260926065042": "20260926062700",
    "20260926065045": "20260926062800",
    "20260926065048": "20260926063000",
    "20260926070634": "20260926064000",
    "20260926070856": "20260926064500",
}
PRODUCTION_HOST = "aws-1-eu-north-1.pooler.supabase.com"
PRODUCTION_USER = "postgres.rkrhnkhppeihvmuwvsvn"


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def migration_body(source):
    # These reviewed migrations have either no outer transaction or exactly
    # BEGIN/COMMIT. Keep every function body untouched. Reject other controls.
    controls = re.findall(r"(?mi)^\s*(begin|commit|rollback)\s*;\s*$", source)
    if [x.lower() for x in controls] not in ([], ["begin", "commit"]):
        raise ValueError("Unsupported migration transaction controls")
    body = re.sub(r"(?mi)^\s*(?:begin|commit)\s*;\s*$", "", source)
    if re.search(r"(?mi)^\s*\\", body):
        raise ValueError("psql commands are not allowed in migrations")
    return body


def sql_request(sql):
    result = subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, timeout=600,
    )
    if result.returncode:
        # PostgreSQL error details can include customer values. Only expose a
        # controlled stage marker emitted by this script, never raw stderr.
        stages = [line for line in result.stdout.splitlines() if line.startswith("WH_RELEASE:")]
        detail = ""
        if os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("PGHOST") in ("127.0.0.1", "localhost"):
            detail = "\nDisposable local CI error: " + result.stderr[-4000:]
        raise RuntimeError("Database release did not finish; verify migration history before retrying. " + (stages[-1] if stages else "Connection/preflight failed.") + detail)
    return result.stdout.strip()


def snapshot_queries():
    queries = {
        "profiles": "select to_jsonb(t)-'account_kind'-'updated_at' as row from public.profiles t",
        "worker_verifications": "select to_jsonb(t) as row from public.worker_verifications t",
        "identity_evidence": "select jsonb_build_object('worker_id',worker_id,'enrollment',enrollment_photo_path,'latest',latest_reference_photo_path,'captured_at',captured_at,'consent_at',consent_at,'challenge_result',challenge_result,'attempt_count',attempt_count) as row from public.worker_identity_checks",
    }
    for table in ["auth.users", "public.wallets", "public.ledger_entries", "public.ledger_transactions", "public.payment_protection_transactions", "public.financial_action_outbox", "public.booking_payments"]:
        queries[table] = f"select to_jsonb(t) as row from {table} t"
    return queries


def digest_query(query):
    return f"select md5(coalesce(string_agg(row::text, '' order by row::text),'')) from ({query}) snapshot_rows"


def release_sql(files, applied, mode, aliases):
    expected = json.dumps(sorted(applied), separators=(",", ":"))
    parts = [f"""
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local idle_in_transaction_session_timeout='30s';
\\echo WH_RELEASE: preflight
do $$ begin
  if not pg_try_advisory_xact_lock(hashtext('wehouse-coordinated-release')) then
    raise exception 'Another release is in progress';
  end if;
  if (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations) <> {literal(expected)}::jsonb then
    raise exception 'Migration history changed after planning';
  end if;
  if exists(select 1 from public.platform_settings where key='worker_identity_checks_enabled' and is_active and lower(value) in ('true','1','yes','on')) then
    raise exception 'This rollout requires the agreed disabled biometric policy gate';
  end if;
end $$;
create temporary table wh_release_snapshot(name text primary key,digest text not null) on commit drop;
"""]
    for remote_version, name, digest in aliases:
        parts.append(f"""do $$ begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version={literal(remote_version)} and name={literal(name)}
      and md5(array_to_string(statements,E'\\n'))={literal(digest)}
  ) then raise exception 'Production migration alias changed'; end if;
end $$;""")
    queries = snapshot_queries()
    for name, query in queries.items():
        parts.append(f"insert into wh_release_snapshot values ({literal(name)},({digest_query(query)}));")
    for path in files:
        version, name = path.stem.split("_", 1)
        source = path.read_text()
        body = migration_body(source)
        delimiter = "$migration_" + hashlib.sha256(source.encode()).hexdigest()[:16] + "$"
        if delimiter in body:
            raise ValueError("Migration delimiter collision")
        parts += [f"\\echo WH_RELEASE: {path.name}", body,
                  f"insert into supabase_migrations.schema_migrations(version,name,statements) values ({literal(version)},{literal(name)},array[{delimiter}{body}{delimiter}]);"]
    parts.append("\\echo WH_RELEASE: preservation assertions")
    for name, query in queries.items():
        parts.append(f"do $$ begin if (select digest from wh_release_snapshot where name={literal(name)}) is distinct from ({digest_query(query)}) then raise exception 'Existing records changed unexpectedly: {name}'; end if; end $$;")
    parts.append("""
do $$ begin
  if public.account_identity_checks_enabled() then raise exception 'Biometrics were unexpectedly enabled'; end if;
  if has_function_privilege('anon','public.require_reviewed_legal_signup(jsonb)','execute')
    or has_function_privilege('authenticated','public.require_reviewed_legal_signup(jsonb)','execute')
    or not has_function_privilege('supabase_auth_admin','public.require_reviewed_legal_signup(jsonb)','execute') then
    raise exception 'Signup hook authority is incorrect';
  end if;
end $$;
""")
    parts.append("commit;" if mode == "apply" else "rollback;")
    return "\n".join(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["plan", "check", "apply"])
    parser.add_argument("--local-ci", action="store_true")
    args = parser.parse_args()
    if args.local_ci:
        if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("PGHOST") not in ("127.0.0.1", "localhost"):
            raise ValueError("Local mode is restricted to disposable GitHub CI")
    elif (os.environ.get("PGHOST"), os.environ.get("PGUSER"), os.environ.get("PGPORT")) != (PRODUCTION_HOST, PRODUCTION_USER, "5432"):
        raise ValueError("Production connection must match the reviewed WeHouse project")
    all_files = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    versions = [path.name.split("_", 1)[0] for path in all_files]
    if len(versions) != len(set(versions)):
        raise ValueError("Duplicate migration versions")
    applied = json.loads(sql_request("select coalesce(json_agg(version order by version),'[]') from supabase_migrations.schema_migrations;"))
    if set(applied) - set(versions) - set(PRODUCTION_ALIASES) or any(version not in applied for version in versions if version <= BASELINE):
        raise ValueError("Database baseline differs from the reviewed repository")
    paths = {path.name.split("_", 1)[0]: path for path in all_files}
    alias_versions = [version for version in applied if version in PRODUCTION_ALIASES]
    alias_rows = json.loads(sql_request(
        "select coalesce(json_agg(json_build_object('version',version,'name',name,'digest',"
        "md5(array_to_string(statements,E'\\n'))) order by version),'[]') "
        "from supabase_migrations.schema_migrations where version in ("
        + ",".join(literal(version) for version in PRODUCTION_ALIASES) + ");"
    ))
    if len(alias_rows) != len(alias_versions):
        raise ValueError("Production migration aliases are incomplete")
    verified_aliases = []
    for row in alias_rows:
        local_version = PRODUCTION_ALIASES[row["version"]]
        path = paths[local_version]
        if (local_version in applied or row["name"] != path.stem.split("_", 1)[1]
                or row["digest"] != hashlib.md5(path.read_bytes()).hexdigest()):
            raise ValueError("Production migration alias differs from the reviewed SQL")
        verified_aliases.append((row["version"], row["name"], row["digest"]))
    effective_applied = set(applied) - set(PRODUCTION_ALIASES)
    effective_applied.update(PRODUCTION_ALIASES[version] for version in alias_versions)
    pending = [path for path in all_files if path.name.split("_", 1)[0] not in effective_applied]
    # A partially applied batch needs investigation rather than silently moving
    # past the boundary at which existing-account preservation was established.
    if (pending and max(effective_applied) not in COMPLETED_RELEASES) or effective_applied != {
        version for version in versions if version <= max(effective_applied)
    }:
        raise ValueError("Partial post-baseline rollout detected; investigate before proceeding")
    if not pending:
        print("No pending database migrations; verified existing history and aliases.")
        return
    for path in pending:
        print(f"{path.name} sha256={hashlib.sha256(path.read_bytes()).hexdigest()}")
    batch = release_sql(pending, applied, args.mode, verified_aliases)
    if args.mode != "plan":
        sql_request(batch)
        final = json.loads(sql_request("select json_agg(version order by version) from supabase_migrations.schema_migrations;"))
        expected = sorted(applied + [path.name.split("_", 1)[0] for path in pending]) if args.mode == "apply" else sorted(applied)
        if final != expected:
            raise RuntimeError("Post-release migration history verification failed")
    print(f"{args.mode}: {len(pending)} migrations; " + ("committed with original versions and preservation checks." if args.mode == "apply" else "no production changes committed."))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

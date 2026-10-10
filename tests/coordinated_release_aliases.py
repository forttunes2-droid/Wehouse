"""Production's already-applied property migrations must never be replayed."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "coordinated_release", ROOT / "scripts/coordinated-database-release.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ProductionAliases(unittest.TestCase):
    def setUp(self):
        self.files = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        self.paths = {file.name.split("_", 1)[0]: file for file in self.files}
        # Model the historical property release before later migrations were
        # applied. The current production snapshot is tested separately below.
        property_aliases = {
            remote: local for remote, local in release.PRODUCTION_ALIASES.items()
            if local <= "20260926064500"
        }
        self.applied = sorted(
            [version for version in self.paths if version <= "20260926064500"
             and version not in property_aliases.values()]
            + list(property_aliases)
        )
        self.alias_rows = [
            {"version": remote, "name": self.paths[local].stem.split("_", 1)[1],
             "digest": hashlib.md5(self.paths[local].read_bytes()).hexdigest()}
            for remote, local in sorted(property_aliases.items())
        ]

    def run_plan(self, rows):
        # Model the complete canonical migration prefix as well as the
        # timestamp-alias rows under test. The release guard must never be
        # tested against an alias-only history that cannot represent Production.
        canonical_rows = [
            {"version": version,
             "name": self.paths[version].stem.split("_", 1)[1],
             "digest": hashlib.md5(self.paths[version].read_bytes()).hexdigest()}
            for version in self.applied if version in self.paths
        ]
        history_rows = canonical_rows + [dict(row) for row in rows]
        def fake_sql(query):
            if "json_build_object('version'" in query:
                return json.dumps(history_rows)
            if "json_agg(version" in query:
                return json.dumps(self.applied)
            raise AssertionError("Plan tried an unexpected database operation")

        output = io.StringIO()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "PGHOST": "127.0.0.1"}), \
                patch.object(sys, "argv", ["release", "plan", "--local-ci"]), \
                patch.object(release, "sql_request", side_effect=fake_sql), \
                contextlib.redirect_stdout(output):
            release.main()
        return output.getvalue()

    def test_identical_production_aliases_plan_only_new_migrations(self):
        result = self.run_plan(self.alias_rows)
        pending = [file for file in self.files if file.name.split("_", 1)[0] > "20260926064500"]
        self.assertIn(f"plan: {len(pending)} migrations", result)
        self.assertNotIn("20260926061000_short_let_paid_reserve_date.sql sha256", result)
        self.assertIn("20260926081500_host_managed_home_controls.sql sha256", result)

    def test_changed_production_sql_is_rejected(self):
        rows = [dict(row) for row in self.alias_rows]
        rows[0]["digest"] = "0" * 32
        with self.assertRaisesRegex(ValueError, "alias differs"):
            self.run_plan(rows)

    def test_current_production_alias_has_exact_sql_and_no_pending_release(self):
        self.applied = sorted(
            [version for version in self.paths
             if version not in release.PRODUCTION_ALIASES.values()]
            + list(release.PRODUCTION_ALIASES)
        )
        rows = [
            {"version": remote, "name": self.paths[local].stem.split("_", 1)[1],
             "digest": hashlib.md5(self.paths[local].read_bytes()).hexdigest()}
            for remote, local in sorted(release.PRODUCTION_ALIASES.items())
        ]
        self.assertIn("No pending database migrations", self.run_plan(rows))

    def test_statement_representation_exception_is_exact_and_local_ci_only(self):
        path = self.paths["20260913180000"]
        self.assertTrue(release.local_ci_statement_representation_mismatch(
            "20260913180000", path, True
        ))
        self.assertFalse(release.local_ci_statement_representation_mismatch(
            "20260913180000", path, False
        ))
        with tempfile.TemporaryDirectory() as directory:
            changed = Path(directory) / path.name
            changed.write_bytes(path.read_bytes() + b"-- changed\\n")
            self.assertFalse(release.local_ci_statement_representation_mismatch(
                "20260913180000", changed, True
            ))

    def test_transaction_rechecks_aliases_and_preserves_history(self):
        sql = release.release_sql([], self.applied, "check", [
            (row["version"], row["name"], row["digest"]) for row in self.alias_rows
        ])
        self.assertIn("Production migration alias changed", sql)
        self.assertIn("rollback;", sql)
        self.assertNotIn("insert into supabase_migrations.schema_migrations(version,name,statements)", sql)


if __name__ == "__main__":
    unittest.main()

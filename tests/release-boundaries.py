"""Pure planning/SQL tests. No database connection or production credentials used."""
import contextlib,hashlib,importlib.util,io,json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('release',Path(__file__).resolve().parents[1]/'scripts/coordinated-database-release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
paths={p.name.split('_',1)[0]:p for p in (release.ROOT/'supabase/migrations').glob('*.sql')}
versions=sorted(paths)
completed=[v for v in versions if v<='20260922170000']
def row(version):
 p=paths[version]
 return {'version':version,'name':p.stem.split('_',1)[1],'digest':hashlib.md5(p.read_bytes()).hexdigest()}
class Boundaries(unittest.TestCase):
 def plan(self,history):
  with patch.object(release,'sql_request',return_value=json.dumps(history)) as query,patch.object(sys,'argv',['release','plan']),patch.dict(os.environ,{'PGHOST':release.PRODUCTION_HOST,'PGUSER':release.PRODUCTION_USER,'PGPORT':'5432'}),contextlib.redirect_stdout(io.StringIO()) as output:
   release.main()
   self.assertEqual(query.call_count,1) # Planning must not execute mutations.
  return output.getvalue()
 def test_production_prefix_verified(self):
  self.assertEqual(len(completed),600)
  self.assertEqual(hashlib.md5(','.join(completed).encode()).hexdigest(),'10c8de036205d63648e3c7876c45ad0e')
  self.plan([row(v) for v in completed])
 def test_missing_migration_is_planned_not_silently_skipped(self):
  history=[row(v) for v in completed if v!='20260922073000']
  output=self.plan(history)
  self.assertIn('20260922073000_',output)
  self.assertIn('plan:',output)
 def test_unknown_migration_rejected(self):
  with self.assertRaisesRegex(ValueError,'unverified rows'):
   self.plan([row(v) for v in completed]+[{'version':'20990101000000','name':'unknown','digest':'00000000000000000000000000000000'}])
 def test_unapproved_later_partial_boundary_rejected(self):
  with self.assertRaisesRegex(ValueError,'Applied migration SQL differs'):
   self.plan([row(v) for v in completed]+[{'version':'20260923150000','name':'unapproved_partial','digest':'00000000000000000000000000000000'}])
 def test_known_old_boundary_still_allowed(self):
  self.plan([row(v) for v in versions if v<='20260922020000'])
 def test_digest_resolves_historical_timestamp_alias_without_rewriting_it(self):
  history=[row(v) for v in completed]+[{'version':'20261010065655','name':'restore_live_property_management_handoff_guard_20261010120000','digest':hashlib.md5(paths['20261010120000'].read_bytes()).hexdigest()}]
  output=self.plan(history)
  self.assertNotIn('20261010120000_restore_live_property_management_handoff_guard.sql sha256=',output)
  self.assertIn('20261010130000_revoke_browser_grants_without_rls_policies.sql',output)
 def test_check_rolls_back_apply_commits_and_preserves_guards(self):
  check=release.release_sql([],completed,'check');apply=release.release_sql([],completed,'apply')
  self.assertTrue(check.endswith('rollback;'));self.assertTrue(apply.endswith('commit;'))
  for token in ["pg_try_advisory_xact_lock","Migration history changed after planning","wh_release_snapshot","Existing records changed unexpectedly","Signup hook authority is incorrect","Biometrics were unexpectedly enabled"]:
   self.assertIn(token,check);self.assertIn(token,apply)
if __name__=='__main__':unittest.main()

"""Pure planning/SQL tests. No database connection or production credentials used."""
import contextlib,hashlib,importlib.util,io,json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('release',Path(__file__).resolve().parents[1]/'scripts/coordinated-database-release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
versions=sorted(p.name.split('_',1)[0] for p in (release.ROOT/'supabase/migrations').glob('*.sql'))
completed=[v for v in versions if v<='20260922170000']
class Boundaries(unittest.TestCase):
 def plan(self,history):
  with patch.object(release,'sql_request',return_value=json.dumps(history)) as query,patch.object(sys,'argv',['release','plan']),patch.dict(os.environ,{'PGHOST':release.PRODUCTION_HOST,'PGUSER':release.PRODUCTION_USER,'PGPORT':'5432'}),contextlib.redirect_stdout(io.StringIO()):
   release.main();self.assertEqual(query.call_count,1) # Planning must not execute mutations.
 def test_production_prefix_verified(self):
  self.assertEqual(len(completed),600)
  self.assertEqual(hashlib.md5(','.join(completed).encode()).hexdigest(),'10c8de036205d63648e3c7876c45ad0e')
  self.plan(completed)
 def test_gap_rejected(self):
  history=[v for v in completed if v!='20260922073000']
  with self.assertRaisesRegex(ValueError,'Partial post-baseline'):self.plan(history)
 def test_unknown_migration_rejected(self):
  with self.assertRaisesRegex(ValueError,'baseline differs'):self.plan(completed+['20990101000000'])
 def test_unapproved_later_partial_boundary_rejected(self):
  with self.assertRaisesRegex(ValueError,'Partial post-baseline'):self.plan(completed+['20260923150000'])
 def test_known_old_boundary_still_allowed(self):self.plan([v for v in versions if v<='20260922020000'])
 def test_check_rolls_back_apply_commits_and_preserves_guards(self):
  check=release.release_sql([],completed,'check');apply=release.release_sql([],completed,'apply')
  self.assertTrue(check.endswith('rollback;'));self.assertTrue(apply.endswith('commit;'))
  for token in ["pg_try_advisory_xact_lock","Migration history changed after planning","wh_release_snapshot","Existing records changed unexpectedly","Signup hook authority is incorrect","Biometrics were unexpectedly enabled"]:
   self.assertIn(token,check);self.assertIn(token,apply)
if __name__=='__main__':unittest.main()

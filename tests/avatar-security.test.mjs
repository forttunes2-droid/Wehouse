import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public avatars are owner-folder writes with server-side file limits', async () => {
  const [migration, profile] = await Promise.all([
    read('supabase/migrations/20260916072000_harden_public_avatar_uploads.sql'),
    read('src/lib/supabase/profile.ts'),
  ]);

  assert.match(migration, /drop policy if exists "avatars_insert_authenticated"/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\]=\(select auth\.uid\(\)\)::text/);
  assert.match(migration, /file_size_limit=5\*1024\*1024/);
  assert.match(migration, /image\/jpeg/);
  assert.match(migration, /image\/png/);
  assert.match(migration, /image\/webp/);
  assert.match(profile, /const fileName=`\$\{user\.id\}\/avatar-/);
  assert.match(profile, /image\/jpeg','image\/png','image\/webp/);
});

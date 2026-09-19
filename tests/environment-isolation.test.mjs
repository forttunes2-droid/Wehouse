import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('non-production hosts cannot silently use production Supabase', async () => {
  const client = await read('src/lib/supabase/client.ts');

  assert.match(client, /VITE_SUPABASE_URL/);
  assert.match(client, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(client, /officialProductionHost/);
  assert.match(client, /Safety stop: a non-production WeHouse host cannot connect to the production Supabase project/);
  assert.match(client, /SUPABASE_STORAGE_URL/);
  assert.doesNotMatch(client, /endpoint:\s*'https:\/\/rkrhnkhppeihvmuwvsvn\.storage\.supabase\.co/);
});

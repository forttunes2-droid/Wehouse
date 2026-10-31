import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../scripts/lib/public-build-env.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports,Buffer});
const {assertPublicBuildEnvironment:check,assertPublicAsset:asset,containsPrivateCredential:privateValue}=exports;
const jwt=role=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({role,iss:'supabase',exp:9999999999})).toString('base64url'),'synthetic-signature'].join('.');

test('public config allows publishable, anon and payment public keys while ignoring server-only settings',()=>{
 check({VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_public-example',VITE_SUPABASE_ANON_KEY:jwt('anon'),VITE_PAYSTACK_PUBLIC_KEY:'pk_test_public-example',VITE_PASSKEYS_ENABLED:'false',SUPABASE_SERVICE_ROLE_KEY:'server-only-value'});
});
test('every VITE variable is checked, including unused fallbacks and misleading names',()=>{
 for(const environment of [{VITE_SUPABASE_SERVICE_ROLE_KEY:'hidden'},{VITE_EMAIL_API_TOKEN:'hidden'},
  {VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic_not_a_real_key'},
  {VITE_UNUSED_FALLBACK:jwt('service_role')},{VITE_OTHER:jwt('supabase_admin')},
  {VITE_OTHER:'sk_live_synthetic_not_a_real_key'}]){
  assert.throws(()=>check(environment),/Refusing to publish private credentials/);
 }
});
test('emitted-asset guard rejects embedded private values without echoing the secret',()=>{
 const value='sb_secret_synthetic_not_a_real_key';
 assert.throws(()=>asset('assets/app.js',`const key=${JSON.stringify(value)}`),error=>{
  assert.match(error.message,/assets\/app.js/);assert.ok(!error.message.includes(value));return true;
 });
 asset('assets/app.js',`const key=${JSON.stringify(jwt('anon'))}`);
 assert.equal(privateValue('The sb_secret_ prefix identifies server-only configuration.'),false);
});

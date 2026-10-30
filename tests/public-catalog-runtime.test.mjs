import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('emitted catalog entry loads in native Node ESM and serves its fetch contract',()=>{
 const root=mkdtempSync(join(tmpdir(),'wehouse-catalog-runtime-'));
 try {
  // Bundling resolves extensionless imports and hid the actual deployment failure.
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','api/public-catalog.ts',
   '--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023',
   '--lib','ES2023,DOM','--skipLibCheck','--rootDir','.', '--outDir',root],{stdio:'pipe'});
  writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
  const entry=pathToFileURL(join(root,'api/public-catalog.js')).href;
  const result=execFileSync(process.execPath,['--input-type=module','--eval',`
   process.env.VERCEL_ENV='preview';
   process.env.VITE_SUPABASE_URL='https://qoobnkedfyosnizrlttt.supabase.co';
   process.env.VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic';
   let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({items:[],has_more:false});};
   const {default:entry}=await import(${JSON.stringify(entry)});
   const response=await entry.fetch(new Request('https://test-preview.vercel.app/api/public-catalog?kind=homes&p_limit=24'));
   if(response.status!==200||calls!==1)throw Error('Emitted catalog request failed');
   const body=await response.json();if(body.items.length!==0||body.has_more!==false)throw Error('Wrong receipt');
   console.log('runtime request passed');
  `],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.match(result,/runtime request passed/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

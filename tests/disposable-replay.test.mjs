import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { disposableSupabase } from '../scripts/disposable-supabase.mjs';
function workspace(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wehouse-replay-')));
 fs.mkdirSync(path.join(root,'supabase','migrations'),{recursive:true});fs.mkdirSync(path.join(root,'supabase','bootstrap'));
 fs.writeFileSync(path.join(root,'supabase','config.toml'),'project_id = "wehouse"\n');
 fs.writeFileSync(path.join(root,'supabase','bootstrap','storage-buckets.sql'),'-- fixture baseline metadata');
 for(const n of ['20260101000000_one.sql','20260201000000_two.sql'])fs.writeFileSync(path.join(root,'supabase','migrations',n),n+'\n');
 // This is an explicitly created test directory, resolved under the OS temp root.
 t.after(()=>{assert.ok(path.relative(fs.realpathSync(os.tmpdir()),root).startsWith('wehouse-replay-'));fs.rmSync(root,{recursive:true,force:true});});return root;
}
test('local startup provisions bucket metadata before replaying the unchanged migrations',t=>{
 const root=workspace(t),calls=[];
 disposableSupabase(['start','--exclude','inbucket'],{root,run:(r,program,args,input)=>{
  calls.push({program,args,input});const names=fs.readdirSync(path.join(r,'supabase','migrations'));
  assert.equal(names.length,program==='supabase'&&args[0]==='start'?0:2);
 }});
 const excluded=calls[0].args[2].split(',');assert.ok(excluded.includes('studio')&&excluded.includes('edge-runtime')&&excluded.includes('mailpit'));
 for(const required of ['gotrue','postgrest','storage-api','realtime','kong'])assert.equal(excluded.includes(required),false);
 assert.equal(calls[1].program,'docker');assert.equal(calls[1].input,'-- fixture baseline metadata');
 assert.equal(calls[2].args.join(' '),'migration up --local');
 for(const n of fs.readdirSync(path.join(root,'supabase','migrations')))assert.equal(fs.readFileSync(path.join(root,'supabase','migrations',n),'utf8'),n+'\n');
});
test('versioned reset replays only the requested prefix and restores every source file',t=>{
 const root=workspace(t),calls=[];
 fs.writeFileSync(path.join(root,'supabase','migrations','20250526_historical.sql'),'-- original historical version\n');
 disposableSupabase(['reset','--version','20260101000000'],{root,run:(r,p,args)=>{calls.push(args);if(args[0]==='db')assert.equal(fs.readdirSync(path.join(r,'supabase','migrations')).length,0);if(args[0]==='migration')assert.deepEqual(fs.readdirSync(path.join(r,'supabase','migrations')),['20250526_historical.sql','20260101000000_one.sql']);}});
 assert.equal(calls[0].join(' '),'db reset --local --no-seed');assert.equal(fs.readdirSync(path.join(root,'supabase','migrations')).length,3);
});
test('a failed startup or migration restores the original source directory',t=>{
 for(const mode of ['start','reset']){
  const root=workspace(t);assert.throws(()=>disposableSupabase(mode==='start'?['start']:['reset','--version','20260101000000'],{root,run:(_r,_p,args)=>{if((mode==='start'&&args[0]==='start')||args[0]==='migration')throw Error('Fixture failure');}}),/Fixture failure/);
  assert.equal(fs.readdirSync(path.join(root,'supabase','migrations')).length,2);
 }
});
test('remote flags, unknown versions and another project are rejected before any command or file move',t=>{
 const root=workspace(t);let calls=0;const options={root,run:()=>{calls++;}};
 for(const args of [['reset','--linked'],['reset','--db-url','postgres://remote'],['start','--project-ref','remote'],['reset','--version','20200101000000']])assert.throws(()=>disposableSupabase(args,options));
 fs.writeFileSync(path.join(root,'supabase','config.toml'),'project_id = "other"\n');assert.throws(()=>disposableSupabase(['start'],options));assert.equal(calls,0);
});

test('registry throttling retries only platform startup, preserving migration order',t=>{
 const root=workspace(t),calls=[],waits=[],registries=[];let starts=0;
 disposableSupabase(['start'],{root,wait:ms=>waits.push(ms),run:(_r,program,args,_input,environment)=>{
  calls.push([program,...args]);if(args[0]==='start'){registries.push(environment.SUPABASE_INTERNAL_IMAGE_REGISTRY);if(++starts<3)throw Object.assign(Error('download failed'),{startupOutput:'toomanyrequests: failed to pull docker image'});}
 }});
 assert.deepEqual(waits,[20000,40000]);assert.equal(starts,3);
 assert.equal(new Set(registries).size,3);assert.ok(registries.every(r=>['public.ecr.aws','docker.io','ghcr.io'].includes(r)));
 assert.equal(calls.filter(c=>c[0]==='docker').length,1);assert.equal(calls.filter(c=>c[1]==='migration').length,1);
});

test('exhausted registry retries restore every migration and never run bootstrap or application SQL',t=>{
 const root=workspace(t);let calls=0;
 assert.throws(()=>disposableSupabase(['start'],{root,wait:()=>{},run:(_r,program,args)=>{
  assert.equal(program,'supabase');assert.equal(args[0],'start');calls++;
  throw Object.assign(Error('registry unavailable'),{startupOutput:'toomanyrequests'});
 }}),/registry unavailable/);
 assert.equal(calls,3);assert.equal(fs.readdirSync(path.join(root,'supabase','migrations')).length,2);
});

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function command(root, program, args, input) {
  const startup=program==='supabase'&&args[0]==='start';
  const result=spawnSync(program,args,{cwd:root,stdio:startup?'pipe':input===undefined?'inherit':['pipe','inherit','inherit'],input,shell:false,maxBuffer:16*1024*1024});
  if(startup){if(result.stdout?.length)process.stdout.write(result.stdout);if(result.stderr?.length)process.stderr.write(result.stderr);}
  if(result.error)throw result.error;
  if(result.status!==0){
    const error=new Error(`${program} ${args.join(' ')} failed (${result.status??result.signal}).`);
    if(startup)error.startupOutput=String(result.stdout||'')+String(result.stderr||'');
    throw error;
  }
}

/** Keep historical migration bytes intact while provisioning an empty local DB. */
function selectedMigrations(root, selected, action) {
  const folder=path.join(root,'supabase','migrations');
  const parked=path.join(root,'test-results',`replay-migrations-${randomUUID()}`);
  for(const target of [folder,parked]){
    const relative=path.relative(root,path.resolve(target));
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Migration staging must stay inside the workspace.');
  }
  if(fs.realpathSync(folder)!==folder)throw new Error('Migration staging does not follow symlinks.');
  fs.mkdirSync(path.dirname(parked),{recursive:true});
  fs.renameSync(folder,parked);
  fs.mkdirSync(folder);
  try {
    for(const name of selected)fs.copyFileSync(path.join(parked,name),path.join(folder,name));
    return action();
  } finally {
    // Delete only our known copies. Unexpected files prevent restoration rather
    // than deleting someone else's work. The original remains safely parked.
    for(const name of selected)if(fs.existsSync(path.join(folder,name)))fs.unlinkSync(path.join(folder,name));
    fs.rmdirSync(folder);
    fs.renameSync(parked,folder);
  }
}

export function disposableSupabase(args,{root=process.cwd(),run=command,wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}) {
  root=fs.realpathSync(root);
  const config=fs.readFileSync(path.join(root,'supabase','config.toml'),'utf8');
  if(!/^project_id\s*=\s*"wehouse"\s*$/m.test(config))throw new Error('Only the disposable wehouse local project is supported.');
  const [mode,...options]=args;let version;let excludes=[];
  if(mode==='start'){
    if(options.length){if(options.length!==2||options[0]!=='--exclude'||!/^[a-z,-]+$/.test(options[1]))throw new Error('Only --exclude is accepted for local start.');excludes=options;}
  }else if(mode==='reset'){
    if(options.length){if(options.length!==2||options[0]!=='--version'||!/^\d{14}$/.test(options[1]))throw new Error('Only a migration --version is accepted for local reset.');version=options[1];}
  }else throw new Error('Use start [--exclude names] or reset [--version timestamp]. Remote targets are not supported.');
  const folder=path.join(root,'supabase','migrations');
  // Preserve the recorded eight-digit historical migration as well as modern
  // timestamp versions; dropping it makes the upgrade baseline incomplete.
  const names=fs.readdirSync(folder).filter(name=>/^\d{8,14}_.+\.sql$/.test(name)).sort();
  if(version&&!names.some(name=>name.startsWith(version+'_')))throw new Error('Requested baseline migration does not exist.');
  const bootstrap=fs.readFileSync(path.join(root,'supabase','bootstrap','storage-buckets.sql'),'utf8');
  // Supabase's schema-only dump omits storage.buckets data. Start/reset only
  // platform infrastructure first, then restore its declared bucket metadata,
  // then execute the exact original application migration files in order.
  selectedMigrations(root,[],()=>{
    if(mode!=='start')return run(root,'supabase',['db','reset','--local','--no-seed']);
    // Keep database, Auth, REST, Storage and Realtime real. Administrative UI,
    // telemetry and unused Edge/pooler containers do not participate in these CI stories.
    const omitted=new Set(['studio','postgres-meta','edge-runtime','logflare','vector','supavisor','mailpit',...(excludes[1]||'').split(',').filter(Boolean).map(name=>name==='inbucket'?'mailpit':name)]);
    for(let attempt=0;;attempt++){
      try{return run(root,'supabase',['start','--exclude',[...omitted].join(',')]);}
      catch(error){
        if(attempt>=2||!/toomanyrequests|too many requests|429|failed to pull docker image/i.test(error.startupOutput||''))throw error;
        const pause=attempt===0?20_000:40_000;
        console.warn(`Container registry download failed; retrying platform startup after ${pause/1000}s. Application migrations have not run.`);
        wait(pause);
      }
    }
  });
  run(root,'docker',['exec','-i','supabase_db_wehouse','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],bootstrap);
  const migrate=()=>run(root,'supabase',['migration','up','--local']);
  if(version)selectedMigrations(root,names.filter(name=>name.split('_',1)[0]<=version),migrate);else migrate();
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{disposableSupabase(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}

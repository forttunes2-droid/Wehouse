import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out = 'test-results/worker-documents-offline'; fs.mkdirSync(out, { recursive: true });
await build({entryPoints:['tests/browser/worker-documents.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:`${out}/fixture.js`,plugins:[{name:'isolated-worker-documents',setup(api){
  api.onResolve({filter:/^@\/lib\/supabase$|^@\/lib\/supabase\/worker-bookings$|^@\/lib\/native$/}, args=>({path:args.path,namespace:'fixture'}));
  api.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path.endsWith('/native')
    ? `export const isNative=()=>false;export const isIOS=()=>false;export const isAndroid=()=>false;`
    : args.path.endsWith('/worker-bookings')
    ? `export async function getCommunicationBookingConversations(){const s=window.__documents;s.calls.push({name:'jobs'});if(s.failJobs)throw new Error('Test job read failed');return {conversations:[{booking_id:'job-a',other_person_name:'Test Customer',service_type:'Carpentry',booking_code:'TEST-JOB'}],error:null};}`
    : `export const supabase={rpc:async(name,args)=>{const s=window.__documents;s.calls.push({name,args});if(name==='get_my_worker_work_documents'){if(s.failDocs)throw new Error('Test document read failed');if(s.malformed)return{data:null,error:null};if(s.delay){await new Promise(resolve=>s.pending.push(resolve));}return{data:s.records,error:null};}if(name==='get_my_worker_work_insights')return{data:s.insights,error:null};if(name==='save_my_worker_work_document')return{data:'saved-test-document',error:null};return{data:true,error:null};},functions:{invoke:async()=>{throw new Error('No payments or Auth are available in this test');}}};` }));
  api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind}));
}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});fs.writeFileSync(`${out}/fixture.css`,css.css);

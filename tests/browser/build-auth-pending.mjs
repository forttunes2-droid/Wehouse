import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='test-results/auth-pending-offline';fs.mkdirSync(out,{recursive:true});
const root=`
const state=()=>window.__authTest;
export const supabase={auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},rpc:async()=>({data:null,error:null})};
function pending(name,args){const s=state();s.calls.push({name,args});return new Promise(resolve=>s.resolve=resolve);}
export const signInWithIdentifier=(...args)=>pending('password',args);
export const signInWithGoogle=(...args)=>pending('google',args);
export const signUpWithEmail=(...args)=>pending('signup',args);
export const getProfileByAuthId=async()=>({profile:null});
export const deactivateUserSession=async()=>({error:null});`;
await build({entryPoints:['tests/browser/auth-pending.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'pending-auth-fixture',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase(?:\/(?:client|legal|listings|hotels))?$/},args=>({path:args.path,namespace:'fixture'}));
 api.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='@/lib/supabase'?root:args.path.endsWith('/client')?'export const isTestEnvironment=false;':args.path.endsWith('/legal')?'export const getCurrentLegalDocuments=async()=>({documents:{privacy:null,terms:null},error:null});':args.path.endsWith('/listings')?'export const getAllListings=async()=>({listings:[],error:null});export const getListing=async()=>({listing:null});export const getListingMediaUrls=async()=>({urls:[],error:null});':'export const getHotels=async()=>({hotels:[],error:null});export const getHotelById=async()=>({hotel:null});'}));
 api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind}));
}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});
fs.appendFileSync(out+'/fixture.css','');fs.writeFileSync(out+'/fixture.css',fs.readFileSync(out+'/fixture.css','utf8')+'\n'+css.css);

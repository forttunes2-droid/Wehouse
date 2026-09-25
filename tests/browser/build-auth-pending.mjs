import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='test-results/auth-pending-offline';fs.mkdirSync(out,{recursive:true});
const names=new Set();
function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else if(/\.tsx?$/.test(file)){const parsed=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);for(const node of parsed.statements)if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='@/lib/supabase')for(const name of node.importClause?.namedBindings?.elements||[])if(!name.isTypeOnly)names.add(name.propertyName?.text||name.name.text);}}}visit('src');
const provided=new Set(['supabase','signInWithIdentifier','signInWithGoogle','signUpWithEmail','getProfileByAuthId','deactivateUserSession']);
const root=`
const state=()=>window.__authTest;
export const supabase={auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},rpc:async(name)=>{if(['get_discoverable_listings','get_all_settings_v2'].includes(name))return{data:[],error:null};throw new Error('Unexpected public Auth fixture RPC '+name)}};
function pending(name,args){const s=state();s.calls.push({name,args});return new Promise(resolve=>s.resolve=resolve);}
export const signInWithIdentifier=(...args)=>pending('password',args);
export const signInWithGoogle=(...args)=>pending('google',args);
export const signUpWithEmail=(...args)=>pending('signup',args);
export const getProfileByAuthId=async()=>({profile:null});
export const deactivateUserSession=async()=>({error:null});
${[...names].filter(n=>!provided.has(n)).map(n=>`export const ${n}=async()=>{throw new Error('Unexpected Auth fixture API ${n}');};`).join('\n')}
`;
await build({entryPoints:['tests/browser/auth-pending.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'pending-auth-fixture',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase(?:\/(?:client|legal|listings|hotels))?$/},args=>({path:args.path,namespace:'fixture'}));
 api.onResolve({filter:/(^|\/)client(?:\.ts)?$/},args=>path.resolve(args.resolveDir,args.path).replace(/\.ts$/,'')===path.resolve('src/lib/supabase/client')?{path:'@/lib/supabase/client',namespace:'fixture'}:undefined);
 api.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='@/lib/supabase'?root:args.path.endsWith('/client')?root+'\nexport const isTestEnvironment=false;':args.path.endsWith('/legal')?'export const getCurrentLegalDocuments=async()=>({documents:{privacy:null,terms:null},error:null});':args.path.endsWith('/listings')?'export const getAllListings=async()=>({listings:[],error:null});export const getListing=async()=>({listing:null});export const getListingMediaUrls=async()=>({urls:[],error:null});':'export const getHotels=async()=>({hotels:[],error:null});export const getHotelById=async()=>({hotel:null});'}));
 api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind}));
}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});
fs.appendFileSync(out+'/fixture.css','');fs.writeFileSync(out+'/fixture.css',fs.readFileSync(out+'/fixture.css','utf8')+'\n'+css.css);

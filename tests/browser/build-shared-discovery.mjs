import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='test-results/shared-discovery-offline';fs.mkdirSync(out,{recursive:true});
// Keep mocks explicit about their purpose. Unknown API calls fail rather than
// confirming a write or inventing data. No production credentials are bundled.
const names=new Set();
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(/\.tsx?$/.test(p)){const source=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);for(const node of source.statements){if(ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='@/lib/supabase'){for(const n of node.importClause?.namedBindings?.elements||[])if(!n.isTypeOnly)names.add(n.propertyName?.text||n.name.text);}}}}}visit('src');
const code=`const call=(name,...args)=>window.__browseAPI(name,args);
export const supabase={rpc:(name,args)=>call('rpc:'+name,args),functions:{invoke:(name,args)=>call('edge:'+name,args)},auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:null}})},from:(table)=>{if(!['saved_searches','saved_hotels'].includes(table))throw new Error('Unexpected table '+table);return {select:()=>({order:()=>call('table:'+table)})};}};
${[...names].filter(n=>n!=='supabase').map(n=>`export const ${n}=(...args)=>call('${n}',...args);`).join('\n')}`;
await build({entryPoints:['tests/browser/shared-discovery.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'isolated-browse',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase$|^@\/lib\/supabase\/client$/},args=>({path:args.path,namespace:'fixture'}));
 api.onResolve({filter:/(^|\/)client(?:\.ts)?$/},args=>path.resolve(args.resolveDir,args.path).replace(/\.ts$/,'')===path.resolve('src/lib/supabase/client')?{path:args.path,namespace:'fixture'}:undefined);
 api.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:code+'\nexport const isTestEnvironment=false;'}));
 api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind}));
}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});fs.writeFileSync(out+'/fixture.css',css.css);

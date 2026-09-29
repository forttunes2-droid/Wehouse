import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const out='test-results/account-motion-offline';fs.mkdirSync(out,{recursive:true});
const mock=path.resolve('tests/browser/accountMotionClientFixture.ts');
const empty=path.resolve('tests/browser/accountMotionEmptyFixture.tsx');
await build({entryPoints:['tests/browser/account-motion-preview.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',
  plugins:[{name:'account-motion-offline',setup(api){api.onResolve({filter:/.*/},args=>{
    if(args.path==='@/lib/supabase')return {path:mock};
    if(['@/components/AccountHelpCenter','@/pages/PrivacySecuritySettings','@/components/MediaViewer'].includes(args.path))return {path:empty};
    if(args.path==='@/lib/supabase/legal')return {path:empty,namespace:'legal'};
    if(args.path==='@/lib/supabase/activity')return {path:empty,namespace:'activity'};
    if(args.path.startsWith('@/'))return api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind});
  });api.onLoad({filter:/.*/,namespace:'legal'},()=>({contents:'export const getCurrentLegalDocuments=async()=>({documents:{}})',loader:'js'}));
  api.onLoad({filter:/.*/,namespace:'activity'},()=>({contents:'export const getCanonicalActivitySummary=async()=>({summary:{unread:0},error:null})',loader:'js'}));
  }}],define:{'import.meta.env.DEV':'false','import.meta.env.PROD':'false'}});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});
fs.writeFileSync(out+'/fixture.css',css.css);

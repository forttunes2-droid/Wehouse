import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='test-results/partner-pro-offline';fs.mkdirSync(out,{recursive:true});
const client=path.resolve('tests/browser/partnerProClientFixture.ts');
await build({entryPoints:['tests/browser/partner-pro-preview.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'partner-pro-offline-client',setup(api){api.onResolve({filter:/.*/},args=>{
  if(['@/lib/supabase','@/lib/supabase/client'].includes(args.path))return {path:client};
  if(args.path.startsWith('@/'))return api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind});
})}}],define:{'import.meta.env.DEV':'false','import.meta.env.PROD':'false'}});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});
fs.writeFileSync(out+'/fixture.css',css.css);

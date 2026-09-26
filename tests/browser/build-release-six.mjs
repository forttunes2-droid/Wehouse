import { build } from 'esbuild';
import fs from 'node:fs';import path from 'node:path';import postcss from 'postcss';import tailwindcss from 'tailwindcss';import autoprefixer from 'autoprefixer';
const out='test-results/release-six-offline';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/release-six.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'release-six-fixture',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase$|^@\/lib\/supabase\/client$/},args=>({path:args.path,namespace:'fixture'}));
 api.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:
import {build} from 'esbuild';import fs from 'node:fs';import path from 'node:path';import postcss from 'postcss';import tailwindcss from 'tailwindcss';import autoprefixer from 'autoprefixer';
const out='test-results/media-viewport-offline';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/media-viewport.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',alias:{'@':path.resolve('src')},define:{'import.meta.env.DEV':'false','import.meta.env.PROD':'false'}});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});fs.writeFileSync(out+'/fixture.css',css.css);

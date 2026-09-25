import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='test-results/money-rules-offline';fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import CreatorBookingMoneyRules from './src/components/CreatorBookingMoneyRules';createRoot(document.getElementById('root')).render(<CreatorBookingMoneyRules/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'isolated-money-client',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase$|^@\/hooks\/useCreatorAuth$/},args=>({path:args.path,namespace:'fixture'}));
 api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('useCreatorAuth')?`export const useCreatorAuth=()=>({requestElevation:(scope,callback)=>{window.__moneyTest.elevations.push(scope);callback('test-only-elevation')}});`:`export const supabase={rpc:async(name,args)=>{const s=window.__moneyTest;s.calls.push({name,args});if(name.startsWith('creator_publish'))return {data:{changed_policy_count:1},error:null};if(s.mode==='thrown')throw new Error('Fixture network loss');if(s.mode==='error')return {data:null,error:{message:'Fixture denied'}};if(s.mode==='missing')return {data:{},error:null};if(s.mode==='partial'){const d=structuredClone(s.policy);delete d.active.commission_hotel;return {data:d,error:null}};if(s.mode==='null-price'){const d=structuredClone(s.policy);d.active.long_let_reservation_fee.value.amount=null;return {data:d,error:null}};return {data:s.policy,error:null};}};`,loader:'js'}));
 api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind}));
}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});fs.writeFileSync(out+'/fixture.css',css.css);

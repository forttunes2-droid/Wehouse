import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='test-results/private-chat-browser';fs.mkdirSync(out,{recursive:true});
const client=`
export const isWebPasskeyEnabled=true;
const state=()=>window.__chatState;
export const supabase={
 from:()=>{const query={select(){return query;},eq(){return query;},maybeSingle:async()=>({data:state().identity,error:null})};return query;},
 rpc:async(name,args={})=>{const s=state();s.calls.push(name);
  if(name==='current_profile_user_id')return{data:'chat-fixture',error:null};
  if(name==='create_my_automatic_private_identity'){s.identity={user_id:'chat-fixture',key_version:1,public_key_jwk:args.p_public_key_jwk,backup_scheme:'device_only',updated_at:'revision-1'};localStorage.setItem('fixture:identity',JSON.stringify(s.identity));return{data:s.identity,error:null};}
  if(name==='set_my_private_chat_backup'){Object.assign(s.identity,{backup_scheme:args.p_scheme,encrypted_private_key:args.p_encrypted_private_key,backup_iv:args.p_backup_iv,backup_salt:args.p_backup_salt,backup_credential_id:args.p_credential_id,backup_rp_id:args.p_rp_id,updated_at:'revision-2'});localStorage.setItem('fixture:identity',JSON.stringify(s.identity));return s.loseSave?{data:null,error:Error('The backup save response was interrupted. Check its status.')}:{data:{...s.identity,request_id:args.p_request_id},error:null};}
  if(name==='start_my_new_private_identity'){s.identity={...s.identity,key_version:s.identity.key_version+1,public_key_jwk:args.p_public_key_jwk,backup_scheme:'device_only',updated_at:'revision-3'};return{data:s.identity,error:null};}
  throw Error('Unexpected synthetic operation '+name);
 },
 auth:{passkey:{startRegistration:async()=>({data:{challenge_id:'fixture',options:{rp:{id:'localhost',name:'WeHouse fixture'},user:{id:'dXNlcg',name:'Synthetic',displayName:'Synthetic'},challenge:'Y2hhbGxlbmdl',pubKeyCredParams:[{type:'public-key',alg:-7}],excludeCredentials:state().passkeys.map(id=>({id,type:'public-key'}))}},error:null}),
  verifyRegistration:async args=>{if(JSON.stringify(args).includes('prf'))throw Error('PRF secret escaped to Auth');state().passkeys.push(args.credential.id);return{data:{id:'99500000-0000-4000-8000-000000000099'},error:null};}}}
};`;
await build({entryPoints:['tests/browser/private-chat.tsx'],bundle:true,outfile:out+'/fixture.js',format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'synthetic-private-chat',setup(api){
 api.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'client',namespace:'private-chat'}));
 api.onLoad({filter:/.*/,namespace:'private-chat'},()=>({contents:client,loader:'js'}));
 api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{kind:args.kind,resolveDir:process.cwd()}));
}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});fs.writeFileSync(out+'/fixture.css',css.css);
fs.writeFileSync(out+'/index.html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>WeHouse private chat checks</title><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');

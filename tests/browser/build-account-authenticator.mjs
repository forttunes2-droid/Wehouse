import {build} from 'esbuild';
import fs from 'node:fs';import path from 'node:path';
import postcss from 'postcss';import tailwindcss from 'tailwindcss';import autoprefixer from 'autoprefixer';
const out='test-results/account-authenticator';fs.mkdirSync(out,{recursive:true});
const mock=`const s=()=>window.__mfaTest;
const user=()=>({id:'auth-a',email:'mfa@example.invalid',email_confirmed_at:'confirmed'});
const track=name=>s().calls.push(name);
const factor=()=>({id:'personal-factor',status:'verified',factor_type:'totp',friendly_name:'Personal authenticator'});
export const supabase={
 auth:{initialize:async()=>({error:null}),getSession:async()=>({data:{session:s().signed?{user:user()}:null}}),getUser:async()=>({data:{user:user()}}),onAuthStateChange:cb=>{s().listener=cb;return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{s().signed=false;return{error:null}},
 mfa:{listFactors:async()=>({data:{totp:s().enrolled?[factor()]:[],all:s().enrolled?[factor()]:[]},error:null}),enroll:async()=>{track('enroll');if(s().enrolled)throw Error('Duplicate enrollment');return{data:{id:'new-factor',totp:{secret:'TEST-ONLY-SECRET',qr_code:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'}},error:null}},unenroll:async()=>{track('unenroll');return{error:null}},challengeAndVerify:async args=>{track('verify');if(args.code!=='123456')return{error:{message:'Incorrect code'}};s().enrolled=true;s().aal='aal2';if(s().emit)s().listener('MFA_CHALLENGE_VERIFIED',{user:user()});return{data:{},error:null}}}},
 rpc:async name=>{track(name);if(name==='get_my_authentication_requirements'){if(s().fail)return{error:{message:'Unavailable'}};return{data:{auth_id:'auth-a',required:s().required,enrolled:s().enrolled,stage:s().required&&!s().enrolled?'setup':s().enrolled&&s().aal!=='aal2'?'challenge':'ready'},error:null}}if(name==='get_public_account_support')return{data:{email:'support@example.invalid'},error:null};throw Error('Unexpected RPC '+name)},
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:'false'}})})})}),channel:()=>{const c={on:()=>c,subscribe:()=>c};return c},removeChannel:async()=>{}};
export const getProfileByAuthId=async()=>{track('profile');if(s().aal!=='aal2'&&(s().required||s().enrolled))throw Error('Profile loaded before MFA');return{profile:{auth_id:'auth-a',user_id:'person-a',role:'user',profile_complete:true}}};
export const registerUserSession=async()=>{track('device');return{sessionId:'device-a',trustStatus:'trusted'}};
export const getStoredSessionId=()=> 'device-a';export const getUserSessionState=async()=>({state:'active'});
export const updateSessionLastSeen=async()=>{};export const trackSession=async()=>{};export const endSession=async()=>{};export const createUserSession=async()=> 'device-a';export const clearStoredSessionId=()=>{};export const deactivateUserSession=async()=>{};export const clearPendingDevice=()=>{};export const createProfile=async()=>{throw Error('Unexpected profile create')};
`;
await build({entryPoints:['tests/browser/account-authenticator.tsx'],bundle:true,format:'iife',jsx:'automatic',outfile:out+'/fixture.js',plugins:[{name:'isolated-auth-transport',setup(api){api.onResolve({filter:/^@\/lib\/supabase(?:\/client)?$/},()=>({path:'mock',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:mock}));api.onResolve({filter:/^@\//},args=>api.resolve(path.resolve('src',args.path.slice(2)),{resolveDir:process.cwd(),kind:args.kind}));}}]});
const css=await postcss([tailwindcss(),autoprefixer()]).process(fs.readFileSync('src/index.css','utf8'),{from:'src/index.css'});fs.writeFileSync(out+'/fixture.css',css.css);

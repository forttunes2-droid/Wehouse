import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const out = 'test-results/release-six-offline';
fs.mkdirSync(out, { recursive: true });

const mock = [
  "const s=()=>window.__releaseSix;",
  "export const getStoredSessionId=()=> 'current-session';",
  "export const parseDeviceInfo=()=>({device:'Test phone',browser:'Chrome',os:'Android'});",
  "export const changePassword=async()=>({error:null});",
  "export const logPasswordChange=async()=>({error:null});",
  "export const supabase={",
  " rpc:async(name,args={})=>{const x=s();x.calls.push({name,args});",
  "  if(name==='get_my_property_management')return{data:x.management,error:null};",
  "  if(name==='set_my_property_management_mode'){x.management={...x.management,management_mode:args.p_mode,wehouse_management_status:args.p_mode==='host'?'not_required':'requested',management_host_user_id:args.p_mode==='host'?'owner-a':null};return{data:x.management,error:null};}",
  "  if(name==='set_property_responsible_host'){x.management={...x.management,management_mode:'host',management_host_user_id:args.p_user_id};return{data:x.management,error:null};}",
  "  if(name==='invite_property_host_manager')return{data:{success:true},error:null};",
  "  if(name==='revoke_property_host_manager')return{data:true,error:null};",
  "  if(name==='creator_security_status')return{data:{enrolled:false,totp_enrolled:false,locked_until:null},error:null};",
  "  if(name==='get_my_active_device_sessions')return{data:[{id:'current-session',device:'Test phone',browser:'Chrome',os:'Android',is_current:true,login_time:'2026-09-26T06:00:00Z',trust_status:'trusted'}],error:null};",
  "  return{data:null,error:null};},",
  " auth:{",
  "  getUser:async()=>({data:{user:{email_confirmed_at:'2026-09-01T00:00:00Z'}}}),",
  "  signOut:async()=>({error:null}),",
  "  mfa:{",
  "   listFactors:async()=>({data:{totp:[]},error:null}),",
  "   enroll:async()=>({data:{id:'factor-a',totp:{qr_code:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22/%3E',secret:'TEST-ONLY-SECRET'}},error:null}),",
  "   challenge:async()=>({data:{id:'challenge-a'},error:null}),",
  "   verify:async()=>({data:{},error:null}),",
  "   unenroll:async()=>({error:null})",
  "  }",
  " },",
  " functions:{invoke:async()=>({data:{success:true,mfa_enrolled:false},error:null})}",
  "};"
].join('\n');

await build({
  entryPoints: ['tests/browser/release-six.tsx'],
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  outfile: out + '/fixture.js',
  plugins: [{
    name: 'release-six-fixture',
    setup(api) {
      api.onResolve({ filter: /^@\/lib\/supabase$|^@\/lib\/supabase\/client$/ }, (args) => ({
        path: args.path,
        namespace: 'fixture',
      }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        loader: 'js',
        contents: mock,
      }));
      api.onResolve({ filter: /^@\// }, (args) =>
        api.resolve(path.resolve('src', args.path.slice(2)), {
          resolveDir: process.cwd(),
          kind: args.kind,
        }),
      );
    },
  }],
});

const css = await postcss([tailwindcss(), autoprefixer()]).process(
  fs.readFileSync('src/index.css', 'utf8'),
  { from: 'src/index.css' },
);
fs.writeFileSync(out + '/fixture.css', css.css);

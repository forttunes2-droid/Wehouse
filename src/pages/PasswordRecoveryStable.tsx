import { useEffect,useRef,useState } from 'react';
import { resetPassword,supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';

type Stage='preparing'|'ready'|'failed'|'sent'|'done';

function decode(value:string|null){if(!value)return'';try{return decodeURIComponent(value.replace(/\+/g,' '))}catch{return value}}
function recoveryError(raw:string){const msg=raw.toLowerCase();if(msg.includes('code verifier')||msg.includes('pkce'))return'This older reset link was opened outside the browser where it was requested. Request a new link below; new WeHouse reset links can be opened from your email normally.';if(msg.includes('expired')||msg.includes('invalid')||msg.includes('one-time')||msg.includes('otp'))return'This reset link has expired or was already used. Request a new reset link below.';if(msg.includes('network')||msg.includes('fetch'))return'We could not reach the authentication service. Check your connection and try again.';if(msg.includes('timeout'))return'The secure reset session took too long to start. Request a new link below.';return'We could not open this password reset link securely. Request a new reset link below.'}
function withTimeout<T>(promise:Promise<T>,ms:number):Promise<T>{return Promise.race([promise,new Promise<T>((_,reject)=>window.setTimeout(()=>reject(new Error('Timeout')),ms))])}

export default function PasswordRecoveryStable(){
 const[stage,setStage]=useState<Stage>('preparing'),[error,setError]=useState(''),[info,setInfo]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[email,setEmail]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false);
 const ran=useRef(false);

 useEffect(()=>{if(ran.current)return;ran.current=true;let alive=true;let timer:number|undefined;
  const ready=()=>{if(!alive)return;setError('');setStage('ready')};
  const fail=(message:string)=>{if(!alive)return;setStage('failed');setError(recoveryError(message))};
  async function prepare(){
   try{
    const url=new URL(window.location.href),query=url.searchParams,hash=new URLSearchParams(url.hash.startsWith('#')?url.hash.slice(1):url.hash);
    const urlError=decode(query.get('error_description')||hash.get('error_description')||query.get('error')||hash.get('error'));
    if(urlError){fail(urlError);return}
    const current=await withTimeout(supabase.auth.getSession(),8000);
    if(current.error)throw current.error;
    if(current.data.session?.user){ready();return}

    const accessToken=hash.get('access_token'),refreshToken=hash.get('refresh_token');
    if(accessToken&&refreshToken){
      const result=await withTimeout(supabase.auth.setSession({access_token:accessToken,refresh_token:refreshToken}),10000);
      if(result.error)throw result.error;
      if(result.data.session?.user){window.history.replaceState({},'',`${window.location.pathname}?auth=recovery`);ready();return}
    }

    // Keep compatibility with recovery links generated before the WeHouse
    // browser-independent reset flow was introduced.
    const code=query.get('code');
    if(code){
      const result=await withTimeout(supabase.auth.exchangeCodeForSession(code),10000);
      if(result.error)throw result.error;
      if(result.data.session?.user){window.history.replaceState({},'',`${window.location.pathname}?auth=recovery`);ready();return}
    }

    timer=window.setTimeout(()=>fail('Timeout'),8000);
   }catch(e:any){fail(e?.message||'Password recovery failed')}
  }
  const{data:listener}=supabase.auth.onAuthStateChange((event,session)=>{if(!alive)return;if((event==='PASSWORD_RECOVERY'||event==='SIGNED_IN'||event==='INITIAL_SESSION')&&session?.user)ready()});
  void prepare();
  return()=>{alive=false;if(timer)window.clearTimeout(timer);listener.subscription.unsubscribe()}
 },[]);

 async function updatePassword(e:React.FormEvent){e.preventDefault();setError('');setInfo('');if(password.length<8)return setError('New password must be at least 8 characters.');if(password!==confirm)return setError('The two passwords do not match.');setBusy(true);try{const{data:{session}}=await supabase.auth.getSession();if(!session?.user){setStage('failed');return setError('The secure reset session has ended. Request a new link below.')}const{error:err}=await supabase.auth.updateUser({password});if(err)return setError(err.message);window.history.replaceState({},'',window.location.pathname);setStage('done');setInfo('Password updated successfully. Opening your WeHouse account…');window.setTimeout(()=>window.location.replace(`${window.location.origin}/`),500)}catch(e:any){setError(e?.message||'Could not update password.')}finally{setBusy(false)}}

 async function sendNewLink(e:React.FormEvent){e.preventDefault();setError('');setInfo('');const clean=email.trim();if(!clean.includes('@'))return setError('Enter the email address on your WeHouse account.');setBusy(true);try{try{await supabase.auth.signOut({scope:'local'})}catch{}const{error:err}=await resetPassword(clean);if(err)return setError(err.message);setStage('sent');setInfo('A new reset link has been sent. Open the newest WeHouse email; older reset links will no longer work.')}catch(e:any){setError(e?.message||'Could not send a new reset link.')}finally{setBusy(false)}}

 function cancel(){try{window.history.replaceState({},'',window.location.pathname)}catch{}window.location.replace(`${window.location.origin}/`)}

 return <div className="flex min-h-screen items-center justify-center bg-transparent px-5 text-white"><div className="w-full max-w-[390px]">
  <Brand/>
  <div className="rounded-3xl border border-white/[.07] bg-[#10131A] p-5 shadow-2xl shadow-black/20">
   <p className="text-[9px] font-bold uppercase tracking-[.18em] text-blue-400">ACCOUNT RECOVERY</p><h1 className="mt-1 text-xl font-bold">Choose a new password</h1><p className="mt-1 text-[10px] leading-5 text-[#747A8C]">WeHouse verifies the secure email link before allowing a password change.</p>

   {stage==='preparing'&&<div className="mt-5 rounded-2xl border border-blue-500/15 bg-blue-500/[.06] p-4"><p className="text-xs font-semibold text-blue-200">Preparing secure reset…</p><p className="mt-1 text-[9px] leading-4 text-[#838A9B]">This should finish automatically. It will not stay on this screen indefinitely.</p></div>}

   {(stage==='ready'||stage==='done')&&<form onSubmit={updatePassword} className="mt-5 space-y-4">{error&&<Notice tone="error">{error}</Notice>}{info&&<Notice>{info}</Notice>}<PasswordField label="New password" value={password} set={setPassword} visible={show} toggle={()=>setShow(v=>!v)}/><PasswordField label="Confirm new password" value={confirm} set={setConfirm} visible={show} toggle={()=>setShow(v=>!v)}/><button type="submit" disabled={busy||stage==='done'} className="h-12 w-full rounded-xl bg-blue-500 text-sm font-semibold disabled:opacity-40">{busy?'Updating…':stage==='done'?'Password updated':'Update password'}</button></form>}

   {(stage==='failed'||stage==='sent')&&<form onSubmit={sendNewLink} className="mt-5 space-y-4">{error&&<Notice tone="error">{error}</Notice>}{info&&<Notice>{info}</Notice>}<label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#8B90A0]">Account email</span><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required className="h-12 rounded-xl border-white/[.08] bg-[#171A23] text-white"/></label><button type="submit" disabled={busy} className="h-12 w-full rounded-xl bg-blue-500 text-sm font-semibold disabled:opacity-40">{busy?'Sending…':'Send a new reset link'}</button></form>}

   <button type="button" onClick={cancel} className="mt-4 w-full text-center text-xs text-[#6C7282]">Return to sign in</button>
  </div>
 </div></div>
}

function Brand(){return <div className="mb-7 text-center"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/15"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg></div><h2 className="text-2xl font-bold">WeHouse</h2><p className="mt-1 text-xs text-[#5C6172]">We make living easy</p></div>}
function PasswordField({label,value,set,visible,toggle}:{label:string;value:string;set:(v:string)=>void;visible:boolean;toggle:()=>void}){return <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-[#8B90A0]">{label}</span><div className="relative"><Input type={visible?'text':'password'} value={value} onChange={e=>set(e.target.value)} placeholder="Minimum 8 characters" minLength={8} required className="h-12 rounded-xl border-white/[.08] bg-[#171A23] pr-12 text-white"/><button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#777C8C]">{visible?'Hide':'Show'}</button></div></label>}
function Notice({children,tone='info'}:{children:React.ReactNode;tone?:'info'|'error'}){const cls=tone==='error'?'border-red-500/20 bg-red-500/10 text-red-300':'border-blue-500/20 bg-blue-500/10 text-blue-300';return <div className={`rounded-xl border p-3 text-xs leading-relaxed ${cls}`}>{children}</div>}

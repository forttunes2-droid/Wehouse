import {useEffect,useRef,useState} from 'react';
import {nativePushPlatform,phonePushStatus,setPhonePush} from '@/lib/nativePush';
import {toast} from 'sonner';
import SettingSwitch from '@/components/SettingSwitch';

export default function PhoneNotificationSettings({userId}:{userId:string}){
 const [status,setStatus]=useState<Awaited<ReturnType<typeof phonePushStatus>>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const locked=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;let active=true;setStatus(null);setError('');void phonePushStatus(userId).then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('Phone notification status could not be loaded.');});return()=>{active=false;alive.current=false;};},[userId,reload]);
 async function change(){
  if(!status||locked.current)return;locked.current=true;setBusy(true);setError('');
  try {await setPhonePush(userId,!status.enabled);if(alive.current){const next=await phonePushStatus(userId);if(alive.current){setStatus(next);toast.success(status.enabled?'Phone notifications turned off':'Phone notifications enabled');}}}
  catch(failure){if(alive.current)setError((failure as {message?:string})?.message||'The notification change could not be confirmed. Refresh before retrying.');}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <section aria-label="Phone notifications" className="border-t border-[var(--wh-border-subtle)] px-4 py-4 sm:px-5">
  <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold">Phone notifications</h3><p className="mt-1 text-[13px] leading-5 text-[var(--wh-text-secondary)]">Receive WeHouse updates when the app is in the background or closed. This setting applies to this phone.</p></div>
   {status?.available&&<SettingSwitch label="Phone notifications" checked={status.enabled} disabled={busy} onChange={()=>void change()}/>}
  </div>
  {!nativePushPlatform()?<p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Available in the Android and iOS app. Browser alerts while WeHouse is open use In-app alerts.</p>:!status&&!error?<p role="status" className="mt-2 text-xs">Checking this phone...</p>:status&&!status.available?<p role="status" className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Not activated for this app yet. In-app alerts and Inbox still work.</p>:status?.permission==='denied'?<p className="mt-2 text-xs leading-5 text-[var(--wh-danger-text)]">Notifications are blocked in your phone settings. You can still turn off WeHouse delivery here.</p>:null}
  {error&&<p role="alert" className="mt-2 text-sm text-[var(--wh-danger-text)]">{error}</p>}
  {nativePushPlatform()&&<button type="button" disabled={busy} className="mt-2 min-h-11 text-xs font-semibold text-[var(--wh-accent-text)] disabled:opacity-50" onClick={()=>setReload(value=>value+1)}>Refresh phone status</button>}
  <p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Lock-screen alerts hide message text and payment details. Tap an alert to open your Inbox. Phone settings and network conditions can delay delivery.</p>
 </section>;
}

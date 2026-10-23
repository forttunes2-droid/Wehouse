import { useEffect, useRef, useState } from 'react';
import SettingSwitch from '@/components/SettingSwitch';
import { getCallPreferences, setCallPreferences, type CallPreferences } from '@/lib/private-calls';
import { withTimeout } from '@/lib/withTimeout';

const valid=(value:CallPreferences|null):value is CallPreferences=>Boolean(value && typeof value.allow_audio_calls==='boolean' && typeof value.allow_video_calls==='boolean');
export default function PrivateCallSettings(){
  const [preferences,setPreferences]=useState<CallPreferences|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const locked=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let current=true;setPreferences(null);setError('');
    void withTimeout(getCallPreferences(),10000,'Call settings could not be loaded.').then(result=>{
      if(!current)return;
      if(result.error||!valid(result.preferences))throw new Error('Call settings could not be loaded.');
      setPreferences(result.preferences);
    }).catch(reason=>{if(current)setError(reason.message||'Call settings could not be loaded.');});
    return()=>{current=false;};
  },[reload]);
  async function change(key:keyof CallPreferences,value:boolean){
    if(locked.current||!preferences)return;
    locked.current=true;setBusy(true);setError('');
    const next={...preferences,[key]:value};
    try{
      const result=await withTimeout(setCallPreferences(next.allow_audio_calls,next.allow_video_calls),10000,'Saving took too long. Reload call settings before retrying.');
      if(result.error||!valid(result.preferences)||result.preferences.allow_audio_calls!==next.allow_audio_calls||result.preferences.allow_video_calls!==next.allow_video_calls)
        throw new Error(result.error?.message||'The saved call settings could not be confirmed.');
      if(alive.current)setPreferences(result.preferences);
    }catch(reason){if(alive.current){setPreferences(null);setError(reason instanceof Error?reason.message:'Call settings could not be saved.');}}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  return <section aria-labelledby="private-call-settings" className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)] sm:p-5">
    <h2 id="private-call-settings" className="text-sm font-semibold">Incoming calls</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Choose whether eligible people in your private conversations can call you. This does not let strangers call you or change your device's microphone and camera permissions.</p>
    {error?<div role="alert" className="mt-3 text-sm"><p>{error}</p><button type="button" disabled={busy} onClick={()=>setReload(value=>value+1)} className="wh-motion-control mt-2 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 font-semibold">Reload call settings</button></div>:!preferences?<p role="status" className="mt-3 text-sm">Loading call settings…</p>:<div aria-busy={busy}>
      {(['allow_audio_calls','allow_video_calls'] as const).map(key=><div key={key} className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--wh-border-subtle)] py-3 last:border-0"><span className="text-sm font-medium">{key==='allow_audio_calls'?'Audio calls':'Video calls'}</span><SettingSwitch label={key==='allow_audio_calls'?'Allow incoming audio calls':'Allow incoming video calls'} checked={preferences[key]} disabled={busy} onChange={value=>void change(key,value)}/></div>)}
      <p role="status" className="text-xs text-[var(--wh-text-secondary)]">{busy?'Saving…':'Settings apply to future incoming calls.'}</p>
    </div>}
  </section>;
}

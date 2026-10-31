import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {encryptionIdentityStatus, onPrivateMessageAccessChange, removePrivateChatBackup, restorePrivateChatPasskeyBackup, savePrivateChatPasskeyBackup, startPrivateChatsWithoutHistory, unlockEncryptionIdentity} from '@/lib/e2ee';
import {passkeyBackupAvailable} from '@/lib/privatePasskeyBackup';
import {AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle} from '@/components/ui/alert-dialog';

type Status=Awaited<ReturnType<typeof encryptionIdentityStatus>>;
export default function SecureMessagesPanel({recoveryOnly=false,onReady}:{recoveryOnly?:boolean;onReady?:()=>void}){
  const [status,setStatus]=useState<Status|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [legacyPin,setLegacyPin]=useState(''),[legacyOpen,setLegacyOpen]=useState(false),[confirmation,setConfirmation]=useState<'restart'|'remove'|null>(null);
  const refresh=useCallback(async()=>{
    setLoading(true);
    try{const result=await encryptionIdentityStatus();if(result.error)throw result.error;setStatus(result);setError('');return result;}
    catch(reason){setError(reason instanceof Error?reason.message:'Private chat could not be checked. Try again.');return null;}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return onPrivateMessageAccessChange(()=>{void refresh();});},[refresh]);
  async function action(run:()=>Promise<unknown>,success:string){
    if(busy)return;setBusy(true);setError('');
    try{await run();setLegacyPin('');setConfirmation(null);const next=await refresh();if(next){toast.success(success);if(next.unlocked)onReady?.();}}
    catch(reason){const message=reason instanceof Error?reason.message:'This change could not be confirmed. Check its status and try again.';setError(message);toast.error(message);}
    finally{setBusy(false);}
  }
  const available=passkeyBackupAvailable();
  const button='min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
  const primary=`${button} bg-violet-600 text-white dark:bg-violet-500`;
  return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 text-left text-[var(--wh-text)] sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="min-w-0 flex-1 text-base font-semibold">{recoveryOnly?'Your private chats':'Private chat encryption'}</h2>
      {status&&<span className="rounded-full bg-[var(--wh-interactive)] px-3 py-1 text-xs font-medium">{status.unlocked?'Device ready':'Recovery needed'}</span>}
    </div>
    <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{status?.unlocked?'Messages are encrypted automatically on this device. You don’t need another WeHouse PIN.':'Restore your chat backup to read your previous messages on this device.'}</p>
    {loading&&<p role="status" className="mt-4 text-sm text-[var(--wh-text-secondary)]">Checking this device…</p>}
    {error&&<div role="alert" className="mt-4 rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-sm leading-6 text-red-700 dark:text-red-300">{error}<button type="button" disabled={busy} onClick={()=>void refresh()} className="mt-2 block min-h-10 font-semibold underline">Check current status</button></div>}
    {!loading&&!status&&<button type="button" className={`${button} mt-4`} onClick={()=>void refresh()}>Try again</button>}
    {status&&!status.unlocked&&<div className="mt-5 space-y-3">
      {status.backupScheme==='passkey_prf_v1'&&<button type="button" disabled={busy||!available} className={`${primary} w-full`} onClick={()=>void action(restorePrivateChatPasskeyBackup,'Chat backup restored on this device')}>Restore with passkey</button>}
      {status.backupScheme==='pin_v1'&&<><button type="button" disabled={busy} className={`${button} w-full`} onClick={()=>setLegacyOpen(v=>!v)}>Restore an older passcode backup</button>
        {legacyOpen&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();void action(()=>unlockEncryptionIdentity(legacyPin),'Previous chat keys restored');}}>
          <label className="block text-sm">Previous six-digit passcode<input aria-label="Previous six-digit passcode" type="password" inputMode="numeric" autoComplete="off" value={legacyPin} onChange={event=>setLegacyPin(event.target.value.replace(/\D/g,'').slice(0,6))} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3" /></label>
          <button disabled={busy||legacyPin.length!==6} className={`${primary} w-full`}>Restore older backup</button>
        </form>}</>}
      <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">No usable backup? You can start new private chats. Previous messages remain stored but won’t be readable here without their original keys. The other person keeps their existing access.</p>
      <button type="button" disabled={busy} className={`${button} w-full`} onClick={()=>setConfirmation('restart')}>Continue without previous history</button>
    </div>}
    {status?.unlocked&&!recoveryOnly&&<div className="mt-5 border-t border-[var(--wh-border-subtle)] pt-5">
      <h3 className="text-sm font-semibold">Optional history backup</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{status.backupScheme==='passkey_prf_v1'?'Passkey backup is on. Use the same passkey to restore these chat keys on another device.':status.backupScheme==='pin_v1'?'Your older passcode backup still exists. Replace it with a compatible passkey to stop relying on those six digits.':'Keep an encrypted copy of your chat keys with a compatible passkey. Without a backup or your original device, WeHouse cannot restore private message history.'}</p>
      {available?<div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={primary} onClick={()=>void action(()=>savePrivateChatPasskeyBackup(), 'Passkey chat backup saved')}>{status.backupScheme==='passkey_prf_v1'?'Replace passkey backup':'Use existing passkey'}</button>
        <button type="button" disabled={busy} className={button} onClick={()=>void action(()=>savePrivateChatPasskeyBackup(true),'Passkey chat backup saved')}>Create a passkey for backup</button>
      </div>:<p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">Passkey backup is unavailable on this browser or sign-in service. Private chats still work on this device.</p>}
      {status.backupScheme!=='device_only'&&<button type="button" disabled={busy} className={`${button} mt-3`} onClick={()=>setConfirmation('remove')}>Remove encrypted backup</button>}
    </div>}
    {status?.unlocked&&recoveryOnly&&<button type="button" disabled={busy} className={`${primary} mt-4 w-full`} onClick={onReady}>Continue to chat</button>}
    {!recoveryOnly&&<p className="mt-5 text-xs leading-5 text-[var(--wh-text-muted)]">Friend, Roommate and Service chat text and files are encrypted on your device. Hotel and WeHouse Support conversations are available to their authorised teams. Site-storage removal can erase this device’s keys.</p>}
    {busy&&<p role="status" className="mt-3 text-sm text-[var(--wh-text-secondary)]">Completing your request…</p>}
    <AlertDialog open={confirmation!==null} onOpenChange={open=>{if(!open&&!busy)setConfirmation(null);}}><AlertDialogContent className="border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] text-[var(--wh-text)]"><AlertDialogHeader>
      <AlertDialogTitle>{confirmation==='restart'?'Start without previous history?':'Remove your encrypted backup?'}</AlertDialogTitle>
      <AlertDialogDescription className="text-[var(--wh-text-secondary)]">{confirmation==='restart'?'This replaces the current chat identity and its recovery backup. Unavailable previous history cannot be restored with the new keys. Saved keys and messages on your other devices and the other person’s history are retained.':'Chats on this device remain available. If you lose its keys, this backup will no longer recover them. This does not delete the passkey from your device or remove it from account sign-in.'}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Go back</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event=>{event.preventDefault();void action(confirmation==='restart'?startPrivateChatsWithoutHistory:removePrivateChatBackup,confirmation==='restart'?'Private chats are ready on this device':'Encrypted backup removed');}} className="min-h-11 bg-violet-600 text-white dark:bg-violet-500">{busy?'Working…':confirmation==='restart'?'Start new chats':'Remove backup'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

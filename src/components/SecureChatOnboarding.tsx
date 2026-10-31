import SecureMessagesPanel from '@/components/SecureMessagesPanel';
import type {PrivateConversationReadiness} from '@/lib/e2ee';

export default function SecureChatOnboarding({status,personName,onReady}:{status:PrivateConversationReadiness;personName:string;onReady:()=>void}){
  if(status.state==='setup_required'||status.state==='unlock_required')return <SecureMessagesPanel recoveryOnly onReady={onReady}/>;
  return <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-[var(--wh-text)]">
    <h2 className="text-sm font-semibold">{status.state==='peer_setup_required'?`Waiting for ${personName}`:'Private chats are temporarily unavailable'}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">{status.state==='peer_setup_required'?`${personName} needs to open private chats on a trusted device before you can send encrypted messages.`:status.message}</p>
    <button type="button" onClick={onReady} className="mt-4 min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">Check again</button>
  </section>;
}

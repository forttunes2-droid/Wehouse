import SharedPropertyCard from "@/components/SharedPropertyCard";
import { ChevronRight, Copy, Search, Share2, Users } from "lucide-react";
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getRoommateConversationPeople } from '@/lib/supabase/chat';
import { selectRoommateRecipientsFromPeers, type RoommateRecipient } from '@/lib/roommateRecipients';
import { propertyShareUrl, queuePropertyShare, sharePropertyExternally, type SharedProperty } from '@/lib/propertyShare';
import { withTimeout } from '@/lib/withTimeout';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import BackButton from '@/components/BackButton';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';
import { toast } from 'sonner';

type Props = { userId: string; property: SharedProperty; title: string; onClose: () => void; onConversation: (id: string) => void };
export default function PropertyShareDialog({ userId, property, title, onClose, onConversation }: Props) {
  const [recipients, setRecipients] = useState<RoommateRecipient[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [query, setQuery] = useState('');
  const [sharing, setSharing] = useState(false);
  const dismiss = useRecordScreenBack(onClose);
  const dialogRef = useDialogInteraction(dismiss);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setRecipients([]);
    void (async () => {
      try {
        const peers = await withTimeout(getRoommateConversationPeople(), 15000, 'Connections took too long to load.');
        if (!active) return;
        if (peers.error) throw peers.error;
        setRecipients(selectRoommateRecipientsFromPeers(userId, peers.connections));
      } catch { if (active) setError('Your connections could not be loaded. Please try again.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [userId, attempt]);
  const visible = recipients.filter(person => `${person.name} ${person.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function copyLink() {
    try { await navigator.clipboard.writeText(propertyShareUrl(property)); toast.success('Property link copied'); }
    catch { toast.error('Could not copy the link on this device'); }
  }
  async function shareViaApps() {
    if (sharing) return;
    setSharing(true);
    try { const result = await sharePropertyExternally(property, title); if (result === 'copied') toast.success('Property link copied'); }
    catch { toast.error('This property could not be shared'); }
    finally { setSharing(false); }
  }
  return createPortal(<div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100060] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" role="presentation" onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <section role="dialog" aria-modal="true" aria-label="Share property" className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#10131B] text-white sm:max-h-[90dvh] sm:rounded-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[.07] px-4 py-3"><BackButton onClick={dismiss} ariaLabel="Back to property" /><div><h2 className="text-lg font-semibold">Share this place</h2><p className="text-xs text-[#A3A8B7]">Send a listing link to someone you know</p></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">
      <div className="mt-4" aria-label={`Sharing ${title}`}><SharedPropertyCard property={property} compact /></div>
      <section className="mt-5" aria-label="Share a link outside WeHouse">
        <h3 className="text-sm font-semibold">Share a link</h3>
        <p className="mt-1 text-xs leading-5 text-[#A3A8B7]">Anyone with the link can view a published place. No booking or payment is created.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={sharing} onClick={() => void shareViaApps()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-semibold disabled:opacity-50"><Share2 size={17} aria-hidden="true" />Share via apps</button>
          <button type="button" onClick={() => void copyLink()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-semibold text-violet-200"><Copy size={17} aria-hidden="true" />Copy link</button>
        </div>
      </section>
      <section className="mt-6 border-t border-white/10 pt-5" aria-label="Send within WeHouse">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Users size={17} aria-hidden="true" className="text-violet-300" />Send in WeHouse</h3>
      <p className="mt-1 text-xs leading-5 text-[#A3A8B7]">Choose a roommate connection. You can add a message before sending.</p>
      <label className="mt-3 block"><span className="sr-only">Search your connections</span><span className="flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#191C25] px-3"><Search size={18} aria-hidden="true" className="shrink-0 text-[#AAA3B3]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search connections" className="min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none" /></span></label>
      {loading ? <p role="status" className="py-8 text-sm text-[#AAA3B3]">Loading your connections…</p> : <>
        {error && <div role="alert" className="py-4 text-sm text-[#AAA3B3]"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)} className="min-h-11 font-semibold text-violet-300">Refresh connections</button></div>}
        <div className="mt-3 divide-y divide-white/[.06]">{visible.map(person => <button key={person.userId} type="button" onClick={() => {
          queuePropertyShare(userId, person.conversationId, property);
          // The normal conversation (and its existing PIN gate) owns Send.
          onClose(); onConversation(person.conversationId);
        }} className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-semibold text-violet-200">{person.avatar ? <img src={person.avatar} alt="" className="h-full w-full object-cover" /> : person.name[0]?.toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold">{person.name}</span>{person.username && <span className="mt-1 block break-words text-sm text-[#AAA3B3]">@{person.username}</span>}</span>
          <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-violet-300" />
        </button>)}</div>
        {!visible.length && !error && <p className="py-8 text-sm leading-6 text-[#AAA3B3]">{query.trim() ? 'No connections match that name.' : 'No roommate connections yet. You can still share the public link above.'}</p>}
      </>}
      </section>
      </div>
      <p className="shrink-0 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs leading-5 text-[#A3A8B7]">Want to split a Short Let stay? Reserve the dates first, then open your booking and choose “Share stay costs.”</p>
    </section>
  </div>, document.body);
}

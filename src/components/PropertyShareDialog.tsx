import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getConversations, getRoommateConversationPeople } from '@/lib/supabase/chat';
import { selectRoommateRecipients, type RoommateRecipient } from '@/lib/roommateRecipients';
import { queuePropertyShare, type SharedProperty } from '@/lib/propertyShare';
import { withTimeout } from '@/lib/withTimeout';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import BackButton from '@/components/BackButton';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';

type Props = { userId: string; property: SharedProperty; title: string; onClose: () => void; onConversation: (id: string) => void };
export default function PropertyShareDialog({ userId, property, title, onClose, onConversation }: Props) {
  const [recipients, setRecipients] = useState<RoommateRecipient[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [query, setQuery] = useState('');
  const dismiss = useRecordScreenBack(onClose);
  const dialogRef = useDialogInteraction(dismiss);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setRecipients([]);
    void (async () => {
      try {
        const [chats, peers] = await withTimeout(Promise.all([getConversations(userId), getRoommateConversationPeople()]), 15000, 'Connections took too long to load.');
        if (!active) return;
        if (chats.error || peers.error) throw chats.error || peers.error;
        const result = selectRoommateRecipients(userId, chats.conversations, peers.people);
        setRecipients(result.recipients);
        if (result.missingIdentityCount) setError('Some connection names could not be loaded. Refresh to see them.');
      } catch { if (active) setError('Your connections could not be loaded. Please try again.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [userId, attempt]);
  const visible = recipients.filter(person => `${person.name} ${person.username}`.toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(<div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100060] flex items-end justify-center bg-[#090B10] sm:items-center sm:p-5" role="presentation" onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <section role="dialog" aria-modal="true" aria-label="Send property" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/[.08] bg-[#10131B] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white sm:rounded-3xl">
      <header className="flex items-center gap-3"><BackButton onClick={dismiss} ariaLabel="Back to property" /><h2 className="text-lg font-semibold">Send property</h2></header>
      <p className="mt-4 break-words text-base font-medium">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#AAA3B3]">Choose a connection. You can add a message before sending. This does not start a reservation or split costs.</p>
      <label className="mt-5 block text-sm text-[#AAA3B3]">Your connections<input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or username" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#191C25] px-3 text-base text-white outline-none focus:border-violet-400" /></label>
      {loading ? <p role="status" className="py-8 text-sm text-[#AAA3B3]">Loading your connections…</p> : <>
        {error && <div role="alert" className="py-4 text-sm text-[#AAA3B3]"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)} className="min-h-11 font-semibold text-violet-300">Refresh connections</button></div>}
        <div className="mt-3 divide-y divide-white/[.06]">{visible.map(person => <button key={person.userId} type="button" onClick={() => {
          queuePropertyShare(userId, person.conversationId, property);
          // The normal conversation (and its existing PIN gate) owns Send.
          onClose(); onConversation(person.conversationId);
        }} className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 font-semibold text-violet-200">{person.avatar ? <img src={person.avatar} alt="" className="h-full w-full object-cover" /> : person.name[0]?.toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold">{person.name}</span>{person.username && <span className="mt-1 block break-words text-sm text-[#AAA3B3]">@{person.username}</span>}</span>
          <span aria-hidden="true" className="text-violet-300">→</span>
        </button>)}</div>
        {!visible.length && !error && <p className="py-8 text-sm leading-6 text-[#AAA3B3]">{query.trim() ? 'No connections match that name.' : 'Connect with someone in Roommates first, then send them a place here.'}</p>}
      </>}
    </section>
  </div>, document.body);
}

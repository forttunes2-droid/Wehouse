import { useEffect, useRef, useState } from 'react';
import { getMySharedHousingGroups, type SharedHousingGroup } from '@/lib/supabase/shared-housing';
import { sharedHousingLane } from '@/lib/sharedHousingPresentation';
import SharedHousingDetails from '@/components/SharedHousingDetails';
import { withTimeout } from '@/lib/withTimeout';

/** Roommates and Bookings open the same member-authorised payment record. */
export default function SharedHomeLifecyclePanel({ profileId, onOpenConversation, onOpenListing }: {
  profileId: string; onOpenConversation?: (id: string) => void; onOpenListing?: (id: string) => void;
}) {
  const [groups, setGroups] = useState<SharedHousingGroup[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => { setSelected(null); setGroups([]); }, [profileId]);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true); setError('');
    void withTimeout(getMySharedHousingGroups(), 15000, 'Shared payments took too long.').then(result => {
      if (current !== generation.current) return;
      if (result.error) throw result.error;
      setGroups((result.groups as SharedHousingGroup[]).filter(group => group.members?.some(member => member.user_id === profileId)));
    }).catch(() => { if (current === generation.current) setError('Your shared payments could not be loaded. Please try again.'); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [profileId, attempt]);
  if (loading && !groups.length) return <p role="status" className="py-5 text-sm text-[#AAA3B3]">Loading shared payments…</p>;
  if (!groups.length && !error) return null;
  return <section className="space-y-3">
    <header><h2 className="text-base font-semibold">Shared homes</h2><p className="mt-2 text-sm leading-6 text-[#AAA3B3]">Review the people, invitation and individual payment shares together.</p></header>
    {error && <div role="alert" className="text-sm leading-6 text-amber-200"><p>{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)} className="min-h-11 font-semibold underline">Try again</button></div>}
    <div className="divide-y divide-white/10 border-y border-white/10">{groups.map(group => {
      const mine = group.members.find(member => member.user_id === profileId);
      const lane = sharedHousingLane(group, profileId);
      return <article key={group.id} className="py-4">
        <button type="button" onClick={() => setSelected(group.id)} className="flex min-h-16 w-full items-start gap-3 text-left">
          {group.listing?.image && <img src={group.listing.image} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />}
          <span className="min-w-0 flex-1"><span className="block text-sm text-violet-300">{group.product_type === 'short_let' ? 'Short Let' : 'Long Let'} · {lane === 'action' ? 'Needs your action' : lane === 'history' ? 'Payment history' : 'Shared reservation'}</span>
            <span className="mt-1 block break-words text-base font-semibold">{group.listing?.title || 'Shared home'}</span>
            <span className="mt-1 block break-words text-sm leading-6 text-[#AAA3B3]">With {group.members.filter(member => member.user_id !== profileId).map(member => member.name).join(', ') || 'your connections'}</span>
            <span className="mt-2 block text-sm">Your share: ₦{Number(mine?.share_amount || 0).toLocaleString()} · {mine?.payment_status === 'paid' ? 'Paid' : 'View payment details'}</span>
          </span><span aria-hidden="true" className="text-violet-300">›</span>
        </button>
        {group.conversation_id && onOpenConversation && <button type="button" onClick={() => onOpenConversation(group.conversation_id!)} className="mt-2 min-h-11 text-sm font-semibold text-violet-300">Open connected conversation</button>}
      </article>;
    })}</div>
    {selected && <SharedHousingDetails groupId={selected} userId={profileId} onBack={() => { setSelected(null); setAttempt(n => n + 1); }} onChanged={() => setAttempt(n => n + 1)} onOpenListing={onOpenListing} />}
  </section>;
}

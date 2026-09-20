import { useRpcRead } from '@/hooks/useRpcRead';

type Summary = {
  accounts: number; partners: number; workers: number; team: number;
  apartments: number; hotels: number; hotel_team: number;
  pending_reviews: number; inspections: number; payouts: number;
};
type Destination = 'people' | 'team' | 'properties' | 'workers' | 'finance';

export default function CreatorOverview({ userId, onOpen }: { userId: string; onOpen: (destination: Destination, id?: string) => void }) {
  const { data, loading, error, refresh } = useRpcRead<Summary>('creator_get_dashboard_summary', userId);
  if (loading) return <p role="status" className="py-8 text-sm text-[#9298A6]">Loading overview…</p>;
  if (error || !data) return <section role="alert" className="rounded-xl border border-amber-500/20 p-4">
    <p className="text-sm text-amber-100">Overview could not be loaded.</p>
    <p className="mt-2 text-xs text-[#9298A6]">{error}</p>
    <button type="button" onClick={() => void refresh()} className="mt-3 min-h-11 text-sm font-semibold text-violet-300">Try again</button>
  </section>;
  const groups: { title: string; note: string; destination: Destination; id?: string; values: [string, number][] }[] = [
    { title: 'Personal accounts', note: 'Everyone keeps their own Personal account.', destination: 'people', values: [['Accounts', data.accounts]] },
    { title: 'Property partners', note: 'People and businesses offering accommodation.', destination: 'people', id: 'property_partner', values: [['Partners', data.partners]] },
    { title: 'Workers', note: `${data.pending_reviews} worker reviews waiting`, destination: 'workers', values: [['Workers', data.workers]] },
    { title: 'WeHouse team', note: 'Admins and assigned WeHouse team members.', destination: 'team', values: [['Members', data.team]] },
    { title: 'Properties & hotels', note: `${data.inspections} active inspections · ${data.hotel_team} hotel team members`, destination: 'properties', values: [['Apartments', data.apartments], ['Hotels', data.hotels]] },
    { title: 'Payout requests', note: 'Requests awaiting review or processing.', destination: 'finance', values: [['Requests', data.payouts]] },
  ];
  return <section className="divide-y divide-white/[.06] border-y border-white/[.06]">
    {groups.map(group => <button type="button" key={group.title} onClick={() => onOpen(group.destination, group.id)} className="flex min-h-20 w-full flex-wrap items-center gap-3 py-4 text-left hover:bg-white/[.018]">
      <span className="min-w-[10rem] flex-1"><strong className="block text-sm font-semibold">{group.title}</strong><span className="mt-1 block text-xs leading-5 text-[#9298A6]">{group.note}</span></span>
      <span className="ml-auto flex max-w-full gap-4 text-right">{group.values.map(([label, value]) => <span key={label}><strong className="block text-base font-semibold">{value}</strong><span className="mt-1 block text-[11px] text-[#9298A6]">{label}</span></span>)}</span>
      <span aria-hidden="true" className="text-[#9298A6]">›</span>
    </button>)}
  </section>;
}

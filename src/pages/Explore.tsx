import DiscoveryShell from '@/components/DiscoveryShell';
import type { Profile } from '@/types';

interface ExploreProps {
  profile: Profile | null;
  savedIds: Set<string>;
  onToggleSave: (id: string) => void;
  onNavigate: (page: string, id?: string) => void;
}

const choices = [
  { route: 'search', eyebrow: 'LONG LET', title: 'Homes', text: 'Browse available homes by location, price, type and distance.', accent: 'from-violet-500/20 via-violet-500/[.06] to-transparent', icon: <HomeIcon /> },
  { route: 'roommate', eyebrow: 'MATCH', title: 'Roommates', text: 'Find compatible people using your roommate preferences and matching rules.', accent: 'from-indigo-500/20 via-indigo-500/[.06] to-transparent', icon: <PeopleIcon /> },
  { route: 'hotels', eyebrow: 'SHORT LET', title: 'Hotels', text: 'Find rooms and short lets with the same WeHouse discovery experience.', accent: 'from-fuchsia-500/18 via-fuchsia-500/[.05] to-transparent', icon: <HotelIcon /> },
  { route: 'worker_discovery', eyebrow: 'LOCAL SERVICES', title: 'Professionals', text: 'See reviewed local professionals, current Work Status and Portfolio work.', accent: 'from-emerald-500/18 via-emerald-500/[.05] to-transparent', icon: <ToolsIcon /> },
];

export default function Explore({ onNavigate }: ExploreProps) {
  return (
    <DiscoveryShell
      title="Find what you need"
      description="Long Let, Short Let, compatible roommates and trusted local services."
      onNavigate={onNavigate}
    >
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <section className="divide-y divide-white/[.065] border-y border-white/[.065] sm:grid sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {choices.map((item) => (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              className="group flex min-h-24 items-center gap-4 px-1 py-4 text-left sm:block sm:min-h-44 sm:border-r sm:border-white/[.055] sm:p-4"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-violet-200">{item.icon}</div><div className="min-w-0 flex-1">
              <p className="sm:mt-4 text-[8px] font-bold uppercase tracking-[.17em] text-[#72798A]">{item.eyebrow}</p>
              <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
              <p className="mt-2 max-w-xs text-[10px] leading-relaxed text-[#737A8A]">{item.text}</p>
              </div><span className="text-xl text-violet-300">›</span>
            </button>
          ))}
        </section>

        <section className="mt-6 border-y border-white/[.06] py-5 sm:py-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.17em] text-violet-400">ONE DISCOVERY SYSTEM</p>
              <h2 className="mt-2 text-lg font-bold">Search where the information belongs</h2>
              <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#717889]">Homes and Hotels can use real GPS distance where coordinates exist. Local Services uses your saved State/LGA until Worker location coordinates are available. Roommate matching keeps its own compatibility rules.</p>
            </div>
            <button type="button" onClick={() => onNavigate('search')} className="h-11 rounded-xl bg-violet-500 px-5 text-[10px] font-semibold text-white">Browse homes</button>
          </div>
        </section>
      </main>
    </DiscoveryShell>
  );
}

function HomeIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>}
function PeopleIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M14.5 15c2.9-.5 5 .9 6 4"/></svg>}
function HotelIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 21V5h11v16M15 10h5v11M8 9h3M8 13h3M8 17h3M17 14h1"/></svg>}
function ToolsIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m14 6 4-4 4 4-4 4M4 20l8-8M3 7l4-4 4 4-4 4z"/></svg>}

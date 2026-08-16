import DiscoveryShell from '@/components/DiscoveryShell';
import type { Profile } from '@/types';

interface ExploreProps {
  profile: Profile | null;
  savedIds: Set<string>;
  onToggleSave: (id: string) => void;
  onNavigate: (page: string, id?: string) => void;
}

const choices = [
  { route: 'search', eyebrow: 'LONG STAY', title: 'Homes', text: 'Browse available homes by location, price, type and distance.', accent: 'from-violet-500/20 via-violet-500/[.06] to-transparent', icon: <HomeIcon /> },
  { route: 'roommate', eyebrow: 'MATCH', title: 'Roommates', text: 'Find compatible people using your roommate preferences and matching rules.', accent: 'from-indigo-500/20 via-indigo-500/[.06] to-transparent', icon: <PeopleIcon /> },
  { route: 'hotels', eyebrow: 'SHORT STAY', title: 'Hotels', text: 'Find rooms and short stays with the same WeHouse discovery experience.', accent: 'from-fuchsia-500/18 via-fuchsia-500/[.05] to-transparent', icon: <HotelIcon /> },
  { route: 'worker_discovery', eyebrow: 'LOCAL SERVICES', title: 'Professionals', text: 'See reviewed local professionals, current Work Status and Portfolio work.', accent: 'from-emerald-500/18 via-emerald-500/[.05] to-transparent', icon: <ToolsIcon /> },
];

export default function Explore({ onNavigate }: ExploreProps) {
  return (
    <DiscoveryShell
      title="What are you looking for?"
      description="Homes, roommates, short stays and trusted local services — one Explore experience."
      onNavigate={onNavigate}
    >
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {choices.map((item) => (
            <button
              key={item.route}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`group relative min-h-48 overflow-hidden rounded-3xl border border-white/[.07] bg-gradient-to-br ${item.accent} p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-500/20 hover:bg-white/[.02]`}
            >
              <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[.07] bg-black/15 text-violet-200">{item.icon}</div>
              <p className="mt-5 text-[8px] font-bold uppercase tracking-[.17em] text-[#72798A]">{item.eyebrow}</p>
              <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
              <p className="mt-2 max-w-xs text-[10px] leading-relaxed text-[#737A8A]">{item.text}</p>
              <span className="absolute bottom-5 right-5 grid h-9 w-9 place-items-center rounded-full bg-white/[.05] text-violet-300 transition group-hover:bg-violet-500 group-hover:text-white">→</span>
            </button>
          ))}
        </section>

        <section className="mt-6 rounded-3xl border border-white/[.06] bg-[#10141C] p-5 sm:p-6">
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

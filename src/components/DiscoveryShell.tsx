import type { ReactNode } from 'react';

export type DiscoveryKey = 'homes' | 'roommates' | 'hotels' | 'services';

type ShellProps = {
  active?: DiscoveryKey;
  title: string;
  description?: string;
  onNavigate: (page: string) => void;
  children: ReactNode;
};

type ToolbarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onFilters?: () => void;
  filterCount?: number;
  locationLabel?: string;
  locationDetail?: string;
  locationActive?: boolean;
  locationBusy?: boolean;
  onLocation?: () => void;
  onClearLocation?: () => void;
  children?: ReactNode;
};

const categories: { id: DiscoveryKey; label: string; route: string; icon: ReactNode }[] = [
  { id: 'homes', label: 'Homes', route: 'search', icon: <HomeIcon /> },
  { id: 'roommates', label: 'Roommates', route: 'roommate', icon: <PeopleIcon /> },
  { id: 'hotels', label: 'Hotels', route: 'hotels', icon: <HotelIcon /> },
  { id: 'services', label: 'Local Services', route: 'worker_discovery', icon: <ToolsIcon /> },
];

export default function DiscoveryShell({ active, title, description, onNavigate, children }: ShellProps) {
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-24 text-white">
      <header className="sticky top-0 z-40 border-b border-white/[.06] bg-[#0A0A0F]/96 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 pb-3 pt-4 sm:px-6 lg:px-8">
          <div className="flex items-start gap-3">
            {active ? (
              <button
                type="button"
                onClick={() => onNavigate('explore')}
                aria-label="Back to Explore"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.08] bg-white/[.03] text-[#9DA3B2] transition hover:bg-white/[.05] hover:text-white"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6" /></svg>
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE · EXPLORE</p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl">{title}</h1>
              {description ? <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#74798B] sm:text-[11px]">{description}</p> : null}
            </div>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Explore categories">
            {categories.map((item) => {
              const selected = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.route)}
                  className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-[10px] font-semibold transition ${selected ? 'border-violet-500/25 bg-violet-500/12 text-violet-200' : 'border-white/[.07] bg-white/[.025] text-[#858B9B] hover:bg-white/[.04] hover:text-white'}`}
                >
                  <span className={selected ? 'text-violet-300' : 'text-[#737A8A]'}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

export function DiscoveryToolbar({
  value,
  onChange,
  placeholder,
  onFilters,
  filterCount = 0,
  locationLabel,
  locationDetail,
  locationActive = false,
  locationBusy = false,
  onLocation,
  onClearLocation,
  children,
}: ToolbarProps) {
  return (
    <section className="rounded-2xl border border-white/[.06] bg-[#10141C] p-3 sm:p-4">
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#62697A]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="h-12 w-full rounded-xl border border-white/[.08] bg-[#171B24] pl-10 pr-4 text-xs text-white outline-none placeholder:text-[#5E6473] focus:border-violet-500/40"
          />
        </label>
        {onFilters ? (
          <button type="button" onClick={onFilters} className="relative h-12 shrink-0 rounded-xl border border-white/[.08] bg-[#171B24] px-4 text-[10px] font-semibold text-[#C4C8D2]">
            Filters
            {filterCount > 0 ? <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">{filterCount}</span> : null}
          </button>
        ) : null}
      </div>

      {(onLocation || children) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onLocation && locationLabel ? (
            <button
              type="button"
              onClick={onLocation}
              disabled={locationBusy}
              className={`flex min-h-9 items-center gap-2 rounded-xl border px-3 text-[9px] font-semibold transition disabled:opacity-50 ${locationActive ? 'border-violet-500/25 bg-violet-500/10 text-violet-200' : 'border-white/[.07] bg-black/10 text-[#8C92A1]'}`}
            >
              <LocationIcon />
              {locationBusy ? 'Finding location…' : locationLabel}
            </button>
          ) : null}
          {locationActive && onClearLocation ? <button type="button" onClick={onClearLocation} className="text-[9px] font-semibold text-[#737A8A] hover:text-white">Clear location</button> : null}
          {children}
        </div>
      ) : null}
      {locationDetail ? <p className="mt-2 text-[9px] leading-relaxed text-[#62697A]">{locationDetail}</p> : null}
    </section>
  );
}

export function DiscoveryFilterSheet({ title = 'Filters', onClose, onClear, children, resultLabel }: { title?: string; onClose: () => void; onClear?: () => void; children: ReactNode; resultLabel?: string }) {
  return (
    <>
      <button type="button" aria-label="Close filters" onClick={onClose} className="fixed inset-0 z-[88] bg-black/70 backdrop-blur-sm" />
      <section className="fixed inset-x-0 bottom-0 z-[89] max-h-[84dvh] overflow-y-auto rounded-t-3xl border-t border-white/[.08] bg-[#0F131A] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[min(92vw,34rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-400">EXPLORE FILTERS</p><h2 className="mt-1 text-base font-bold">{title}</h2></div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-[#A5AAB8]">×</button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-5 flex gap-2">
          {onClear ? <button type="button" onClick={onClear} className="h-12 flex-1 rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#9CA2B1]">Reset</button> : null}
          <button type="button" onClick={onClose} className="h-12 flex-[1.5] rounded-xl bg-violet-500 text-[10px] font-semibold text-white">{resultLabel || 'Show results'}</button>
        </div>
      </section>
    </>
  );
}

export function DiscoveryEmpty({ title, text }: { title: string; text: string }) {
  return <section className="rounded-3xl border border-dashed border-white/[.08] bg-white/[.015] px-6 py-14 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#666D7D]">{text}</p></section>;
}

function HomeIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>}
function PeopleIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M14.5 15c2.9-.5 5 .9 6 4"/></svg>}
function HotelIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 21V5h11v16M15 10h5v11M8 9h3M8 13h3M8 17h3M17 14h1"/></svg>}
function ToolsIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m14 6 4-4 4 4-4 4M4 20l8-8M3 7l4-4 4 4-4 4z"/></svg>}
function LocationIcon(){return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>}

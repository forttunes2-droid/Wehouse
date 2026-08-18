import type { ReactNode } from 'react';

export type DiscoveryKey = 'homes' | 'roommates' | 'hotels' | 'services';

type ShellProps = { active?: DiscoveryKey; title: string; description?: string; onNavigate: (page: string) => void; children: ReactNode };
type ToolbarProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  showSearch?: boolean;
  toolbarLabel?: string;
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
  return <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
    <header className="sticky top-0 z-40 border-b border-white/[.055] bg-[#090B10]/95 backdrop-blur-2xl">
      <div className="mx-auto max-w-7xl px-4 pb-3 pt-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
          {active && <button type="button" onClick={() => onNavigate('home')} aria-label="Back to Home" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.025] text-[#9DA3B2] transition hover:bg-white/[.06] hover:text-white"><BackIcon /></button>}
          <div className="min-w-0 flex-1"><p className="text-[8px] font-bold uppercase tracking-[.24em] text-violet-400">WEHOUSE · EXPLORE</p><h1 className="mt-1 break-words text-[clamp(1.25rem,5vw,1.75rem)] font-bold leading-tight">{title}</h1>{description && <p className="mt-1 block max-w-full break-words text-[10px] leading-relaxed text-[#74798B] sm:max-w-2xl sm:text-[11px]">{description}</p>}</div>
        </div>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Explore categories">
          {categories.map((item) => { const selected = active === item.id; return <button key={item.id} type="button" onClick={() => onNavigate(item.route)} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[10px] font-semibold transition ${selected ? 'border-violet-500/25 bg-violet-500/12 text-violet-100' : 'border-white/[.065] bg-white/[.02] text-[#858B9B] hover:bg-white/[.05] hover:text-white'}`}><span className={selected ? 'text-violet-300' : 'text-[#737A8A]'}>{item.icon}</span>{item.label}</button>; })}
        </nav>
      </div>
    </header>
    {children}
  </div>;
}

export function DiscoveryToolbar({ value = '', onChange, placeholder = 'Search', showSearch = true, toolbarLabel, onFilters, filterCount = 0, locationLabel, locationDetail, locationActive = false, locationBusy = false, onLocation, onClearLocation, children }: ToolbarProps) {
  return <section className="rounded-3xl border border-white/[.065] bg-[#10131A] p-3 shadow-[0_18px_50px_rgba(0,0,0,.16)] sm:p-4">
    <div className="flex items-center gap-2">
      {showSearch ? <label className="relative min-w-0 flex-1"><SearchIcon /><input value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder} className="h-12 w-full rounded-2xl border border-white/[.075] bg-[#171A22] pl-10 pr-4 text-xs text-white outline-none placeholder:text-[#5E6473] focus:border-violet-500/40" /></label> : <div className="min-w-0 flex-1"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#777E8E]">{toolbarLabel || 'Choose location'}</p><p className="mt-1 text-[10px] text-[#5E6575]">Filters update results immediately.</p></div>}
      {onFilters && <button type="button" aria-label="Open filters" onClick={onFilters} className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border transition ${filterCount ? 'border-violet-500/25 bg-violet-500/[.09] text-violet-200' : 'border-white/[.075] bg-[#171A22] text-[#C4C8D2]'}`}><FilterIcon />{filterCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold text-white">{filterCount}</span>}</button>}
    </div>
    {(onLocation || children) && <div className="mt-3 flex flex-wrap items-end gap-2">
      {children}
      {onLocation && locationLabel && <button type="button" onClick={onLocation} disabled={locationBusy} className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 text-[9px] font-semibold transition disabled:opacity-50 ${locationActive ? 'border-violet-500/25 bg-violet-500/10 text-violet-200' : 'border-white/[.07] bg-black/10 text-[#8C92A1]'}`}><LocationIcon />{locationBusy ? 'Finding location…' : locationLabel}</button>}
      {locationActive && onClearLocation && <button type="button" onClick={onClearLocation} className="rounded-xl px-2 py-2.5 text-[9px] font-semibold text-[#737A8A] hover:text-white">Clear</button>}
    </div>}
    {locationDetail && <p className="mt-2 text-[9px] leading-relaxed text-[#62697A]">{locationDetail}</p>}
  </section>;
}

export function DiscoveryFilterSheet({ title = 'Filters', onClose, onClear, children, resultLabel }: { title?: string; onClose: () => void; onClear?: () => void; children: ReactNode; resultLabel?: string; resultDisabled?: boolean }) {
  return <>
    <button type="button" aria-label="Close filters" onClick={onClose} className="fixed inset-0 z-[88] bg-black/75 backdrop-blur-sm" />
    <section className="fixed inset-x-2 bottom-2 z-[89] flex max-h-[88dvh] flex-col overflow-hidden rounded-[28px] border border-white/[.09] bg-[#0F1218] shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,39rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
      <div className="shrink-0 border-b border-white/[.055] px-4 pb-3 pt-4 sm:px-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/10 sm:hidden" />
        <div className="flex items-center justify-between gap-3"><div><p className="text-[8px] font-bold uppercase tracking-[.19em] text-violet-400">REFINE RESULTS</p><h2 className="mt-1 text-lg font-bold">{title}</h2><p className="mt-1 text-[9px] text-[#666D7D]">Changes apply immediately. Close when you are done.</p></div><button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-lg text-[#A5AAB8]">×</button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"><div className="space-y-4 [&_.grid-cols-2]:grid-cols-1 sm:[&_.grid-cols-2]:grid-cols-2">{children}</div></div>
      {(onClear || resultLabel) && <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[.055] bg-[#0D1016] p-3 sm:p-4">{resultLabel ? <p className="text-[9px] font-medium text-[#767D8D]">{resultLabel}</p> : <span />}{onClear ? <button type="button" onClick={onClear} className="h-10 rounded-xl border border-white/[.08] px-4 text-[9px] font-semibold text-[#A6ABB7]">Reset filters</button> : null}</div>}
    </section>
  </>;
}

export function DiscoveryEmpty({ title, text }: { title: string; text: string }) { return <section className="rounded-3xl border border-dashed border-white/[.08] bg-white/[.015] px-6 py-14 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#666D7D]">{text}</p></section>; }

function SearchIcon(){return <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#62697A]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>}
function FilterIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M7 12h10M10 18h4"/></svg>}
function BackIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6" /></svg>}
function HomeIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></svg>}
function PeopleIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M14.5 15c2.9-.5 5 .9 6 4"/></svg>}
function HotelIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 21V5h11v16M15 10h5v11M8 9h3M8 13h3M8 17h3M17 14h1"/></svg>}
function ToolsIcon(){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m14 6 4-4 4 4-4 4M4 20l8-8M3 7l4-4 4 4-4 4z"/></svg>}
function LocationIcon(){return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>}

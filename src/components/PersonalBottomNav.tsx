export type PersonalNavPage = 'search' | 'my_reservations' | 'conversation' | 'profile';

type Props = {
  activePage: PersonalNavPage;
  onNavigate: (page: PersonalNavPage) => void;
  inboxBadge?: number;
  className?: string;
  signedOut?: boolean;
};

const tabs: Array<{ id: PersonalNavPage; label: string; icon: typeof SearchIcon }> = [
  { id: 'search', label: 'Explore', icon: SearchIcon },
  { id: 'my_reservations', label: 'Bookings', icon: ReservationIcon },
  { id: 'conversation', label: 'Inbox', icon: InboxIcon },
  { id: 'profile', label: 'Account', icon: AccountIcon },
];

export default function PersonalBottomNav({ activePage, onNavigate, inboxBadge = 0, className = '', signedOut = false }: Props) {
  return (
    <nav
      className={`bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t border-white/[.06] bg-[#090B10]/95 pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur-xl ${className}`}
      aria-label="Main navigation"
    >
      <div className="mx-auto grid w-full max-w-lg grid-cols-4 px-2 pt-1.5">
        {tabs.map((tab) => {
          const active = activePage === tab.id;
          const badge = tab.id === 'conversation' ? inboxBadge : 0;
          const label = signedOut && tab.id === 'profile' ? 'Sign in' : tab.label;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(tab.id)}
              className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 transition active:scale-[.98] ${
                active ? 'text-violet-300' : 'text-[#777D8D]'
              }`}
            >
              <span className={`grid h-8 w-10 place-items-center rounded-xl transition ${
                active ? 'bg-violet-500/10' : 'bg-transparent'
              }`}>
                <Icon size={22} active={active} />
              </span>
              <span className={`truncate text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
              {badge > 0 && (
                <span className="absolute right-[18%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold leading-none text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function SearchIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C4B5FD' : 'currentColor'} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}
function ReservationIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C4B5FD' : 'currentColor'} strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 15l2 2 5-5" /></svg>;
}
function InboxIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C4B5FD' : 'currentColor'} strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="m4 4-3 9v6a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-6l-3-9H4Zm-3 9h6l2 3h6l2-3h6" /></svg>;
}
function AccountIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C4B5FD' : 'currentColor'} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
}

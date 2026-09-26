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
  return <nav className={`bottom-nav fixed bottom-0 left-0 right-0 z-50 ${className}`} aria-label="Main navigation">
    <div className="mx-auto flex max-w-lg items-center justify-around py-1">
      {tabs.map(tab => {
        const signInTab = signedOut && tab.id === 'profile';
        const active = !signInTab && activePage === tab.id;
        const badge = tab.id === 'conversation' ? inboxBadge : 0;
        const label = signInTab ? 'Sign in' : tab.label;
        const Icon = signInTab ? SignInIcon : tab.icon;
        return <button
          key={tab.id}
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={() => onNavigate(tab.id)}
          className={`relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-colors ${signInTab ? 'text-violet-300' : active ? 'text-violet-400' : 'text-[#5C5E72]'}`}
        >
          <Icon size={22} active={active || signInTab} />
          <span className="text-[9px] font-medium">{label}</span>
          {active && <span className="h-1 w-1 rounded-full bg-violet-400" />}
          {badge > 0 && <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>}
        </button>;
      })}
    </div>
  </nav>;
}

function SearchIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : 'currentColor'} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}
function ReservationIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : 'currentColor'} strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 15l2 2 5-5" /></svg>;
}
function InboxIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : 'currentColor'} strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="m4 4-3 9v6a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-6l-3-9H4Zm-3 9h6l2 3h6l2-3h6" /></svg>;
}
function SignInIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#C4B5FD' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></svg>;
}
function AccountIcon({ size, active }: { size: number; active: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={active ? '#A78BFA' : 'currentColor'} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
}

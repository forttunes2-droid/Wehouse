import { useState } from 'react';

type Item = { id: string; label: string };
type Props = {
  label: string;
  title: string;
  items: Item[];
  active: string;
  setActive: (id: string) => void;
  onAccount?: () => void;
  onLogout: () => void;
  children: React.ReactNode;
};

export default function WorkspaceFrameV2({
  label,
  title,
  items,
  active,
  setActive,
  onAccount,
  onLogout,
  children,
}: Props) {
  // Logout is intentionally not rendered here. AccountCenter owns sign-out so
  // operational dashboards do not duplicate a private account action.
  void onLogout;
  const [more, setMore] = useState(false);
  const hasOverflow = items.length > 4;
  const direct = hasOverflow ? items.slice(0, onAccount ? 3 : 4) : items;
  const extra = hasOverflow ? items.slice(direct.length) : [];

  function go(id: string) {
    setActive(id);
    setMore(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="min-h-[100dvh] bg-[#080A0F] pb-[calc(4.75rem+env(safe-area-inset-bottom))] text-white sm:pb-0">
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#080A0F]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-5 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[9px] font-bold uppercase tracking-[.22em] text-blue-400">{label}</p>
              <h1 className="mt-1 truncate text-xl font-bold">{title}</h1>
            </div>
            {onAccount && (
              <button
                onClick={onAccount}
                className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-3 text-[10px] font-semibold text-[#A4A9B8] hover:bg-white/[.05] sm:flex"
              >
                <NavIcon id="account" />
                <span>Account</span>
              </button>
            )}
          </div>

          <div className="mt-4 hidden flex-wrap gap-1 sm:flex">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className={`rounded-xl px-3 py-2 text-[10px] font-semibold ${
                  active === item.id
                    ? 'bg-blue-500 text-white'
                    : 'text-[#747A8B] hover:bg-white/[.04]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-5 lg:px-8">{children}</main>

      {more && extra.length > 0 && (
        <>
          <button
            aria-label="Close more navigation"
            onClick={() => setMore(false)}
            className="fixed inset-0 z-[68] bg-black/55 sm:hidden"
          />
          <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[69] max-h-[55dvh] overflow-y-auto rounded-3xl border border-white/[.08] bg-[#11141C] p-2 shadow-2xl sm:hidden">
            {extra.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className="flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-left text-xs font-semibold text-[#D7DAE2] hover:bg-white/[.04]"
              >
                <span>{item.label}</span>
                <span className="text-[#626878]">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-[67] border-t border-white/[.08] bg-[#090B12]/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        <div className="mx-auto flex min-h-[4.5rem] max-w-lg items-stretch px-1">
          {direct.map((item) => (
            <BottomTab
              key={item.id}
              id={item.id}
              label={item.label}
              active={active === item.id}
              onClick={() => go(item.id)}
            />
          ))}

          {extra.length > 0 && (
            <BottomTab id="more" label="More" active={more} onClick={() => setMore((value) => !value)} />
          )}

          {onAccount && (
            <BottomTab id="account" label="Account" active={false} onClick={onAccount} />
          )}
        </div>
      </nav>
    </div>
  );
}

function BottomTab({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[9px] font-semibold transition-colors ${
        active ? 'text-blue-300' : 'text-[#686F80]'
      }`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-xl ${active ? 'bg-blue-500/12 text-blue-300' : ''}`}>
        <NavIcon id={id} />
      </span>
      <span className="max-w-full truncate">{label}</span>
      {active && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-blue-400" />}
    </button>
  );
}

function NavIcon({ id }: { id: string }) {
  const common = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
  if (id === 'home' || id === 'overview' || id === 'work') {
    return <svg {...common}><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/></svg>;
  }
  if (id === 'jobs' || id === 'reviews') {
    return <svg {...common}><rect x="4" y="6" width="16" height="13" rx="2"/><path d="M9 6V4h6v2M4 11h16"/></svg>;
  }
  if (id === 'earnings' || id === 'payments' || id === 'payouts' || id === 'ledger') {
    return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>;
  }
  if (id === 'profile' || id === 'account') {
    return <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6"/></svg>;
  }
  if (id === 'more') {
    return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>;
  }
  return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
}

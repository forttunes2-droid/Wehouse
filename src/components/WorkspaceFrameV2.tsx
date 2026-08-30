import { useState } from 'react';

type Item = { id: string; label: string };
type Props = {
  label: string;
  title: string;
  description?: string;
  labelBadge?: React.ReactNode;
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
  description,
  labelBadge,
  items,
  active,
  setActive,
  onAccount,
  onLogout,
  children,
}: Props) {
  // AccountCenter owns sign-out. A role workspace should expose one Account
  // route, not duplicate Logout in both the workspace chrome and Account.
  void onLogout;
  const [more, setMore] = useState(false);

  // Phone navigation should never render a confusing "More" tab followed by
  // another permanent Account tab. If everything fits in five slots we show it
  // directly. Otherwise the first four work destinations stay visible and all
  // overflow (including Account) lives inside one More sheet.
  const mobileSlotCount = items.length + (onAccount ? 1 : 0);
  const hasOverflow = mobileSlotCount > 5;
  const direct = hasOverflow ? items.slice(0, 4) : items;
  const extra = hasOverflow ? items.slice(4) : [];
  const accountInMore = hasOverflow && Boolean(onAccount);
  const accountDirect = !hasOverflow && Boolean(onAccount);

  function go(id: string) {
    setActive(id);
    setMore(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goAccount() {
    setMore(false);
    onAccount?.();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div
      data-workspace-frame="v2"
      className="role-workspace min-h-[100dvh] bg-[#0A0A0F] pb-[calc(4.75rem+env(safe-area-inset-bottom))] text-white sm:pb-0"
    >
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0A0A0F]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-5 lg:px-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">{label}</p>
                {labelBadge}
              </div>
              <h1 className="mt-1 truncate text-xl font-bold">{title}</h1>
              {description ? (
                <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#74798B]">{description}</p>
              ) : null}
            </div>
            {onAccount && (
              <button
                onClick={goAccount}
                className="hidden min-h-10 shrink-0 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-3 text-[10px] font-semibold text-[#A4A9B8] transition hover:bg-white/[.05] hover:text-white sm:flex"
              >
                <NavIcon id="account" />
                <span>Account</span>
              </button>
            )}
          </div>

          {/* Desktop/tablet keeps every real workspace tab visible. */}
          <div className="mt-4 hidden flex-wrap gap-1 sm:flex">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className={`rounded-xl px-3 py-2 text-[10px] font-semibold transition ${
                  active === item.id
                    ? 'bg-violet-500 text-white'
                    : 'text-[#747A8B] hover:bg-white/[.04] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-5 lg:px-8 lg:py-7">{children}</main>

      {more && hasOverflow && (
        <>
          <button
            aria-label="Close more navigation"
            onClick={() => setMore(false)}
            className="fixed inset-0 z-[68] bg-black/55 sm:hidden"
          />
          <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[69] max-h-[55dvh] overflow-y-auto rounded-3xl border border-white/[.08] bg-[#11131B] p-2 shadow-2xl sm:hidden">
            {extra.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                className="flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-left text-xs font-semibold text-[#D7DAE2] transition hover:bg-white/[.04]"
              >
                <span>{item.label}</span>
                <span className="text-[#626878]">›</span>
              </button>
            ))}
            {accountInMore && (
              <button
                onClick={goAccount}
                className="flex min-h-12 w-full items-center justify-between rounded-2xl px-4 text-left text-xs font-semibold text-[#D7DAE2] transition hover:bg-white/[.04]"
              >
                <span className="flex items-center gap-3"><NavIcon id="account" /><span>Account</span></span>
                <span className="text-[#626878]">›</span>
              </button>
            )}
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

          {hasOverflow && (
            <BottomTab id="more" label="More" active={more} onClick={() => setMore((value) => !value)} />
          )}

          {accountDirect && <BottomTab id="account" label="Account" active={false} onClick={goAccount} />}
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
        active ? 'text-violet-300' : 'text-[#686F80]'
      }`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-xl ${active ? 'bg-violet-500/12 text-violet-300' : ''}`}>
        <NavIcon id={id} />
      </span>
      <span className="max-w-full truncate">{label}</span>
      {active && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-violet-400" />}
    </button>
  );
}

function NavIcon({ id }: { id: string }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
  };

  if (id === 'home' || id === 'overview' || id === 'work') {
    return (
      <svg {...common}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5" />
        <path d="M9.5 20v-5h5v5" />
      </svg>
    );
  }

  if (id === 'jobs' || id === 'reviews' || id === 'pipeline' || id === 'housing' || id === 'properties' || id === 'showcase') {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="13" rx="2" />
        <path d="M9 6V4h6v2M4 11h16" />
      </svg>
    );
  }

  if (id === 'earnings' || id === 'finance' || id === 'payments' || id === 'payouts' || id === 'ledger') {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M16 15h2" />
      </svg>
    );
  }

  if (id === 'communication' || id === 'communications' || id === 'inbox' || id === 'support') {
    return (
      <svg {...common}>
        <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 3V7a2 2 0 0 1 2-2Z" />
      </svg>
    );
  }

  if (id === 'profile' || id === 'account') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6" />
      </svg>
    );
  }

  if (id === 'more') {
    return (
      <svg {...common}>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

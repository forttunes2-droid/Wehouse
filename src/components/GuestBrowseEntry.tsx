import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { DiscoveryAccessContext } from '@/components/DiscoveryAccess';
import { savePropertyLinkIntent } from '@/lib/propertyLinkIntent';
import { propertyShareUrl, type SharedProperty } from '@/lib/propertyShare';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import { isTestEnvironment } from '@/lib/supabase/client';
import PersonalBottomNav, { type PersonalNavPage } from '@/components/PersonalBottomNav';
import { PublicInvitationPreview } from '@/components/ResourceInvitationAction';
import { clearInvitationIntent, readInvitationIntent, saveInvitationIntent } from '@/lib/resourceInvitation';

const Search = lazy(() => import('@/pages/Search'));
const HotelsHome = lazy(() => import('@/pages/HotelsHome'));
const ListingDetail = lazy(() => import('@/pages/ListingDetailCore'));
const HotelDetail = lazy(() => import('@/pages/HotelDetailExperience'));
const noSavedHomes = new Set<string>();
type Props = { active: boolean; busy?: boolean; onSignIn: () => void; onOpenLegal: (page: 'privacy_policy' | 'terms_of_service') => void; notice?: string; children: ReactNode };

/** Only coordinates public navigation. Search, cards and property details are the
 * SAME components as the authenticated routes. No fake Profile or private reads. */
export default function GuestBrowseEntry({ active, busy = false, onSignIn, onOpenLegal, notice, children }: Props) {
  const [page, setPage] = useState<'search' | 'hotels'>('search');
  const [section, setSection] = useState<'explore' | 'bookings' | 'inbox'>('explore');
  const [target, setTarget] = useState<SharedProperty | null>(null);
  const [invitationToken, setInvitationToken] = useState<string | null>(() => {
    try { return readInvitationIntent(window.location.href, sessionStorage); } catch { return null; }
  });
  const back = useRecordScreenBack(() => setTarget(null), active && Boolean(target));
  function requireSignIn(property = target, destination?: 'bookings' | 'inbox' | 'account') {
    if (busy) return;
    if (destination) {
      try { sessionStorage.setItem('wh_guest_return_tab_v1', destination); } catch {}
    }
    if (property) {
      try { savePropertyLinkIntent(property, sessionStorage); } catch { /* Auth works without storage. */ }
      try {
        const hash = new URL(propertyShareUrl(property)).hash;
        history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch { /* Restricted history must not make Sign in unusable. */ }
    }
    onSignIn();
  }
  function navigate(route: string, id?: string) {
    if (route === 'search' || route === 'hotels') { setPage(route); return; }
    if (id && route === 'detail') { setTarget({ kind: 'listing', id }); return; }
    if (id && route === 'hotel_detail') { setTarget({ kind: 'hotel', id }); return; }
    // Roommate identities and account work stay protected.
    requireSignIn();
  }
  const access = useMemo(() => ({ busy, requireSignIn: () => requireSignIn(), notice: <>
    {isTestEnvironment && <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-[#A7ADBA]">Test preview · Live accounts don’t work here. <a className="text-violet-300" href="https://www.wehouse.com.ng/">Open live WeHouse</a></p>}
    {notice && <p role="status" className="mx-auto max-w-7xl px-4 py-2 text-sm">{notice}</p>}
  </> }), [busy, target, notice, onSignIn]);
  if (!active) return <>{children}</>;
  if (invitationToken) return <PublicInvitationPreview
    token={invitationToken}
    onSignIn={() => {
      try { saveInvitationIntent(invitationToken, sessionStorage); } catch {}
      onSignIn();
    }}
    onClose={() => {
      try { clearInvitationIntent(sessionStorage); } catch {}
      setInvitationToken(null);
      try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
    }}
  />;
  const sectionPage: Record<typeof section, PersonalNavPage> = { explore: 'search', bookings: 'my_reservations', inbox: 'conversation' };
  return <DiscoveryAccessContext.Provider value={access}>
    <div className="wh-public-entry bg-[#090B10] text-white" data-shared-discovery>
      {section === 'explore' ? <Suspense fallback={<div role="status" className="mx-auto max-w-7xl p-5 text-sm text-[#A7ADBA]">Loading places…</div>}>
        {target ? target.kind === 'listing'
          ? <ListingDetail key={target.id} listingId={target.id} profile={null} isSaved={false} onNavigate={back} onToggleSave={() => requireSignIn()} onRequireAuth={() => requireSignIn()} onGoToChat={() => requireSignIn()} onOpenBooking={() => requireSignIn()} />
          : <HotelDetail key={target.id} hotelId={Number(target.id)} profile={null} onBack={back} onRequireAuth={() => requireSignIn()} onGoToChat={() => requireSignIn()} onBook={() => requireSignIn()} />
          : page === 'hotels' ? <HotelsHome onNavigate={navigate} /> : <Search savedIds={noSavedHomes} onToggleSave={id => requireSignIn({ kind: 'listing', id })} onNavigate={navigate} />}
      </Suspense> : <GuestAccess section={section} onSignIn={() => requireSignIn(null, section)} onOpenLegal={onOpenLegal} busy={busy} />}
      <PersonalBottomNav
        activePage={sectionPage[section]}
        onNavigate={(page) => {
          if (page === 'profile') { requireSignIn(null, 'account'); return; }
          const next = page === 'search' ? 'explore' : page === 'my_reservations' ? 'bookings' : 'inbox';
          setSection(next);
          setTarget(null);
        }}
        signedOut
      />
    </div>
  </DiscoveryAccessContext.Provider>;
}

function GuestAccess({ section, onSignIn, busy }: { section: 'bookings' | 'inbox'; onSignIn: () => void; onOpenLegal: (page: 'privacy_policy' | 'terms_of_service') => void; busy: boolean }) {
  const content = {
    bookings: { title: 'Sign in to see your bookings' },
    inbox: { title: 'Sign in to open your inbox' },
  }[section];
  return <main className="wh-public-gate" aria-labelledby={`guest-${section}-title`}>
    <div>
      <h1 id={`guest-${section}-title`}>{content.title}</h1>
      <button type="button" onClick={onSignIn} disabled={busy} aria-busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </div>
  </main>;
}

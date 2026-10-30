import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DiscoveryAccessContext } from '@/components/DiscoveryAccess';
import { savePropertyLinkIntent } from '@/lib/propertyLinkIntent';
import { propertyShareUrl, type SharedProperty } from '@/lib/propertyShare';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import { isTestEnvironment } from '@/lib/supabase/client';
import PersonalBottomNav, { type PersonalNavPage } from '@/components/PersonalBottomNav';
import { PublicInvitationPreview } from '@/components/ResourceInvitationAction';
import { clearInvitationIntent, readInvitationIntent, saveInvitationIntent } from '@/lib/resourceInvitation';
import DiscoveryShell from '@/components/DiscoveryShell';
import {guestActivityReturn} from '@/lib/navigationRoute';

const Search = lazy(() => import('@/pages/Search'));
const HotelsHome = lazy(() => import('@/pages/HotelsHome'));
const ListingDetail = lazy(() => import('@/pages/ListingDetailCore'));
const HotelDetail = lazy(() => import('@/pages/HotelDetailExperience'));
const noSavedHomes = new Set<string>();
type Props = { active: boolean; busy?: boolean; showSignedOutNav?: boolean; sharedProperty?: SharedProperty | null; sharedActivityId?:string|null; onDismissSharedProperty?: () => void; onSignIn: (property: SharedProperty | null) => void; onBrowse?: () => void; notice?: string; children: ReactNode };

/** Only coordinates public navigation. Search, cards and property details are the
 * SAME components as the authenticated routes. No fake Profile or private reads. */
export default function GuestBrowseEntry({ active, busy = false, showSignedOutNav = false, sharedProperty, sharedActivityId, onDismissSharedProperty, onSignIn, onBrowse, notice, children }: Props) {
  const [page, setPage] = useState<'search' | 'hotels'>('search');
  const [section, setSection] = useState<'explore' | 'bookings' | 'inbox'>('explore');
  const [publicProduct, setPublicProduct] = useState<'roommate' | 'services' | null>(sharedActivityId?'services':null);
  const [target, setTarget] = useState<SharedProperty | null>(() => sharedProperty || null);
  useEffect(() => {
    if (sharedProperty) { setSection('explore'); setTarget(sharedProperty); setPublicProduct(null); }
  }, [sharedProperty?.kind, sharedProperty?.id]);
  const [invitationToken, setInvitationToken] = useState<string | null>(() => {
    try { return readInvitationIntent(window.location.href, sessionStorage); } catch { return null; }
  });
  const back = useRecordScreenBack(() => {
    setTarget(null);
    if (sharedProperty && sharedProperty.kind === target?.kind && sharedProperty.id === target.id) onDismissSharedProperty?.();
  }, active && Boolean(target));
  function requireSignIn(property = target, destination?: 'bookings' | 'inbox' | 'account' | 'roommate' | 'services') {
    if (busy) return;
    if (destination) {
      try { sessionStorage.setItem('wh_guest_return_tab_v1', destination==='services'&&sharedActivityId?guestActivityReturn(sharedActivityId)||destination:destination); } catch {}
    }
    if (property) {
      try { savePropertyLinkIntent(property, sessionStorage); } catch { /* Auth works without storage. */ }
      try {
        const hash = new URL(propertyShareUrl(property)).hash;
        history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch { /* Restricted history must not make Sign in unusable. */ }
    }
    onSignIn(property);
  }
  function navigate(route: string, id?: string) {
    if (route === 'search' || route === 'hotels') { setPage(route); return; }
    if (id && route === 'detail') { setPublicProduct(null); setTarget({ kind: 'listing', id }); return; }
    if (id && route === 'hotel_detail') { setPublicProduct(null); setTarget({ kind: 'hotel', id }); return; }
    if (route === 'roommate') { setPublicProduct('roommate'); setTarget(null); return; }
    if (route === 'worker_discovery' || route === 'worker_categories' || route === 'services') { setPublicProduct('services'); setTarget(null); return; }
    requireSignIn();
  }
  const access = useMemo(() => ({ busy, requireSignIn: () => requireSignIn(), notice: <>
    {isTestEnvironment && <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-[var(--wh-text-secondary)]">Test preview · Live accounts don’t work here. <a className="text-violet-300" href="https://www.wehouse.com.ng/">Open live WeHouse</a></p>}
    {notice && <p role="status" className="mx-auto max-w-7xl px-4 py-2 text-sm">{notice}</p>}
  </> }), [busy, target, notice, onSignIn]);
  if (!active && !showSignedOutNav) return <>{children}</>;
  if (!active) return <>
    <div className="wh-auth-with-guest-nav">{children}</div>
    <PersonalBottomNav activePage="profile" signedOut busy={busy} onNavigate={next => {
      if (next === 'profile' || busy) return;
      setSection(next === 'search' ? 'explore' : next === 'my_reservations' ? 'bookings' : 'inbox');
      setTarget(null);
      setPublicProduct(null);
      onBrowse?.();
    }} />
  </>;
  if (invitationToken) return <PublicInvitationPreview
    token={invitationToken}
    onSignIn={() => {
      try { saveInvitationIntent(invitationToken, sessionStorage); } catch {}
      onSignIn(null);
    }}
    onClose={() => {
      try { clearInvitationIntent(sessionStorage); } catch {}
      setInvitationToken(null);
      try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
    }}
  />;
  const sectionPage: Record<typeof section, PersonalNavPage> = { explore: 'search', bookings: 'my_reservations', inbox: 'conversation' };
  return <DiscoveryAccessContext.Provider value={access}>
    <div className="wh-public-entry bg-[var(--wh-bg)] text-[var(--wh-text)]" data-shared-discovery>
      {section === 'explore' ? <Suspense fallback={<div role="status" className="mx-auto max-w-7xl p-5 text-sm text-[var(--wh-text-secondary)]">Loading places…</div>}>
        {target ? target.kind === 'listing'
          ? <ListingDetail key={target.id} listingId={target.id} onOpenListing={id=>setTarget({kind:"listing",id})} profile={null} isSaved={false} onNavigate={back} onToggleSave={() => requireSignIn()} onRequireAuth={() => requireSignIn()} onGoToChat={() => requireSignIn()} onOpenBooking={() => requireSignIn()} />
          : <HotelDetail key={target.id} hotelId={Number(target.id)} profile={null} onBack={back} onRequireAuth={() => requireSignIn()} onGoToChat={() => requireSignIn()} onBook={() => requireSignIn()} />
          : publicProduct ? (
            <DiscoveryShell active={publicProduct==='roommate'?'roommates':'services'} onNavigate={navigate}>
              <GuestAccess section={publicProduct} busy={busy} onSignIn={() => requireSignIn(null,publicProduct)} />
            </DiscoveryShell>
          )
          : page === 'hotels' ? <HotelsHome onNavigate={navigate} /> : <Search savedIds={noSavedHomes} onToggleSave={id => requireSignIn({ kind: 'listing', id })} onNavigate={navigate} />}
      </Suspense> : <GuestAccess section={section} onSignIn={() => requireSignIn(null, section)} busy={busy} />}
      <PersonalBottomNav
        activePage={sectionPage[section]}
        onNavigate={(page) => {
          if (page === 'profile') { setSection('explore'); requireSignIn(null, 'account'); return; }
          const next = page === 'search' ? 'explore' : page === 'my_reservations' ? 'bookings' : 'inbox';
          setSection(next);
          setTarget(null);
          setPublicProduct(null);
        }}
        signedOut
        busy={busy}
      />
    </div>
  </DiscoveryAccessContext.Provider>;
}

type GuestSection='bookings'|'inbox'|'roommate'|'services';
export function guestAccessCopy(section: GuestSection) {
  if(section==='roommate')return {title:'Sign in to find a roommate',body:'Set your location, budget and living preferences to find compatible people.'};
  if(section==='services')return {title:'Sign in to find a professional',body:'Browse services, compare work and agree the details before you pay.'};
  return section === 'bookings'
    ? {
        title: 'Sign in to view your bookings',
        body: 'Track your stay, review confirmed details and keep your upcoming plans in one place.',
      }
    : {
        title: 'Sign in to open your inbox',
        body: 'View messages, updates and service conversations without losing context from the last screen you left.',
      };
}

function GuestAccess({ section, onSignIn, busy }: { section: GuestSection; onSignIn: () => void; busy: boolean }) {
  const content = guestAccessCopy(section);
  const Heading = section==='roommate'||section==='services' ? 'h2' : 'h1';
  return <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-8 sm:px-6 lg:px-8" aria-labelledby={`guest-${section}-title`} data-guest-access={section}>
      <div className="max-w-md">
        <Heading id={`guest-${section}-title`} className="text-2xl font-semibold tracking-tight text-[var(--wh-text)]">{content.title}</Heading>
        <p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">{content.body}</p>
        <button type="button" onClick={onSignIn} disabled={busy} aria-busy={busy} className="mt-5 min-h-12 rounded-xl bg-violet-600 px-6 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in to continue'}</button>
      </div>
  </main>;
}

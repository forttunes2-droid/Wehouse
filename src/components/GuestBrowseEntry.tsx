import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DiscoveryAccessContext } from '@/components/DiscoveryAccess';
import { savePropertyLinkIntent } from '@/lib/propertyLinkIntent';
import { propertyShareUrl, type SharedProperty } from '@/lib/propertyShare';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';
import { isTestEnvironment } from '@/lib/supabase/client';
import PersonalBottomNav, { type PersonalNavPage } from '@/components/PersonalBottomNav';
import { PublicInvitationPreview } from '@/components/ResourceInvitationAction';
import { clearInvitationIntent, readInvitationIntent, saveInvitationIntent } from '@/lib/resourceInvitation';
import BackButton from '@/components/BackButton';

const Search = lazy(() => import('@/pages/Search'));
const HotelsHome = lazy(() => import('@/pages/HotelsHome'));
const ListingDetail = lazy(() => import('@/pages/ListingDetailCore'));
const HotelDetail = lazy(() => import('@/pages/HotelDetailExperience'));
const noSavedHomes = new Set<string>();
type Props = { active: boolean; busy?: boolean; showSignedOutNav?: boolean; sharedProperty?: SharedProperty | null; onDismissSharedProperty?: () => void; onSignIn: (property: SharedProperty | null) => void; onBrowse?: () => void; onOpenLegal: (page: 'privacy_policy' | 'terms_of_service') => void; notice?: string; children: ReactNode };

/** Only coordinates public navigation. Search, cards and property details are the
 * SAME components as the authenticated routes. No fake Profile or private reads. */
export default function GuestBrowseEntry({ active, busy = false, showSignedOutNav = false, sharedProperty, onDismissSharedProperty, onSignIn, onBrowse, onOpenLegal, notice, children }: Props) {
  const [page, setPage] = useState<'search' | 'hotels'>('search');
  const [section, setSection] = useState<'explore' | 'bookings' | 'inbox'>('explore');
  const [publicProduct, setPublicProduct] = useState<'roommate' | 'services' | null>(null);
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
          ? <ListingDetail key={target.id} listingId={target.id} profile={null} isSaved={false} onNavigate={back} onToggleSave={() => requireSignIn()} onRequireAuth={() => requireSignIn()} onGoToChat={() => requireSignIn()} onOpenBooking={() => requireSignIn()} />
          : <HotelDetail key={target.id} hotelId={Number(target.id)} profile={null} onBack={back} onRequireAuth={() => requireSignIn()} onGoToChat={() => requireSignIn()} onBook={() => requireSignIn()} />
          : publicProduct ? <GuestProductPreview product={publicProduct} busy={busy} onBack={() => setPublicProduct(null)} onSignIn={() => requireSignIn(null)} />
          : page === 'hotels' ? <HotelsHome onNavigate={navigate} /> : <Search savedIds={noSavedHomes} onToggleSave={id => requireSignIn({ kind: 'listing', id })} onNavigate={navigate} />}
      </Suspense> : <GuestAccess section={section} onSignIn={() => requireSignIn(null, section)} onOpenLegal={onOpenLegal} busy={busy} />}
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

function GuestProductPreview({ product, busy, onBack, onSignIn }: { product: 'roommate' | 'services'; busy: boolean; onBack: () => void; onSignIn: () => void }) {
  const roommate = product === 'roommate';
  const content = roommate
    ? {
        eyebrow: 'ROOMMATES',
        title: 'Find people whose housing plans fit yours.',
        body: 'Choose practical preferences, see compatible people and connect when the interest is mutual.',
        points: ['State, LGA and area', 'Budget, gender and living preferences', 'Private matching and in-app conversation'],
        note: 'Opening Roommates does not make your private matching details public.',
        action: 'Sign in to start matching',
      }
    : {
        eyebrow: 'WEHOUSE SERVICES',
        title: 'Find a professional for the work you need.',
        body: 'Compare skills and work evidence, agree the job and keep the service booking connected.',
        points: ['Choose a service', 'Review skills and work examples', 'Agree the job with Payment Protection'],
        note: 'Workers are independent service professionals, not WeHouse employees.',
        action: 'Sign in to find a professional',
      };
  return <main className="mx-auto max-w-2xl px-4 py-4 pb-28 sm:px-6" aria-labelledby="guest-product-title">
    <div className="flex items-center gap-3">
      <BackButton onClick={onBack} ariaLabel="Back to Explore" />
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-300">WeHouse</p><p className="text-sm font-semibold">Explore</p></div>
    </div>
    <section className="mt-5" aria-describedby="guest-product-body">
      <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-300">{content.eyebrow}</p>
      <h1 id="guest-product-title" className="mt-2 max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">{content.title}</h1>
      <p id="guest-product-body" className="mt-3 max-w-xl text-sm leading-6 text-[var(--wh-text-secondary)]">{content.body}</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]">
        {content.points.map((point, index) => (
          <div key={point} className="flex items-center gap-3 px-4 py-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-500/10 text-xs font-semibold text-violet-300">{index + 1}</span>
            <span className="text-sm font-medium">{point}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--wh-text-muted)]">{content.note}</p>
      <button type="button" onClick={onSignIn} disabled={busy} className="mt-5 min-h-12 w-full rounded-2xl bg-violet-500 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : content.action}</button>
    </section>
  </main>;
}

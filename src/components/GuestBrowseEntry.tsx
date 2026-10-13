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

export function guestAccessCopy(section: 'bookings' | 'inbox') {
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

export function guestProductCopy(product: 'roommate' | 'services') {
  return product === 'roommate'
    ? {
        eyebrow: 'ROOMMATE MATCHING',
        title: 'Find a roommate who fits your plans.',
        body: 'Sign in to set your location, budget and living preferences.',
        steps: ['Tell us your area, budget and living habits.', 'See people whose plans fit yours, with how well you match.', 'When you both show interest, chat privately and plan a Long Let together.'],
      }
    : {
        eyebrow: 'HOME SERVICES',
        title: 'Find a professional for your home.',
        body: 'Sign in to browse local providers, review their work and request a job.',
        steps: ['Browse service workers near you and see their past work and reviews.', 'Send a request and agree the price in a private chat.', 'Review the agreed scope, price and cancellation terms before checkout. Payment stays paused until approved terms are saved for the job.'],
      };
}

function GuestAccess({ section, onSignIn, onOpenLegal, busy }: { section: 'bookings' | 'inbox'; onSignIn: () => void; onOpenLegal: (page: 'privacy_policy' | 'terms_of_service') => void; busy: boolean }) {
  const content = guestAccessCopy(section);
  return <main className="mx-auto max-w-lg px-4 pb-28 pt-6 sm:px-6" aria-labelledby={`guest-${section}-title`}>
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500/10 text-xs font-bold text-violet-300">WH</div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-300">WeHouse</p>
          <p className="text-sm font-semibold text-[var(--wh-text)]">Explore</p>
        </div>
      </div>
      <section className="rounded-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 shadow-[0_18px_50px_rgba(17,24,39,0.12)]">
        <h1 id={`guest-${section}-title`} className="text-2xl font-semibold tracking-tight text-[var(--wh-text)]">{content.title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--wh-text-secondary)]">{content.body}</p>
        <button type="button" onClick={onSignIn} disabled={busy} aria-busy={busy} className="mt-5 min-h-12 w-full rounded-2xl bg-violet-500 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in to continue'}</button>
        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[var(--wh-text-secondary)]">
          <button type="button" onClick={() => onOpenLegal('privacy_policy')} className="min-h-10 rounded-lg px-2 font-medium text-violet-300 hover:text-violet-200">Privacy Policy</button>
          <span aria-hidden="true">•</span>
          <button type="button" onClick={() => onOpenLegal('terms_of_service')} className="min-h-10 rounded-lg px-2 font-medium text-violet-300 hover:text-violet-200">Terms of Service</button>
        </div>
      </section>
    </div>
  </main>;
}

function GuestProductPreview({ product, busy, onBack, onSignIn }: { product: 'roommate' | 'services'; busy: boolean; onBack: () => void; onSignIn: () => void }) {
  const content = guestProductCopy(product);
  return <main className="mx-auto max-w-2xl px-4 py-4 pb-28 sm:px-6" aria-labelledby="guest-product-title">
    <div className="flex items-center gap-3">
      <BackButton onClick={onBack} ariaLabel="Back to Explore" />
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-300">WeHouse</p><p className="text-sm font-semibold">Explore</p></div>
    </div>
    <section className="mt-5 rounded-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5 shadow-[0_18px_50px_rgba(17,24,39,0.12)]" aria-describedby="guest-product-body">
      <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-300">{content.eyebrow}</p>
      <h1 id="guest-product-title" className="mt-2 max-w-xl text-2xl font-bold tracking-tight text-[var(--wh-text)] sm:text-3xl">{content.title}</h1>
      <p id="guest-product-body" className="mt-3 max-w-xl text-sm leading-6 text-[var(--wh-text-secondary)]">{content.body}</p>
      <ol className="mt-5 space-y-3">
        {content.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-[var(--wh-text-secondary)]">
          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-300">{index + 1}</span>{step}
        </li>)}
      </ol>
      <button type="button" onClick={onSignIn} disabled={busy} className="mt-5 min-h-12 w-full rounded-2xl bg-violet-500 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in to continue'}</button>
    </section>
  </main>;
}

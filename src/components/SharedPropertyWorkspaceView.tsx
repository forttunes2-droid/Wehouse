import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { SharedProperty } from '@/lib/propertyShare';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';
import { useRecordScreenBack } from '@/hooks/useRecordScreenBack';

const ListingDetail = lazy(() => import('@/pages/ListingDetailCore'));
const HotelDetail = lazy(() => import('@/pages/HotelDetailExperience'));

/** A public link opens in place without changing the active work authority. */
export default function SharedPropertyWorkspaceView({ property, onClose, onPersonal }: {
  property: SharedProperty; onClose: () => void; onPersonal: () => void;
}) {
  const back = useRecordScreenBack(onClose);
  const ref = useDialogInteraction(back);
  return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Shared property"
    className="fixed inset-0 z-[100070] overflow-y-auto overscroll-contain bg-[var(--wh-bg)] text-[var(--wh-text)]">
    <div className="sticky top-0 z-40 border-b border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-4 py-2 text-center">
      <button type="button" onClick={onPersonal} className="min-h-10 text-sm font-semibold text-violet-200">
        Open in Personal to save, message or book
      </button>
    </div>
    <Suspense fallback={<p role="status" className="p-6 text-sm text-[var(--wh-text-secondary)]">Opening property…</p>}>
      {property.kind === 'listing'
        ? <ListingDetail key={property.id} listingId={property.id} profile={null} isSaved={false}
            onNavigate={back} onToggleSave={onPersonal} onRequireAuth={onPersonal}
            onGoToChat={onPersonal} onOpenBooking={onPersonal} />
        : <HotelDetail key={property.id} hotelId={Number(property.id)} profile={null}
            onBack={back} onRequireAuth={onPersonal} onGoToChat={onPersonal} onBook={onPersonal} />}
    </Suspense>
  </div>, document.body);
}

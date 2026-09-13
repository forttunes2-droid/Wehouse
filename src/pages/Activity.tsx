import { useEffect } from 'react';
import type { Profile } from '@/types';
import Notifications from '@/pages/Notifications';

type ActivityProps = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  onGoToChat?: (convId: string) => void;
};

// Activity is a nested screen inside the single customer Inbox.
// Inbox itself opens to messages; this screen is reached only after tapping
// the compact Activity entry. It owns its own back control, so tell the outer
// shell not to render another detached Back bar above it.
export default function Activity({ profile, onNavigate }: ActivityProps) {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('wehouse:nested-screen', { detail: { open: true } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent('wehouse:nested-screen', { detail: { open: false } }),
      );
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('conversation')}
            className="grid h-10 w-9 shrink-0 place-items-center text-[#AEB3C0] active:text-white"
            aria-label="Back to Inbox"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold sm:text-xl">Activity</h1>
            <p className="mt-0.5 text-[9px] text-[#707687]">Updates and actions that affect you.</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4 sm:px-5 lg:px-8">
        <Notifications
          profile={profile}
          scope="personal"
          embedded
          onNavigate={onNavigate}
        />
      </main>
    </div>
  );
}

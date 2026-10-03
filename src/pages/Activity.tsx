import { useEffect } from 'react';
import type { Profile } from '@/types';
import Notifications from '@/pages/Notifications';
import ActivityHeader from '@/components/ActivityHeader';

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
    <div className="min-h-[100dvh] bg-[var(--wh-bg)] pb-24 text-[var(--wh-text)]">
      <div className="sticky top-0 z-30 bg-[var(--wh-bg)]/95 px-4 pt-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <ActivityHeader onBack={() => onNavigate('conversation')} subtitle="Updates and actions that affect you." className="mx-auto max-w-5xl" />
      </div>
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

import type { Profile } from '@/types';
import Notifications from '@/pages/Notifications';

type ActivityProps = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  onGoToChat?: (convId: string) => void;
};

// Activity is a nested screen inside the single customer Inbox.
// Inbox itself opens to messages; this screen is reached only after tapping
// the compact Activity entry, similar to TikTok's Inbox pattern.
export default function Activity({ profile, onNavigate }: ActivityProps) {
  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('conversation')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl text-[#AEB3C0] active:bg-white/[.05]"
            aria-label="Back to Inbox"
          >
            ‹
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

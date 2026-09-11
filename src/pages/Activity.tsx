import type { Profile } from '@/types';
import Notifications from '@/pages/Notifications';

type ActivityProps = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  onGoToChat?: (convId: string) => void;
};

// Inbox is the customer's Activity destination. Conversation threads live on
// the separate Conversation route; followed-search matches and other product
// updates arrive here as Activity events.
export default function Activity({ profile, onNavigate }: ActivityProps) {
  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-lg font-bold sm:text-xl">Inbox</h1>
          <p className="mt-1 text-[9px] text-[#707687]">Activity that needs your attention or keeps you updated.</p>
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

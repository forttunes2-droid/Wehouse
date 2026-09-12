import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '@/types';
import Notifications from '@/pages/Notifications';
import Chat from '@/pages/Chat';
import { supabase } from '@/lib/supabase';
import { getAnnouncementsForUser } from '@/lib/supabase/announcements';
import { activityIsCurrent, currentActivityRows } from '@/lib/activityFeed';

type ActivityProps = {
  profile: Profile;
  onNavigate: (page: string, id?: string) => void;
  onGoToChat?: (convId: string) => void;
};

// Inbox is one customer destination. It opens to messages, with a compact
// TikTok-style Activity entry. Full Activity history opens only after the user
// chooses Activity and returns to the same Inbox surface.
export default function Activity({ profile, onNavigate }: ActivityProps) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityUnread, setActivityUnread] = useState(0);

  const refreshUnread = useCallback(async () => {
    const [{ data: rows }, announcements] = await Promise.all([
      supabase
        .from('notifications')
        .select('id,type,title,message,read,created_at,source_type,source_id,destination_route')
        .eq('recipient_id', profile.user_id)
        .in('workspace_scope', ['personal', 'account'])
        .eq('read', false),
      getAnnouncementsForUser(profile.user_id),
    ]);
    const events = currentActivityRows((rows || []) as any[]).filter((row) => !row.read).length;
    const announcementUnread = (announcements.messages || []).filter((delivery: any) => {
      const announcement = Array.isArray(delivery.announcements)
        ? delivery.announcements[0]
        : delivery.announcement || delivery.message;
      return !delivery.read_status && activityIsCurrent({
        type: 'announcement',
        source: 'announcement',
        created_at: announcement?.created_at || delivery.delivered_at,
      });
    }).length;
    setActivityUnread(events + announcementUnread);
  }, [profile.user_id]);

  useEffect(() => {
    void refreshUnread();
    const channel = supabase
      .channel(`inbox-activity-entry:${profile.user_id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.user_id}`,
      }, () => void refreshUnread())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'announcement_recipients', filter: `user_id=eq.${profile.user_id}`,
      }, () => void refreshUnread())
      .subscribe();
    const changed = () => void refreshUnread();
    window.addEventListener('wehouse:unread-changed', changed);
    return () => {
      window.removeEventListener('wehouse:unread-changed', changed);
      void supabase.removeChannel(channel);
    };
  }, [profile.user_id, refreshUnread]);

  if (!activityOpen) {
    return (
      <Chat
        profile={profile}
        onNavigate={onNavigate}
        showActivityEntry
        activityUnreadCount={activityUnread}
        onOpenActivity={() => setActivityOpen(true)}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.055] bg-[#090B10]/95 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={() => setActivityOpen(false)}
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
          onUnreadChange={setActivityUnread}
        />
      </main>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import {
  getUserMatches,
  getConversations,
  getSavedListingsWithData,
  getUserRoomInterests,
  getUserActivity,
} from '@/lib/supabase';
import type { Profile, Conversation, RoomInterest } from '@/types';

interface ActivityProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
}

// ─── ACTIVITY ITEM TYPE ─────────────────────────────

type ActivityItemType =
  | 'roommate_match'
  | 'new_message'
  | 'saved_listing'
  | 'profile_update'
  | 'password_change'
  | 'room_interest_sent'
  | 'room_interest_received'
  | 'room_interest_accepted'
  | 'room_interest_declined'
  | 'login';

interface TimelineItem {
  id: string;
  type: ActivityItemType;
  title: string;
  subtitle: string;
  time: string;
  icon: string;
  navTarget?: { page: string; id?: string };
  read: boolean;
}

// ─── HELPERS ────────────────────────────────────────

function timeAgo(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function activityIcon(type: ActivityItemType): string {
  switch (type) {
    case 'roommate_match': return '👥';
    case 'new_message': return '💬';
    case 'saved_listing': return '🔖';
    case 'profile_update': return '✏️';
    case 'password_change': return '🔒';
    case 'room_interest_sent': return '📤';
    case 'room_interest_received': return '📥';
    case 'room_interest_accepted': return '✅';
    case 'room_interest_declined': return '❌';
    case 'login': return '🔑';
    default: return '📌';
  }
}

function activityColor(type: ActivityItemType): string {
  switch (type) {
    case 'roommate_match': return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    case 'new_message': return 'bg-green-500/15 text-green-400 border-green-500/20';
    case 'saved_listing': return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
    case 'profile_update': return 'bg-purple-500/15 text-purple-400 border-purple-500/20';
    case 'password_change': return 'bg-red-500/15 text-red-400 border-red-500/20';
    case 'room_interest_sent': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20';
    case 'room_interest_received': return 'bg-pink-500/15 text-pink-400 border-pink-500/20';
    case 'room_interest_accepted': return 'bg-green-500/15 text-green-400 border-green-500/20';
    case 'room_interest_declined': return 'bg-red-500/15 text-red-400 border-red-500/20';
    case 'login': return 'bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/20';
    default: return 'bg-gray-500/15 text-gray-400 border-gray-500/20';
  }
}

// ─── MAIN COMPONENT ─────────────────────────────────

export default function Activity({ profile, onNavigate }: ActivityProps) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    const timeline: TimelineItem[] = [];

    // 1. Roommate Matches
    try {
      const { matches } = await getUserMatches(profile.user_id);
      (matches || []).forEach((m: any) => {
        const otherUser = m.user_a_id === profile.user_id ? m.user_b : m.user_a;
        const otherName = otherUser?.username || 'someone';
        timeline.push({
          id: `match-${m.id}`,
          type: 'roommate_match',
          title: `Roommate match with @${otherName}`,
          subtitle: `${m.match_score}% compatibility`,
          time: m.created_at,
          icon: activityIcon('roommate_match'),
          navTarget: { page: 'chat' },
          read: true,
        });
      });
    } catch { /* ignore */ }

    // 2. Conversations / Messages
    try {
      const { conversations } = await getConversations(profile.user_id);
      (conversations || []).forEach((c: Conversation) => {
        const isParticipantA = c.participant_a === profile.user_id;
        const unread = isParticipantA ? c.unread_a : c.unread_b;
        if (unread > 0) {
          timeline.push({
            id: `msg-${c.id}`,
            type: 'new_message',
            title: unread > 1 ? `${unread} new messages` : 'New message',
            subtitle: c.last_message || 'Someone sent you a message',
            time: c.last_message_at || c.created_at,
            icon: activityIcon('new_message'),
            navTarget: { page: 'chat' },
            read: false,
          });
        }
      });
    } catch { /* ignore */ }

    // 3. Saved Listings
    try {
      const { saved } = await getSavedListingsWithData(profile.user_id);
      (saved || []).forEach((s: any) => {
        timeline.push({
          id: `saved-${s.id}`,
          type: 'saved_listing',
          title: `Saved a listing`,
          subtitle: s.listing?.title || 'A property',
          time: s.created_at,
          icon: activityIcon('saved_listing'),
          navTarget: s.listing?.id ? { page: 'detail', id: s.listing.id } : undefined,
          read: true,
        });
      });
    } catch { /* ignore */ }

    // 4. Room Interests
    try {
      const { interests } = await getUserRoomInterests(profile.user_id);
      (interests || []).forEach((ri: RoomInterest) => {
        const isSender = ri.sender_id === profile.user_id;
        if (isSender) {
          timeline.push({
            id: `ri-send-${ri.id}`,
            type: 'room_interest_sent',
            title: 'Room interest request sent',
            subtitle: ri.message || 'You sent a request',
            time: ri.created_at,
            icon: activityIcon('room_interest_sent'),
            read: true,
          });
        } else {
          const statusLabel = ri.status === 'accepted' ? 'accepted' : ri.status === 'declined' ? 'declined' : 'received';
          const typeMap: Record<string, ActivityItemType> = {
            accepted: 'room_interest_accepted',
            declined: 'room_interest_declined',
            pending: 'room_interest_received',
          };
          timeline.push({
            id: `ri-recv-${ri.id}`,
            type: typeMap[ri.status] || 'room_interest_received',
            title: `Room request ${statusLabel}`,
            subtitle: ri.message || 'Someone sent you a request',
            time: ri.created_at,
            icon: activityIcon(typeMap[ri.status] || 'room_interest_received'),
            read: ri.status !== 'pending',
          });
        }
      });
    } catch { /* ignore */ }

    // 5. User Activity (profile updates, password changes, logins)
    try {
      const { activity } = await getUserActivity(profile.user_id, 20);
      (activity || []).forEach((a: any) => {
        const type = a.action_type;
        if (type === 'password_change') {
          timeline.push({
            id: `act-${a.id}`,
            type: 'password_change',
            title: 'Password changed',
            subtitle: 'Your account password was updated',
            time: a.created_at,
            icon: activityIcon('password_change'),
            read: true,
          });
        } else if (type === 'session_start') {
          // Only show recent logins (not all)
          const loginDate = new Date(a.created_at);
          const now = new Date();
          const hoursAgo = (now.getTime() - loginDate.getTime()) / 3600000;
          if (hoursAgo < 24) {
            timeline.push({
              id: `act-${a.id}`,
              type: 'login',
              title: 'Signed in',
              subtitle: `${a.details?.device || 'Unknown device'} · ${a.details?.browser || ''}`,
              time: a.created_at,
              icon: activityIcon('login'),
              read: true,
            });
          }
        } else if (type === 'profile_update') {
          timeline.push({
            id: `act-${a.id}`,
            type: 'profile_update',
            title: 'Profile updated',
            subtitle: a.details?.field ? `${a.details.field} changed` : 'Your profile was updated',
            time: a.created_at,
            icon: activityIcon('profile_update'),
            read: true,
          });
        }
      });
    } catch { /* ignore */ }

    // Sort by time (newest first) and dedupe by ID
    const seen = new Set<string>();
    const sorted = timeline
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 50);

    setItems(sorted);
    setLoading(false);
  }, [profile.user_id]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const unreadCount = items.filter(i => !i.read).length;

  const handleNav = (item: TimelineItem) => {
    if (!item.navTarget) return;
    onNavigate(item.navTarget.page, item.navTarget.id);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] pb-24">
        <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
          <div className="h-7 w-32 rounded-lg shimmer mb-2" />
          <div className="h-4 w-48 rounded shimmer" />
        </header>
        <div className="max-w-lg mx-auto px-5 space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-2xl">
              <div className="w-10 h-10 rounded-xl shimmer flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded shimmer w-2/3" />
                <div className="h-3 rounded shimmer w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Activity</h1>
            <p className="text-xs text-[#5C5E72] mt-1">
              {items.length > 0
                ? unreadCount > 0
                  ? `${unreadCount} new notification${unreadCount > 1 ? 's' : ''}`
                  : `${items.length} activities`
                : 'Your personal activity'}
            </p>
          </div>
          {unreadCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-[#3B82F6]/15 flex items-center justify-center">
              <span className="text-xs font-bold text-[#3B82F6]">{unreadCount}</span>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-1">
        {items.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white mb-1">No activity yet</p>
            <p className="text-xs text-[#5C5E72] leading-relaxed max-w-[260px] mx-auto">
              Your personal activity will appear here — roommate matches, messages, saved listings, and more.
            </p>
          </div>
        ) : (
          /* Timeline */
          items.map((item, index) => {
            const colorClasses = activityColor(item.type);
            const isClickable = !!item.navTarget;
            const showUnread = !item.read;

            return (
              <div key={item.id} className="relative">
                {/* Timeline connector line */}
                {index < items.length - 1 && (
                  <div className="absolute left-5 top-12 bottom-[-4px] w-px bg-[#1E1E2C]" />
                )}

                <button
                  onClick={() => handleNav(item)}
                  disabled={!isClickable}
                  className={`w-full flex items-start gap-3 py-3 px-3 rounded-2xl text-left transition-all ${
                    isClickable ? 'hover:bg-[#12121A] cursor-pointer' : 'cursor-default'
                  } ${showUnread ? 'bg-[#3B82F6]/[0.03]' : ''}`}
                >
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${colorClasses}`}>
                    <span className="text-base">{item.icon}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-xs font-semibold truncate ${showUnread ? 'text-white' : 'text-white/90'}`}>
                        {item.title}
                      </p>
                      {showUnread && (
                        <span className="w-2 h-2 rounded-full bg-[#3B82F6] flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#5C5E72] truncate mt-0.5">{item.subtitle}</p>
                    <p className="text-[9px] text-[#5C5E72]/60 mt-1">{timeAgo(item.time)}</p>
                  </div>

                  {/* Arrow for clickable */}
                  {isClickable && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="flex-shrink-0 mt-2.5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

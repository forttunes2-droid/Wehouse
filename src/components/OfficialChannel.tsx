import { useState, useEffect, useCallback } from 'react';
import { getAnnouncementsForUser, markAnnouncementRead, supabase } from '@/lib/supabase';
import VerifiedBadge from './VerifiedBadge';
import type { Profile, Announcement } from '@/types';

interface OfficialChannelProps {
  profile: Profile;
  onBack: () => void;
}

interface AnnouncementWithRead {
  id: number;
  announcement_id: number;
  read_status: boolean;
  delivered_at: string;
  announcement: Announcement;
}

export default function OfficialChannel({ profile, onBack }: OfficialChannelProps) {
  const [items, setItems] = useState<AnnouncementWithRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { messages } = await getAnnouncementsForUser(profile.user_id);
    const typed = (messages || []).map((m: any) => ({
      ...m,
      announcement: m.announcements || m.message || {},
    })) as AnnouncementWithRead[];
    setItems(typed);
    setLoading(false);
  }, [profile.user_id]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('announcements-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => {
        load();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcement_recipients', filter: `user_id=eq.${profile.user_id}` }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile.user_id, load]);

  async function handleOpen(a: Announcement) {
    setSelectedAnnouncement(a);
    // Mark as read
    const item = items.find(i => i.announcement_id === a.id);
    if (item && !item.read_status) {
      await markAnnouncementRead(a.id, profile.user_id);
      setItems(prev => prev.map(p => p.announcement_id === a.id ? { ...p, read_status: true } : p));
    }
  }

  const unreadCount = items.filter(i => !i.read_status).length;

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ─── FULL MESSAGE MODAL ──────────────────────────
  if (selectedAnnouncement) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex flex-col">
        {/* Modal Header */}
        <header className="bg-[#12121A]/80 backdrop-blur-xl border-b border-white/[0.06] px-5 py-3 flex items-center gap-3 sticky top-0 z-20">
          <button onClick={() => setSelectedAnnouncement(null)} className="text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-white truncate">Announcement</span>
            </div>
          </div>
        </header>

        {/* Full Message */}
        <div className="flex-1 px-5 py-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white">WeHouse Official</span>
                <VerifiedBadge size={13} />
              </div>
              <span className="text-[10px] text-[#5C5E72]">{formatDate(selectedAnnouncement.created_at)}</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#12121A] to-[#1A1A24] border border-white/[0.06] rounded-2xl p-5">
            <h2 className="text-lg font-bold text-white mb-3">{selectedAnnouncement.title}</h2>
            <p className="text-sm text-[#C8C8D0] leading-relaxed whitespace-pre-wrap">{selectedAnnouncement.message}</p>
            <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              <span className="text-[10px] text-[#5C5E72]">
                {new Date(selectedAnnouncement.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── CHANNEL LIST VIEW ────────────────────────────
  return (
    <div className="min-h-screen bg-[#0A0A0F] flex flex-col">
      {/* Channel Header */}
      <header className="bg-[#12121A]/80 backdrop-blur-xl border-b border-white/[0.06] px-5 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white">WeHouse Official</span>
            <VerifiedBadge size={13} />
          </div>
          <span className="text-[10px] text-[#5C5E72]">Announcements & Updates</span>
        </div>
        {unreadCount > 0 && (
          <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount}</span>
        )}
      </header>

      {/* Channel Info Card */}
      <div className="px-5 pt-4 pb-2">
        <div className="glass rounded-2xl p-4 border border-[#3B82F6]/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/20 flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold text-white">WeHouse Official</span>
                <VerifiedBadge size={14} />
              </div>
              <p className="text-[11px] text-[#8A8B9C] mt-0.5">Official announcements, updates, and platform news from the WeHouse team.</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">{items.length} announcement{items.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Announcement List */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass rounded-xl p-4 space-y-2">
                <div className="h-3 bg-[#1A1A24] shimmer rounded w-2/3" />
                <div className="h-2 bg-[#1A1A24] shimmer rounded w-full" />
                <div className="h-2 bg-[#1A1A24] shimmer rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No announcements yet</p>
            <p className="text-xs text-[#5C5E72] mt-1">Check back later for updates</p>
          </div>
        ) : (
          items.map((item) => {
            const a = item.announcement;
            const isUnread = !item.read_status;
            return (
              <button
                key={item.id}
                onClick={() => handleOpen(a)}
                className={`w-full text-left glass rounded-xl p-4 transition-all hover:bg-[#151520] ${
                  isUnread ? 'border-l-2 border-l-[#3B82F6] bg-[#3B82F6]/[0.03]' : 'border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-bold text-[#3B82F6]">WeHouse Official</span>
                      <VerifiedBadge size={10} />
                      <span className="text-[9px] text-[#5C5E72] ml-auto flex-shrink-0">{formatDate(a.created_at)}</span>
                    </div>
                    <h3 className={`text-sm font-semibold leading-snug ${isUnread ? 'text-white' : 'text-[#C8C8D0]'}`}>
                      {a.title}
                    </h3>
                    <p className="text-xs text-[#8A8B9C] mt-1 line-clamp-2">{a.message}</p>
                    {isUnread && (
                      <span className="inline-block mt-2 text-[9px] px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] font-medium">New</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Read-only footer */}
      <div className="bg-[#12121A]/80 backdrop-blur border-t border-white/[0.06] px-5 py-2.5">
        <p className="text-[10px] text-[#5C5E72] text-center">This is a read-only announcement channel</p>
      </div>
    </div>
  );
}

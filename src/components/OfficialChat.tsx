import { useState, useEffect } from 'react';
import { getOfficialMessagesForUser, markOfficialMessageRead } from '@/lib/supabase';
import VerifiedBadge from './VerifiedBadge';
import type { Profile } from '@/types';

interface OfficialChatProps {
  profile: Profile;
  onBack: () => void;
}

export default function OfficialChat({ profile, onBack }: OfficialChatProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMessages();
  }, [profile.user_id]);

  async function loadMessages() {
    setLoading(true);
    setError(null);
    try {
      const { messages: data, error: loadError } = await getOfficialMessagesForUser(profile.user_id);

      if (loadError) {
        console.error('[OfficialChat] load error:', loadError);
        setError('Failed to load messages. Please try again.');
        setLoading(false);
        return;
      }

      const msgs = data || [];
      setMessages(msgs);
      setLoading(false);

      // Mark all as read
      msgs.forEach((m: any) => {
        if (!m.read && m.id) markOfficialMessageRead(m.id);
      });
    } catch (err: any) {
      console.error('[OfficialChat] unexpected error:', err);
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const formatTime = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/20">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-white">WeHouse Official</span>
            <VerifiedBadge size={13} />
          </div>
          <span className="text-[10px] text-[#5C5E72]">Announcements & Updates</span>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-[#1A1A24] shimmer flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-[#1A1A24] shimmer rounded w-1/3" />
                  <div className="h-10 bg-[#1A1A24] shimmer rounded-xl w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-sm text-red-400 mb-2">{error}</p>
            <button
              onClick={loadMessages}
              className="text-xs text-[#3B82F6] hover:text-white transition-colors"
            >
              Tap to retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No official messages yet</p>
            <p className="text-xs text-[#5C5E72] mt-1">Announcements from the team will appear here</p>
          </div>
        ) : (
          <>
            {/* Message count */}
            <p className="text-[10px] text-[#5C5E72] text-center uppercase tracking-wider">
              {messages.length} announcement{messages.length > 1 ? 's' : ''}
            </p>

            {messages.map((m: any) => (
              <div key={m.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-semibold text-[#3B82F6]">
                      {m.message?.sender_name || 'WeHouse Team'}
                    </span>
                    <VerifiedBadge size={11} />
                    <span className="text-[9px] text-[#5C5E72]">{formatTime(m.message?.created_at)}</span>
                  </div>
                  <div className="bg-[#12121A] border border-[#3B82F6]/15 rounded-2xl rounded-tl-md px-4 py-3">
                    <p className="text-sm text-white leading-relaxed">{m.message?.content}</p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Read-only notice */}
      <div className="bg-[#12121A] border-t border-white/[0.06] px-5 py-3">
        <p className="text-[10px] text-[#5C5E72] text-center">
          This is an official announcement channel. You cannot reply to these messages.
        </p>
      </div>
    </div>
  );
}

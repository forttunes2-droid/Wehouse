import { useState, useEffect, useRef } from 'react';
import {
  supabase,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesSeen,
  getOfficialMessagesForUser,
} from '@/lib/supabase';
import OfficialChat from '@/components/OfficialChat';
import VerifiedBadge from '@/components/VerifiedBadge';
import type { Profile, Conversation, Message } from '@/types';

interface ChatProps {
  profile: Profile;
  onNavigate: (page: string) => void;
  conversationId?: string | null;
}

export default function Chat({ profile, onNavigate, conversationId }: ChatProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [showOfficial, setShowOfficial] = useState(false);
  const [officialUnread, setOfficialUnread] = useState(0);
  const [officialMessages, setOfficialMessages] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load everything on mount
  useEffect(() => {
    loadAll();
  }, [profile.user_id]);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadConversations(), loadOfficial()]);
    setLoading(false);
  }

  async function loadConversations() {
    const { conversations: data } = await getConversations(profile.user_id);
    const convs = data || [];
    setConversations(convs);

    // Fetch usernames
    const userIds = convs
      .map((c) => (c.participant_a === profile.user_id ? c.participant_b : c.participant_a))
      .filter((id, i, arr) => arr.indexOf(id) === i);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, username')
        .in('user_id', userIds);
      const map: Record<string, string> = {};
      (profiles || []).forEach((u: any) => {
        map[u.user_id] = u.username;
      });
      setUsernames(map);
    }
  }

  async function loadOfficial() {
    const { messages: data } = await getOfficialMessagesForUser(profile.user_id);
    setOfficialMessages(data || []);
    const unread = (data || []).filter((m: any) => !m.read).length;
    setOfficialUnread(unread);
  }

  // Auto-open conversation from prop
  useEffect(() => {
    if (!conversationId || conversations.length === 0) return;
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) setActiveConv(conv);
  }, [conversationId, conversations]);

  // Load messages when conversation selected
  useEffect(() => {
    if (!activeConv) return;
    loadMessages(activeConv.id);
    markMessagesSeen(activeConv.id, profile.user_id);

    const channel = supabase
      .channel(`messages:${activeConv.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeConv.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConv?.id]);

  async function loadMessages(convId: string) {
    const { messages: data } = await getMessages(convId);
    setMessages(data || []);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !activeConv) return;
    const content = input.trim();
    setInput('');
    await sendMessage(activeConv.id, profile.user_id, content);
  }

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Show official chat
  if (showOfficial) {
    return <OfficialChat profile={profile} onBack={() => { setShowOfficial(false); loadOfficial(); }} />;
  }

  // Show regular chat room
  if (activeConv) {
    const otherId =
      activeConv.participant_a === profile.user_id ? activeConv.participant_b : activeConv.participant_a;

    return (
      <div className="min-h-screen bg-[#0A0A0F] flex flex-col">
        {/* Header */}
        <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              setActiveConv(null);
              setMessages([]);
            }}
            className="text-[#8A8B9C] hover:text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-xs font-bold">
            {otherId.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-sm font-semibold">@{usernames[otherId] || `User ${otherId.slice(-4)}`}</span>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.map((msg) => {
            const isMe = msg.sender_id === profile.user_id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                    isMe
                      ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white rounded-br-md'
                      : 'bg-[#1A1A24] text-white rounded-bl-md border border-white/[0.06]'
                  }`}
                >
                  {msg.content}
                  <div className={`text-[9px] mt-1 ${isMe ? 'text-white/50' : 'text-[#5C5E72]'}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {isMe && msg.seen && <span className="ml-1">Seen</span>}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="bg-[#12121A] border-t border-white/[0.06] px-5 py-3 flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 h-11 bg-[#1A1A24] rounded-xl px-4 text-sm text-white placeholder-[#8A8B9C] outline-none border border-[#2A2A3A] focus:border-[#3B82F6]/50 transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-11 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-opacity"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </form>
      </div>
    );
  }

  // ─── CHAT LIST VIEW ───────────────────────────────

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => onNavigate('home')} className="text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-white">Messages</h1>
          {(officialUnread > 0 || conversations.some((c) => {
            const isA = c.participant_a === profile.user_id;
            return isA ? c.unread_a > 0 : c.unread_b > 0;
          })) && (
            <span className="ml-auto text-xs text-[#3B82F6] font-medium">
              {officialUnread + conversations.reduce((acc, c) => {
                const isA = c.participant_a === profile.user_id;
                return acc + (isA ? c.unread_a : c.unread_b);
              }, 0)} new
            </span>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto">
        {loading ? (
          <div className="space-y-0">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
                <div className="w-11 h-11 rounded-full bg-[#1A1A24] shimmer flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                  <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* WeHouse Official — pinned at top */}
            <button
              onClick={() => setShowOfficial(true)}
              className="w-full flex items-center gap-3 px-5 py-4 border-b border-[#3B82F6]/10 text-left hover:bg-[#12121A] transition-colors bg-[#3B82F6]/[0.02]"
            >
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-white">WeHouse Official</span>
                  <VerifiedBadge size={13} />
                </div>
                <p className="text-xs text-[#8A8B9C] truncate">
                  {officialMessages.length > 0
                    ? officialMessages[0].message?.content?.slice(0, 50) || 'Announcements & Updates'
                    : 'Announcements & Updates'}
                </p>
              </div>
              {officialUnread > 0 && (
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {officialUnread}
                </span>
              )}
            </button>

            {/* Divider */}
            {conversations.length > 0 && (
              <div className="px-5 py-2">
                <p className="text-[9px] text-[#5C5E72] uppercase tracking-wider font-medium">Your conversations</p>
              </div>
            )}

            {/* Regular conversations */}
            {conversations.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm text-[#8A8B9C]">No conversations yet</p>
                <p className="text-xs text-[#8A8B9C]/70 mt-1">Start chatting from a roommate match</p>
              </div>
            ) : (
              conversations.map((conv) => {
                const otherId =
                  conv.participant_a === profile.user_id ? conv.participant_b : conv.participant_a;
                const isUnread =
                  conv.participant_a === profile.user_id ? conv.unread_a > 0 : conv.unread_b > 0;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConv(conv)}
                    className="w-full flex items-center gap-3 px-5 py-4 border-b border-white/[0.04] text-left hover:bg-[#12121A] transition-colors"
                  >
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {(usernames[otherId] || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white truncate">
                          @{usernames[otherId] || `User ${otherId.slice(-4)}`}
                        </span>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-[#3B82F6] flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-[#8A8B9C] truncate">{conv.last_message || 'No messages yet'}</p>
                    </div>
                  </button>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

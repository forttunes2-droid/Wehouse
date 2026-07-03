import { useState, useEffect, useRef } from 'react';
import {
  supabase,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesSeen,
  getOfficialMessagesForUser,
  acceptEnquiry,
  closeConversation,
} from '@/lib/supabase';
import OfficialChannel from '@/components/OfficialChannel';
import VerifiedBadge from '@/components/VerifiedBadge';
import { toast } from 'sonner';
import type { Profile, Conversation, Message, Listing } from '@/types';

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
  const [linkedListing, setLinkedListing] = useState<Listing | null>(null);
  const [otherProfile, setOtherProfile] = useState<{ is_online?: boolean; last_seen?: string; username?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const convSubscriptionRef = useRef<any>(null);

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

    // Fetch usernames for all participants
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

    return convs;
  }

  async function loadOfficial() {
    const { messages: data } = await getOfficialMessagesForUser(profile.user_id);
    setOfficialMessages(data || []);
    const unread = (data || []).filter((m: any) => !m.read_status).length;
    setOfficialUnread(unread);
  }

  // ── Real-time subscription for conversation list updates ──
  useEffect(() => {
    const channel = supabase
      .channel('chat-conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          // Refresh conversations when any conversation changes
          loadConversations();
        }
      )
      .subscribe();

    convSubscriptionRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.user_id]);

  // ── Real-time subscription for announcements ──
  useEffect(() => {
    const channel = supabase
      .channel('announcement-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'announcement_recipients',
          filter: `user_id=eq.${profile.user_id}`,
        },
        () => {
          loadOfficial();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile.user_id]);

  // Auto-open conversation from prop
  useEffect(() => {
    if (!conversationId) return;

    // Check if already loaded
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      setActiveConv(conv);
      return;
    }

    // If not found yet, fetch directly
    async function loadSpecificConv() {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .maybeSingle();
      if (data) {
        setActiveConv(data as Conversation);
        // Refresh the conversations list
        loadConversations();
      }
    }
    loadSpecificConv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conversations.length]);

  // Load listing context when conversation has a linked listing
  useEffect(() => {
    if (!activeConv?.listing_id) { setLinkedListing(null); return; }
    async function loadListing() {
      const { getListing } = await import('@/lib/supabase');
      const { listing } = await getListing(activeConv!.listing_id!);
      setLinkedListing(listing);
    }
    loadListing();
  }, [activeConv?.listing_id]);

  // Load other user's profile (for online/offline status)
  useEffect(() => {
    if (!activeConv) { setOtherProfile(null); return; }
    const otherId = activeConv.participant_a === profile.user_id ? activeConv.participant_b : activeConv.participant_a;
    async function loadOtherProfile() {
      const { data } = await supabase
        .from('profiles')
        .select('is_online, last_seen, username')
        .eq('user_id', otherId)
        .maybeSingle();
      if (data) setOtherProfile(data);
    }
    loadOtherProfile();
    // Subscribe to profile changes for real-time online status
    const channel = supabase
      .channel(`profile-online:${otherId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${otherId}` },
        (payload) => {
          setOtherProfile(prev => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeConv?.id]);

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

  // ─── Conversation List with online status ─────────
  function ConversationList({ conversations, profile, usernames, onSelectConv }: {
    conversations: Conversation[];
    profile: Profile;
    usernames: Record<string, string>;
    onSelectConv: (conv: Conversation) => void;
  }) {
    const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
    const [roleMap, setRoleMap] = useState<Record<string, string>>({});

    useEffect(() => {
      async function loadProfiles() {
        const otherIds = conversations.map(c =>
          c.participant_a === profile.user_id ? c.participant_b : c.participant_a
        );
        if (otherIds.length === 0) return;
        const { data } = await supabase
          .from('profiles')
          .select('user_id, is_online, role')
          .in('user_id', otherIds);
        const online: Record<string, boolean> = {};
        const roles: Record<string, string> = {};
        (data || []).forEach((u: any) => {
          online[u.user_id] = u.is_online;
          roles[u.user_id] = u.role;
        });
        setOnlineMap(online);
        setRoleMap(roles);
      }
      loadProfiles();
    }, [conversations.length]);

    // Type label colors
    const typeLabel = (type?: string | null) => {
      if (type === 'partner_support') return { text: 'Partner', color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' };
      if (type === 'enquiry') return { text: 'Enquiry', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
      return null;
    };

    return (
      <>
        {conversations.map((conv) => {
          const otherId = conv.participant_a === profile.user_id ? conv.participant_b : conv.participant_a;
          const isUnread = conv.participant_a === profile.user_id ? conv.unread_a > 0 : conv.unread_b > 0;
          const isOnline = onlineMap[otherId];
          const otherRole = roleMap[otherId];
          const label = typeLabel(conv.conversation_type);
          return (
            <button
              key={conv.id}
              onClick={() => onSelectConv(conv)}
              className="w-full flex items-center gap-3 px-5 py-4 border-b border-white/[0.04] text-left hover:bg-[#12121A] transition-colors"
            >
              <div className="relative flex-shrink-0">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                  conv.conversation_type === 'partner_support'
                    ? 'bg-gradient-to-br from-violet-500 to-violet-700'
                    : 'bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F]'
                }`}>
                  {(usernames[otherId] || 'U').charAt(0).toUpperCase()}
                </div>
                {isOnline && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-400 border-2 border-[#0A0A0F]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-semibold text-white truncate">
                      @{usernames[otherId] || `User ${otherId.slice(-4)}`}
                    </span>
                    {otherRole && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#1A1A24] border border-[#232330] text-[#5C5E72] flex-shrink-0">
                        {otherRole}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {label && (
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${label.color}`}>
                        {label.text}
                      </span>
                    )}
                    {isUnread && (
                      <span className="w-5 h-5 rounded-full bg-[#3B82F6] text-white text-[9px] font-bold flex items-center justify-center">
                        {conv.participant_a === profile.user_id ? conv.unread_a : conv.unread_b}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[#8A8B9C] truncate">{conv.last_message || 'No messages yet'}</p>
              </div>
            </button>
          );
        })}
      </>
    );
  }

  async function loadMessages(convId: string) {
    const { messages: data } = await getMessages(convId);
    setMessages(data || []);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !activeConv) return;
    const content = input.trim();
    setInput('');

    // Optimistically add message to UI
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      conversation_id: activeConv.id,
      sender_id: profile.user_id,
      content,
      seen: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const { message, error } = await sendMessage(activeConv.id, profile.user_id, content);

    if (error) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      toast.error('Failed to send message');
      return;
    }

    // Replace optimistic with real message
    if (message) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticMsg.id ? message : m))
      );
    }

    // Refresh conversation list to update last_message
    loadConversations();
  }

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Show official chat
  if (showOfficial) {
    return <OfficialChannel profile={profile} onBack={() => { setShowOfficial(false); loadOfficial(); }} />;
  }

  // Show regular chat room
  if (activeConv) {
    const otherId =
      activeConv.participant_a === profile.user_id ? activeConv.participant_b : activeConv.participant_a;

    const isAgent = profile.role === 'staff' || profile.role === 'admin' || profile.role === 'creator';
    const isPending = activeConv.status === 'pending';
    const isClosed = activeConv.status === 'closed';

    // Can send messages if conversation is active, or if it's a new conv
    const canSend = !isClosed;

    return (
      <div className="min-h-screen bg-transparent flex flex-col">
        {/* Header */}
        <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              setActiveConv(null);
              setMessages([]);
              setLinkedListing(null);
            }}
            className="text-[#8A8B9C] hover:text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-xs font-bold">
              {otherId.slice(0, 2).toUpperCase()}
            </div>
            {/* Online indicator dot */}
            {otherProfile?.is_online ? (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#12121A]" />
            ) : (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#5C5E72] border-2 border-[#12121A]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold block truncate">@{usernames[otherId] || otherProfile?.username || `User ${otherId.slice(-4)}`}</span>
              {activeConv.conversation_type === 'partner_support' && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 flex-shrink-0">Partner Support</span>
              )}
            </div>
            {otherProfile?.is_online ? (
              <span className="text-[9px] text-green-400">Online now</span>
            ) : otherProfile?.last_seen ? (
              <span className="text-[9px] text-[#5C5E72]">{getTimeAgo(otherProfile.last_seen)}</span>
            ) : null}
            {linkedListing && (
              <span className="text-[9px] text-[#5C5E72] truncate block">Re: {linkedListing.title}</span>
            )}
          </div>
        </header>

        {/* Listing Context Banner */}
        {linkedListing && (
          <div className="bg-[#12121A] border-b border-[#3B82F6]/10 px-4 py-2.5 flex items-center gap-3">
            <img
              src={linkedListing.images?.[0] || 'https://placehold.co/60x60/1A1A24/5C5E72?text=No+Image'}
              alt=""
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{linkedListing.title}</p>
              <p className="text-[10px] text-[#5C5E72]">{linkedListing.city} · #{linkedListing.price?.toLocaleString()}/year</p>
            </div>
            <span className={`text-[9px] px-2 py-0.5 rounded-full flex-shrink-0 border ${
              isPending ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              'bg-green-500/10 text-green-400 border-green-500/20'
            }`}>
              {isPending ? 'Pending' : 'Active'}
            </span>
          </div>
        )}

        {/* Status Banner */}
        {isPending && (
          <div className="bg-amber-500/5 border-b border-amber-500/10 px-4 py-3">
            {isAgent ? (
              <div>
                <p className="text-xs text-amber-400 font-medium mb-2">New Enquiry — Accept to unlock conversation</p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      const { error } = await acceptEnquiry(activeConv.id);
                      if (error) { toast.error('Failed to accept'); return; }
                      toast.success('Enquiry accepted — conversation unlocked');
                      setActiveConv(prev => prev ? { ...prev, status: 'active' } : prev);
                    }}
                    className="flex-1 h-8 rounded-lg bg-gradient-to-r from-green-500 to-green-600 text-white text-[11px] font-semibold hover:opacity-90 transition-opacity"
                  >
                    Accept
                  </button>
                  <button
                    onClick={async () => {
                      const { error } = await closeConversation(activeConv.id);
                      if (error) { toast.error('Failed to decline'); return; }
                      toast.success('Enquiry declined');
                      setActiveConv(prev => prev ? { ...prev, status: 'closed' } : prev);
                    }}
                    className="flex-1 h-8 rounded-lg bg-[#1A1A24] border border-[#232330] text-[#8A8B9C] text-[11px] font-medium hover:text-red-400 hover:border-red-500/30 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <p className="text-xs text-amber-400/80">Waiting for agent to accept your enquiry...</p>
              </div>
            )}
          </div>
        )}

        {isClosed && (
          <div className="bg-[#1A1A24] border-b border-[#232330] px-4 py-3 text-center">
            <p className="text-xs text-[#5C5E72]">This conversation has been closed</p>
          </div>
        )}

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

        {/* Input — available for all conversations except closed */}
        {canSend ? (
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
        ) : (
          <div className="bg-[#12121A] border-t border-white/[0.06] px-5 py-3 text-center">
            <p className="text-xs text-[#5C5E72]">This conversation is closed</p>
          </div>
        )}
      </div>
    );
  }

// Helper: format last_seen as "2m ago", "1h ago", etc.
function getTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

  // ─── CHAT LIST VIEW ───────────────────────────────

  return (
    <div className="min-h-screen bg-transparent pb-20">
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
            {/* WeHouse Official */}
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
                    ? (officialMessages[0].announcement?.title || officialMessages[0].announcements?.title || 'Announcements & Updates')
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
                <p className="text-xs text-[#8A8B9C]/70 mt-1">Start chatting from worker profiles or property pages</p>
              </div>
            ) : (
              <ConversationList
                conversations={conversations}
                profile={profile}
                usernames={usernames}
                onSelectConv={setActiveConv}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

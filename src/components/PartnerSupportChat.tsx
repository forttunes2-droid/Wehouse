import { useState, useEffect, useRef } from 'react';
import { getPartnerSupportMessages, sendPartnerSupportMessage, markPartnerMessagesRead, ACTION_TYPE_LABELS } from '@/lib/supabase/partner-support';
import type { Profile } from '@/types';

interface Props {
  conversationId: string;
  profile: Profile;
  senderRole: 'partner' | 'staff' | 'field_officer' | 'creator';
  onClose: () => void;
}

export default function PartnerSupportChat({ conversationId, profile, senderRole, onClose }: Props) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadMessages(); }, [conversationId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadMessages() {
    setLoading(true);
    const { messages: msgs } = await getPartnerSupportMessages(conversationId);
    setMessages(msgs || []);
    setLoading(false);
    // Mark as read
    markPartnerMessagesRead(conversationId, senderRole);
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    await sendPartnerSupportMessage(conversationId, profile.user_id, input.trim(), senderRole);
    setInput('');
    setSending(false);
    loadMessages();
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0A0A0F] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0F] flex flex-col">
      {/* ═══ HEADER ═══ */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-[#5C5E72] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">WeHouse Support</p>
            <p className="text-[10px] text-[#5C5E72]">Property Partner Support</p>
          </div>
        </div>
      </header>

      {/* ═══ MESSAGES ═══ */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </div>
            <p className="text-sm text-[#5C5E72]">Start the conversation</p>
            <p className="text-[10px] text-[#5C5E72] mt-1">Message WeHouse support about your property</p>
          </div>
        )}

        {messages.map(msg => {
          const isMe = msg.sender_id === profile.user_id && msg.sender_role === senderRole;
          const isSystem = msg.sender_role === 'system';
          const actionInfo = msg.action_type ? ACTION_TYPE_LABELS[msg.action_type] : null;

          // System/Timeline messages
          if (isSystem || msg.action_type) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] max-w-[85%]">
                  {actionInfo && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={actionInfo.color}>
                      <path d={actionInfo.icon} />
                    </svg>
                  )}
                  <div>
                    {actionInfo && <p className={`text-[9px] font-semibold ${actionInfo.color}`}>{actionInfo.label}</p>}
                    <p className="text-[10px] text-[#8A8B9C]">{msg.content}</p>
                  </div>
                </div>
              </div>
            );
          }

          // Regular messages
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? 'bg-violet-500 text-white rounded-br-md' : 'bg-white/[0.05] text-white rounded-bl-md'}`}>
                {!isMe && <p className="text-[9px] text-[#5C5E72] mb-0.5">{msg.sender_name || 'WeHouse'}</p>}
                <p className="text-xs leading-relaxed">{msg.content}</p>
                <p className={`text-[9px] mt-1 ${isMe ? 'text-violet-200' : 'text-[#5C5E72]'}`}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ═══ INPUT ═══ */}
      <div className="flex-shrink-0 bg-[#12121A] border-t border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-violet-500"
          />
          <button onClick={handleSend} disabled={sending || !input.trim()}
            className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center text-white disabled:opacity-40 transition-opacity">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

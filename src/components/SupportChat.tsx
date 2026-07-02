import { useState, useRef, useEffect, useCallback } from 'react';
import {
  loadGlobalApiKey,
  getRemainingMessages,
  trackMessage,
  getRemainingPhotos,
  trackPhoto,
  sendMessage,
  sendMessageWithImage,
  clearHistory,
} from '@/lib/aiChat';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  time: string;
  image?: string;
}

interface ChatProfile {
  user_id: string;
  username: string | null;
  email: string;
  role?: string;
}

interface SupportChatProps {
  profile: ChatProfile | null;
}

export default function SupportChat({ profile }: SupportChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [remaining, setRemaining] = useState(7);
  const [remainingPhotos, setRemainingPhotos] = useState(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const greetedRef = useRef(false);

  const isCreator = profile?.role === 'creator' || profile?.role === 'creator_admin';
  const isUnlimited = isCreator;

  // Load AI key and check limits on mount
  useEffect(() => {
    if (!profile) return;
    loadGlobalApiKey().then((ready) => {
      setAiReady(ready);
      if (ready) checkAllLimits();
    });
  }, [profile]);

  // Check remaining messages and photos
  const checkAllLimits = async () => {
    if (!profile) return;
    const [msgCount, photoCount] = await Promise.all([
      getRemainingMessages(profile.user_id),
      getRemainingPhotos(profile.user_id),
    ]);
    setRemaining(msgCount);
    setRemainingPhotos(photoCount);

  };

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing]);

  const addMessage = useCallback((role: 'user' | 'bot', text: string, image?: string) => {
    const now = new Date();
    const time = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    setMessages((prev) => [...prev, { id: Date.now().toString(), role, text, time, image }]);
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
    if (!greetedRef.current && messages.length === 0 && aiReady) {
      greetedRef.current = true;
      setTyping(true);
      setTimeout(() => {
        let greeting: string;
        if (isCreator) {
          greeting = "Welcome back, Creator! How can I help you today?";
        } else {
          greeting = "Hey there! I'm your WeHouse AI Agent. How can I help you today?";
        }
        addMessage('bot', greeting);
        setTyping(false);
      }, 500);
    }
  }, [messages.length, aiReady, profile, addMessage, isCreator]);

  // Listen for open event from Account Center
  useEffect(() => {
    const handler = () => handleOpen();
    window.addEventListener('openSupportChat', handler);
    return () => window.removeEventListener('openSupportChat', handler);
  }, [handleOpen]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !selectedImage) return;
    if (!aiReady) return;
    if (!profile) return;

    // Check message limit (creators skip)
    if (remaining <= 0 && !isUnlimited) return;

    // Add user message
    if (selectedImage) {
      addMessage('user', text || '[Image]', selectedImage);
    } else {
      addMessage('user', text);
    }
    setInput('');
    setTyping(true);

    try {
      let reply: string;
      if (selectedImage) {
        reply = await sendMessageWithImage(text, selectedImage);
        setSelectedImage(null);
        // Track photo usage (only for non-creators)
        await trackPhoto(profile.user_id);
      } else {
        reply = await sendMessage(text);
      }
      addMessage('bot', reply);
      // Track message and update remaining
      await trackMessage(profile.user_id);
      await checkAllLimits();
    } catch (err: any) {
      addMessage('bot', "I'm having trouble connecting right now. Please try again.");
    } finally {
      setTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check photo limit: creators = unlimited, normal = 1 free
    if (remainingPhotos <= 0 && !isUnlimited) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setSelectedImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const quickReplies = ['How do I search?', 'Find a roommate', 'Book a hotel', 'I have a problem'];

  // ─── STATUS TEXT ──────────────────────────────────
  const getStatusText = () => {
    if (!aiReady) return 'Setup needed';
    if (isCreator) return 'Online';
    return 'Online';
  };

  // ─── LIMIT REFRESH TIME ───────────────────────────
  const getRefreshTime = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // ─── RENDER ───────────────────────────────────────

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="fixed bottom-20 right-5 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white flex items-center justify-center shadow-2xl shadow-blue-500/30 hover:scale-105 active:scale-95 transition-transform"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0A0A0F]">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#12121A] border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#7C3AED] flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">WeHouse AI Agent</p>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-emerald-400">{getStatusText()}</span>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { clearHistory(); setMessages([]); greetedRef.current = false; }} className="text-[10px] text-[#5C5E72] hover:text-white px-2">
            Clear
          </button>
        )}
        <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {!aiReady ? (
          /* Not Configured */
          <div className="rounded-2xl bg-[#1A1A24] border border-white/[0.06] p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-[#3B82F6]/10 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>
            </div>
            <p className="text-sm font-semibold text-white mb-1">AI Agent Offline</p>
            <p className="text-[10px] text-[#5C5E72]">The AI Agent is being configured. Check back soon!</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white'
                    : 'bg-[#1A1A24] border border-white/[0.04] text-[#CBCBD7]'
                }`}>
                  {msg.image && (
                    <img src={msg.image} alt="Uploaded" className="w-full max-w-[200px] rounded-lg mb-2 object-cover" />
                  )}
                  <p className="text-xs leading-relaxed whitespace-pre-line">{msg.text}</p>
                  <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-white/50' : 'text-[#5C5E72]'}`}>{msg.time}</p>
                </div>
              </div>
            ))}

            {typing && (
              <div className="flex justify-start">
                <div className="bg-[#1A1A24] border border-white/[0.04] rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-[#5C5E72] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[#5C5E72] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[#5C5E72] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Quick Replies */}
            {messages.length <= 1 && !typing && (isUnlimited || remaining > 0) && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                {quickReplies.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => setInput(reply)}
                    className="flex-shrink-0 h-8 px-3 rounded-full bg-[#1A1A24] border border-white/[0.06] text-[10px] text-[#8A8B9C] hover:border-[#3B82F6]/30 hover:text-white transition-colors"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}

            {/* Limit Reached Banner */}
            {remaining <= 0 && !isUnlimited && messages.length > 0 && (
              <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-4 text-center">
                <p className="text-xs text-amber-400 font-semibold mb-1">Daily limit reached</p>
                <p className="text-[10px] text-[#5C5E72] mb-1">Your free messages will refresh at {getRefreshTime()} tomorrow.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      {aiReady && (isUnlimited || remaining > 0) && (
        <div className="flex-shrink-0 bg-[#12121A] border-t border-white/[0.06] px-4 py-3">
          {selectedImage && (
            <div className="relative inline-block mb-2">
              <img src={selectedImage} alt="Selected" className="w-16 h-16 rounded-lg object-cover" />
              <button onClick={() => setSelectedImage(null)} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Photo button - show for everyone, but limit applies */}
            <button
              onClick={() => fileRef.current?.click()}
              className="w-10 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-[#5C5E72] hover:text-white hover:border-[#3B82F6]/30 transition-colors flex-shrink-0 relative"
              title="Upload photo"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>

            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything..."
              className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-xs px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 focus:outline-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() && !selectedImage || typing}
              className="w-10 h-10 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] flex items-center justify-center disabled:opacity-30 transition-opacity flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

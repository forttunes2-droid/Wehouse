import { useState, useRef, useEffect, useCallback } from 'react';
import { hasOpenAIKey, setOpenAIKey, sendMessage, sendMessageWithImage, getHistory, clearHistory } from '@/lib/aiChat';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  time: string;
  image?: string;
}

interface SupportChatProps {
  profile: { user_id: string; username: string | null; email: string; is_premium?: boolean } | null;
}

export default function SupportChat({ profile }: SupportChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [hasKey, setHasKey] = useState(hasOpenAIKey());
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showPremium, setShowPremium] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const greetedRef = useRef(false);

  // Load history on mount
  useEffect(() => {
    const history = getHistory();
    if (history.length > 0) {
      const loaded: Message[] = history.map((h, i) => ({
        id: `hist-${i}`,
        role: h.role === 'assistant' ? 'bot' : 'user',
        text: h.content,
        time: '',
      }));
      setMessages(loaded);
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing]);

  const addMessage = useCallback((role: 'user' | 'bot', text: string, image?: string) => {
    const now = new Date();
    const time = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    setMessages(prev => [...prev, { id: Date.now().toString(), role, text, time, image }]);
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
    // Only greet if first time opening AND no history AND hasn't greeted yet
    if (!greetedRef.current && messages.length === 0 && hasKey) {
      greetedRef.current = true;
      setTyping(true);
      setTimeout(() => {
        addMessage('bot', "Hey there! 👋 Welcome to WeHouse. I'm your AI assistant — ask me anything about finding a home, roommates, or using the app!");
        setTyping(false);
      }, 600);
    }
  }, [messages.length, hasKey, addMessage]);

  // Listen for open event from Account Center
  useEffect(() => {
    const handler = () => handleOpen();
    window.addEventListener('openSupportChat', handler);
    return () => window.removeEventListener('openSupportChat', handler);
  }, [handleOpen]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !selectedImage) return;
    if (!hasKey) return;

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
      } else {
        reply = await sendMessage(text);
      }
      addMessage('bot', reply);
    } catch (err: any) {
      if (err.message?.includes('not configured') || err.message?.includes('Incorrect API key')) {
        addMessage('bot', "⚠️ The AI key isn't working. Please check your API key in settings.");
        setHasKey(false);
      } else {
        addMessage('bot', "I'm having trouble connecting right now. Please try again in a moment.");
      }
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

  const handleSetupKey = () => {
    if (!apiKeyInput.trim()) return;
    setOpenAIKey(apiKeyInput.trim());
    setHasKey(true);
    setApiKeyInput('');
    // Greet after key is set
    setTimeout(() => {
      addMessage('bot', "Great! I'm ready to help. 👋 Ask me anything about WeHouse!");
    }, 300);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if premium
    if (!profile?.is_premium) {
      setShowPremium(true);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setSelectedImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const quickReplies = ['How do I search?', 'Find a roommate', 'How do I book a hotel?', 'Report a problem'];

  // ─── RENDER ───────────────────────────────────────────

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
          <p className="text-sm font-semibold text-white">WeHouse AI</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-emerald-400">{hasKey ? 'Online' : 'Setup needed'}</span>
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
        {!hasKey ? (
          /* API Key Setup */
          <div className="rounded-2xl bg-[#1A1A24] border border-white/[0.06] p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-[#3B82F6]/10 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>
            </div>
            <p className="text-sm font-semibold text-white mb-1">AI Chat Setup</p>
            <p className="text-[10px] text-[#5C5E72] mb-4">Enter your OpenAI API key to activate the AI assistant</p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-..."
              className="w-full h-10 rounded-xl bg-[#12121A] border border-[#232330] text-white text-xs px-4 placeholder-[#5C5E72] focus:border-[#3B82F6] focus:outline-none mb-3"
            />
            <button onClick={handleSetupKey} className="w-full h-10 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white text-xs font-semibold">
              Activate AI
            </button>
            <p className="text-[9px] text-[#5C5E72] mt-3">
              Get your key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[#3B82F6]">platform.openai.com</a>
            </p>
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
            {messages.length <= 2 && !typing && (
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
          </>
        )}
      </div>

      {/* Premium Banner */}
      {showPremium && (
        <div className="flex-shrink-0 bg-gradient-to-r from-amber-500/10 to-amber-600/5 border-t border-amber-500/20 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-white">Go Premium</p>
              <p className="text-[10px] text-[#5C5E72]">Upload images to AI + Get verified badge</p>
            </div>
            <button onClick={() => { setShowPremium(false); }} className="h-8 px-3 rounded-lg bg-amber-500 text-white text-[10px] font-semibold">
              ₦2,000
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      {hasKey && (
        <div className="flex-shrink-0 bg-[#12121A] border-t border-white/[0.06] px-4 py-3">
          {/* Selected image preview */}
          {selectedImage && (
            <div className="relative inline-block mb-2">
              <img src={selectedImage} alt="Selected" className="w-16 h-16 rounded-lg object-cover" />
              <button onClick={() => setSelectedImage(null)} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Image upload button */}
            <button
              onClick={() => fileRef.current?.click()}
              className="w-10 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] flex items-center justify-center text-[#5C5E72] hover:text-white hover:border-[#3B82F6]/30 transition-colors flex-shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
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

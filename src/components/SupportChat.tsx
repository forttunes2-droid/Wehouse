import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  time: string;
}

interface SupportChatProps {
  profile: { user_id: string; username: string | null; email: string } | null;
}

// ─── BOT KNOWLEDGE BASE ─────────────────────────────────
const BOT_KB: Record<string, string[]> = {
  greeting: [
    "Hello! Welcome to WeHouse. I'm your virtual assistant. How can I help you today?",
    "Hi there! Need help with finding a home, posting a listing, or something else?",
  ],
  search: [
    "To search for accommodation:\n\n1. Tap the **Search** tab or the search bar on the home screen\n2. Select your preferred state and LGA\n3. Set your budget range\n4. Choose property type (Apartment, Self Contain, Single Room, etc.)\n5. Tap **Search** to see results\n\nYou can also tap any city card on the homepage to filter by that city.",
  ],
  listing: [
    "To post a listing:\n\n1. Make sure you're logged in as a Creator, Admin, or Staff\n2. Tap the **+** button on the home screen\n3. Fill in property details (title, description, price, location, photos)\n4. Set property type and availability\n5. Tap **Post Listing**\n\nYour listing will go live immediately (or after approval if enabled in settings).",
  ],
  roommate: [
    "To find a roommate:\n\n1. Tap the **Roommate** tab\n2. Set up your profile (budget, lifestyle preferences, location)\n3. Tap **Find Roommate**\n4. The system searches for up to 8 hours\n5. You'll get notified when a match is found\n\nYou can edit your preferences anytime during the search to get better matches.",
  ],
  payment: [
    "For payments and bookings:\n\n1. Find a listing you like\n2. Tap **Contact Staff** to chat with our verified team\n3. Our staff will guide you through property inspection\n4. After inspection, you'll be directed to make secure payment\n\n⚠️ Never pay directly to a landlord. All payments go through WeHouse for your protection.",
  ],
  complaint: [
    "I'm sorry to hear you're having an issue. To file a complaint:\n\n1. Describe your problem in detail here\n2. Our team will review it within 24 hours\n3. You'll get a response via notification\n\nCommon issues I can help with:\n- Fake listings\n- Payment problems\n- Account issues\n- Technical problems\n\nWhat specifically happened?",
  ],
  fake: [
    "To report a fake listing:\n\n1. Open the listing\n2. Tap the **Report** button (flag icon)\n3. Select 'Fake Listing' as the reason\n4. Add details about why you think it's fake\n5. Submit\n\nOur team reviews all reports within 24 hours. Fake listings are removed immediately upon verification.",
  ],
  account: [
    "For account issues:\n\n- **Forgot password**: Tap 'Forgot Password' on the login screen\n- **Can't login**: Try 'Continue with Google' or 'Continue with Phone'\n- **Account deleted**: Contact our support team via email\n- **Change details**: Go to your Profile tab and tap Edit\n\nNeed more help? Ask me anything specific.",
  ],
  worker: [
    "To register as a worker on WeHouse:\n\n1. On the login screen, tap **Create Account**\n2. Select **'I want to offer services'**\n3. Choose your occupation type\n4. Fill in your details and submit\n5. Your application will be reviewed by our team\n\nAvailable worker roles: Cleaner, Electrician, Plumber, Security, Painter, and more.",
  ],
  hotel: [
    "To book a hotel room:\n\n1. Tap the **Hotels** tab\n2. Browse available hotels\n3. Select your check-in and check-out dates\n4. Choose a room type\n5. Tap **Book Now**\n\nYou can manage your bookings in the Bookings section.",
  ],
  contact: [
    "You can reach our support team through:\n\n- **In-app chat**: You're talking to it right now!\n- **Settings**: Tap your profile → scroll to Support section\n\nOur team is available to help you 24/7.",
  ],
  default: [
    "I can help you with:\n\n• Finding accommodation\n• Posting a listing\n• Finding a roommate\n• Payment & bookings\n• Reporting fake listings\n• Account issues\n• Worker registration\n• Hotel bookings\n\nWhat do you need help with?",
  ],
};

// ─── KEYWORD MATCHER ────────────────────────────────────
function findResponse(input: string): string {
  const lower = input.toLowerCase();

  const keywords: [string[], string][] = [
    [['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'], 'greeting'],
    [['search', 'find', 'browse', 'look for', 'where can i find', 'accommodation', 'house', 'rent'], 'search'],
    [['post', 'listing', 'sell', 'upload', 'add property', 'put up', 'advertise'], 'listing'],
    [['roommate', 'share', 'flatmate', 'co-tenant', 'partner'], 'roommate'],
    [['pay', 'payment', 'money', 'transfer', 'book', 'booking', 'reserve'], 'payment'],
    [['complaint', 'problem', 'issue', 'help', 'trouble', 'wrong', 'bad', 'scam', 'fraud'], 'complaint'],
    [['fake', 'report', 'scam', 'fraud', 'not real', 'lie'], 'fake'],
    [['account', 'login', 'password', 'sign in', 'sign up', 'register', 'forgot'], 'account'],
    [['worker', 'job', 'service', 'cleaner', 'plumber', 'electrician', 'work'], 'worker'],
    [['hotel', 'room', 'stay', 'lodge'], 'hotel'],
    [['contact', 'support', 'email', 'call', 'reach', 'talk to human'], 'contact'],
  ];

  for (const [words, key] of keywords) {
    if (words.some(w => lower.includes(w))) {
      const responses = BOT_KB[key] || BOT_KB.default;
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }

  return BOT_KB.default[0];
}

export default function SupportChat({ profile }: SupportChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasGreeted = useRef(false);

  // Listen for open event from Account Center
  useEffect(() => {
    const handleOpen = () => handleOpenChat();
    window.addEventListener('openSupportChat', handleOpen);
    return () => window.removeEventListener('openSupportChat', handleOpen);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing]);

  const addMessage = (role: 'user' | 'bot', text: string) => {
    const now = new Date();
    const time = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    setMessages(prev => [...prev, { id: Date.now().toString(), role, text, time }]);
  };

  const handleOpenChat = () => {
    setOpen(true);
    if (!hasGreeted.current && messages.length === 0) {
      hasGreeted.current = true;
      setTimeout(() => {
        addMessage('bot', BOT_KB.greeting[0]);
      }, 300);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    addMessage('user', text);
    setInput('');
    setTyping(true);

    // Simulate typing delay
    setTimeout(() => {
      const reply = findResponse(text);
      addMessage('bot', reply);
      setTyping(false);

      // Save complaint to database if it sounds like a complaint
      if (profile && (text.toLowerCase().includes('complaint') || text.toLowerCase().includes('problem') || text.toLowerCase().includes('issue') || text.toLowerCase().includes('fake') || text.toLowerCase().includes('scam'))) {
        saveComplaint(profile.user_id, profile.email || 'unknown', text);
      }
    }, 800 + Math.random() * 600);
  };

  async function saveComplaint(userId: string, email: string, text: string) {
    try {
      await supabase.from('support_tickets').insert({
        user_id: userId,
        user_email: email,
        message: text,
        status: 'open',
      });
    } catch {
      // Silently fail — don't block the chat
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickReplies = ['Search help', 'Post listing', 'Roommate', 'Report fake', 'Account issue'];

  return (
    <>
      {/* FAB — Chat Icon */}
      {!open && (
        <button
          onClick={handleOpenChat}
          className="fixed bottom-20 right-5 z-50 w-14 h-14 rounded-full bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white flex items-center justify-center shadow-2xl shadow-blue-500/30 hover:scale-105 active:scale-95 transition-transform"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Chat Panel */}
      {open && (
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
              <p className="text-sm font-semibold text-white">WeHouse Support</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-emerald-400">Online</span>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8A8B9C] hover:text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] text-white'
                    : 'bg-[#1A1A24] border border-white/[0.04] text-[#CBCBD7]'
                }`}>
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
          </div>

          {/* Quick Replies */}
          {messages.length <= 2 && (
            <div className="flex-shrink-0 px-4 pb-2">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
                {quickReplies.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => { setInput(reply); }}
                    className="flex-shrink-0 h-8 px-3 rounded-full bg-[#1A1A24] border border-white/[0.06] text-[10px] text-[#8A8B9C] hover:border-[#3B82F6]/30 hover:text-white transition-colors"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex-shrink-0 bg-[#12121A] border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your question..."
                className="flex-1 h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-xs px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 focus:outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="w-10 h-10 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] flex items-center justify-center disabled:opacity-30 transition-opacity"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

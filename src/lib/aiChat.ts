import OpenAI from 'openai';
import { supabase } from './supabase';

// ─── GLOBAL API KEY (set by creator in Platform Settings) ──

let openai: OpenAI | null = null;
let globalKey: string | null = null;

export async function loadGlobalApiKey(): Promise<boolean> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'openai_api_key')
    .maybeSingle();
  
  if (data?.value && data.value.length > 10) {
    globalKey = data.value;
    openai = new OpenAI({ apiKey: globalKey, dangerouslyAllowBrowser: true });
    return true;
  }
  return false;
}

export function isAIReady(): boolean {
  return !!openai;
}

// ─── MESSAGE TRACKING ──────────────────────────────────

const DAILY_LIMIT = 7;

export async function getRemainingMessages(userId: string): Promise<number> {
  // Check if premium
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_premium, premium_expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (profile?.is_premium) {
    const expires = profile.premium_expires_at ? new Date(profile.premium_expires_at) : null;
    if (!expires || expires > new Date()) {
      return 999; // Unlimited
    }
  }

  // Count today's messages
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { count } = await supabase
    .from('chat_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today.toISOString());

  return Math.max(0, DAILY_LIMIT - (count || 0));
}

export async function trackMessage(userId: string) {
  await supabase.from('chat_usage').insert({
    user_id: userId,
    date: new Date().toISOString().split('T')[0],
  });
}

// ─── SYSTEM PROMPT ──────────────────────────────────────

const SYSTEM_PROMPT = `You are the WeHouse Nigeria virtual assistant. WeHouse is a housing platform connecting people with accommodation across Nigeria. You help users with their questions in a friendly, conversational way.

WHAT YOU KNOW:
- Users can search for houses, apartments, self-contained rooms, single rooms, hostels, duplexes
- Users can find roommates through the Roommate Match feature (8-hour search window)
- Users can book hotel rooms
- Users can register as service workers (cleaners, electricians, plumbers, etc.)
- Payments are handled through Paystack
- Users chat with verified WeHouse staff (not landlords directly)
- Support email: support@wehouse.com.ng

WHAT YOU DO:
- Answer questions about using the WeHouse app
- Guide users through features (search, listings, roommate matching, bookings)
- Help with account issues
- Be friendly, warm, and conversational - like a helpful friend
- If you don't know something, be honest and suggest contacting support
- NEVER make up features, prices, or policies
- NEVER say "24/7" or promise specific response times unless configured
- Keep responses concise (2-4 sentences max)
- Respond in the same language the user writes in

TONE: Friendly, helpful, warm, professional. Use emojis occasionally.`;

// ─── CONVERSATION MEMORY ────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY = 10;

export function getHistory(): ChatMessage[] {
  try {
    const stored = localStorage.getItem('ai_chat_history');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: ChatMessage[]) {
  const trimmed = history.slice(-MAX_HISTORY);
  localStorage.setItem('ai_chat_history', JSON.stringify(trimmed));
}

export function clearHistory() {
  localStorage.removeItem('ai_chat_history');
}

// ─── SEND MESSAGE ───────────────────────────────────────

export async function sendMessage(userMessage: string): Promise<string> {
  if (!openai) throw new Error('AI not configured');

  const history = getHistory();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: h.role,
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 300,
    temperature: 0.8,
  });

  const reply = response.choices[0]?.message?.content || "I'm having trouble right now. Please try again.";

  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: reply });
  saveHistory(history);

  return reply;
}

// ─── SEND WITH IMAGE ────────────────────────────────────

export async function sendMessageWithImage(userMessage: string, imageBase64: string): Promise<string> {
  if (!openai) throw new Error('AI not configured');

  const history = getHistory();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-4).map((h): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: h.role,
      content: h.content,
    })),
    {
      role: 'user',
      content: [
        { type: 'text', text: userMessage || 'What do you see in this image? Can you help me with it?' },
        {
          type: 'image_url',
          image_url: { url: imageBase64, detail: 'low' },
        },
      ] as any,
    },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 400,
    temperature: 0.8,
  });

  const reply = response.choices[0]?.message?.content || "I'm having trouble analyzing this image.";

  history.push({ role: 'user', content: userMessage || '[Image uploaded]' });
  history.push({ role: 'assistant', content: reply });
  saveHistory(history);

  return reply;
}

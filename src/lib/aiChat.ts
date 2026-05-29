import OpenAI from 'openai';

// ─── CONFIG ─────────────────────────────────────────────
// User provides their own OpenAI API key in platform_settings
// This keeps costs under their control

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    const key = localStorage.getItem('openai_api_key');
    if (!key) throw new Error('AI not configured');
    openai = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
  }
  return openai;
}

export function setOpenAIKey(key: string) {
  localStorage.setItem('openai_api_key', key);
  openai = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
}

export function hasOpenAIKey(): boolean {
  return !!localStorage.getItem('openai_api_key');
}

export function clearOpenAIKey() {
  localStorage.removeItem('openai_api_key');
  openai = null;
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

const MAX_HISTORY = 10; // Keep last 10 messages for context

export function getHistory(): ChatMessage[] {
  try {
    const stored = localStorage.getItem('ai_chat_history');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveHistory(history: ChatMessage[]) {
  // Trim to last MAX_HISTORY messages
  const trimmed = history.slice(-MAX_HISTORY);
  localStorage.setItem('ai_chat_history', JSON.stringify(trimmed));
}

export function clearHistory() {
  localStorage.removeItem('ai_chat_history');
}

// ─── SEND MESSAGE ───────────────────────────────────────
export async function sendMessage(userMessage: string): Promise<string> {
  const client = getClient();
  const history = getHistory();

  // Build messages array with system prompt + history + new message
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h): OpenAI.Chat.ChatCompletionMessageParam => ({
      role: h.role,
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini', // Fast and cheap
    messages,
    max_tokens: 300,
    temperature: 0.8,
  });

  const reply = response.choices[0]?.message?.content || "I'm having trouble thinking right now. Please try again.";

  // Save to history
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: reply });
  saveHistory(history);

  return reply;
}

// ─── SEND WITH IMAGE ────────────────────────────────────
export async function sendMessageWithImage(userMessage: string, imageBase64: string): Promise<string> {
  const client = getClient();
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
          image_url: {
            url: imageBase64,
            detail: 'low', // Use low detail to save cost
          },
        },
      ] as any,
    },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini', // Supports vision
    messages,
    max_tokens: 400,
    temperature: 0.8,
  });

  const reply = response.choices[0]?.message?.content || "I'm having trouble analyzing this image. Please try again.";

  history.push({ role: 'user', content: userMessage || '[Image uploaded]' });
  history.push({ role: 'assistant', content: reply });
  saveHistory(history);

  return reply;
}

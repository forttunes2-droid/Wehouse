import { supabase } from './client';
import type { Conversation, Message } from '@/types';

// ─── CHAT HELPERS ──────────────────────────────────

export async function getConversations(userId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .order('updated_at', { ascending: false });
  return { conversations: data as Conversation[] | null, error };
}

export async function getMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return { messages: data as Message[] | null, error };
}

export async function sendMessage(conversationId: string, senderId: string, content: string) {
  // 1. Insert the message
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content })
    .select()
    .maybeSingle();

  if (error || !data) return { message: null, error };

  // 2. Update conversation: last_message, updated_at, and unread count
  // Get the conversation to know who the recipient is
  const { data: conv } = await supabase
    .from('conversations')
    .select('participant_a, participant_b')
    .eq('id', conversationId)
    .maybeSingle();

  if (conv) {
    const isA = conv.participant_a === senderId;
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
      last_message: content,
      last_message_at: new Date().toISOString(),
    };
    // Increment unread count for the OTHER person
    if (isA) {
      updateData.unread_b = (await getUnreadCount(conversationId, 'b')) + 1;
    } else {
      updateData.unread_a = (await getUnreadCount(conversationId, 'a')) + 1;
    }

    await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId);
  }

  return { message: data as Message, error: null };
}

async function getUnreadCount(convId: string, which: 'a' | 'b'): Promise<number> {
  const { data } = await supabase
    .from('conversations')
    .select(`unread_${which}`)
    .eq('id', convId)
    .maybeSingle();
  return (data as any)?.[`unread_${which}`] || 0;
}

export async function markMessagesSeen(conversationId: string, userId: string) {
  // Mark messages as seen
  const { error: msgErr } = await supabase
    .from('messages')
    .update({ seen: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId);

  // Also clear unread count for this user
  const { data: conv } = await supabase
    .from('conversations')
    .select('participant_a')
    .eq('id', conversationId)
    .maybeSingle();

  if (conv) {
    const isA = conv.participant_a === userId;
    await supabase
      .from('conversations')
      .update({ [isA ? 'unread_a' : 'unread_b']: 0 })
      .eq('id', conversationId);
  }

  return { error: msgErr };
}

export async function createConversation(userA: string, userB: string, listingId?: string | null) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ participant_a: userA, participant_b: userB, listing_id: listingId || null, status: 'active' })
    .select()
    .maybeSingle();
  return { conversation: data as Conversation | null, error };
}

// Accept an enquiry — unlocks full conversation
export async function acceptEnquiry(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'active' })
    .eq('id', conversationId)
    .select()
    .maybeSingle();
  return { conversation: data as Conversation | null, error };
}

// Close a conversation
export async function closeConversation(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'closed' })
    .eq('id', conversationId)
    .select()
    .maybeSingle();
  return { conversation: data as Conversation | null, error };
}

export async function getOrCreateConversation(userA: string, userB: string, listingId?: string | null) {
  // Build the filter: same participants (either direction) AND same listing
  let query = supabase
    .from('conversations')
    .select('*')
    .or(`and(participant_a.eq.${userA},participant_b.eq.${userB}),and(participant_a.eq.${userB},participant_b.eq.${userA})`);

  // If a listing_id is provided, match on it too
  if (listingId) {
    query = query.eq('listing_id', listingId);
  }

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    return { conversation: existing as Conversation, error: null };
  }

  // Create new conversation with listing context
  return createConversation(userA, userB, listingId);
}

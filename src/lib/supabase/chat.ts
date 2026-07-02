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
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content })
    .select()
    .maybeSingle();

  // Update conversation timestamp so it appears at top of list
  if (!error) {
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  return { message: data as Message | null, error };
}

export async function markMessagesSeen(conversationId: string, userId: string) {
  const { error } = await supabase
    .from('messages')
    .update({ seen: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId);
  return { error };
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

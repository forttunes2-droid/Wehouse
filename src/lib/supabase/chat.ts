import { supabase } from './client';
import type { Conversation, Message } from '@/types';

// ═══════════════════════════════════════════════════════════════
// CHAT — Completely rewritten with reliable query patterns
// ═══════════════════════════════════════════════════════════════

// Get conversations where user is participant (two separate queries, merged)
export async function getConversations(userId: string) {
  // Query 1: user is participant_a
  const { data: asA, error: errA } = await supabase
    .from('conversations')
    .select('*')
    .eq('participant_a', userId)
    .order('last_message_at', { ascending: false });

  // Query 2: user is participant_b
  const { data: asB, error: errB } = await supabase
    .from('conversations')
    .select('*')
    .eq('participant_b', userId)
    .order('last_message_at', { ascending: false });

  if (errA || errB) {
    return { conversations: null, error: errA || errB };
  }

  // Merge and deduplicate, sort by last_message_at (newest first)
  const merged = new Map<string, Conversation>();
  (asA || []).forEach(c => merged.set(c.id, c as Conversation));
  (asB || []).forEach(c => merged.set(c.id, c as Conversation));

  const sorted = Array.from(merged.values()).sort((a, b) => {
    const aTime = a.last_message_at || a.created_at;
    const bTime = b.last_message_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return { conversations: sorted, error: null };
}

// For staff/admin/creator: personal conversations + ALL partner_support conversations
export async function getStaffConversations(userId: string) {
  // 1. Get personal conversations
  const { conversations: personal } = await getConversations(userId);

  // 2. Get ALL partner_support conversations
  const { data: support } = await supabase
    .from('conversations')
    .select('*')
    .eq('conversation_type', 'partner_support')
    .order('last_message_at', { ascending: false });

  // 3. Merge (personal takes priority for dedup)
  const merged = new Map<string, Conversation>();
  (personal || []).forEach(c => merged.set(c.id, c));
  (support || []).forEach(c => merged.set(c.id, c as Conversation));

  const sorted = Array.from(merged.values()).sort((a, b) => {
    const aTime = a.last_message_at || a.created_at;
    const bTime = b.last_message_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return { conversations: sorted };
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

  // 2. Update conversation: last_message, last_message_at, unread count
  const { data: conv } = await supabase
    .from('conversations')
    .select('participant_a, participant_b')
    .eq('id', conversationId)
    .maybeSingle();

  if (conv) {
    const isA = conv.participant_a === senderId;
    const updateData: Record<string, any> = {
      last_message: content,
      last_message_at: new Date().toISOString(),
    };
    // Increment unread for the OTHER person
    if (isA) {
      updateData.unread_b = { increment: 1 };
    } else {
      updateData.unread_a = { increment: 1 };
    }

    await supabase
      .from('conversations')
      .update(updateData)
      .eq('id', conversationId);
  }

  return { message: data as Message, error: null };
}

export async function markMessagesSeen(conversationId: string, userId: string) {
  // Mark messages as seen
  await supabase
    .from('messages')
    .update({ seen: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId);

  // Clear unread count for this user
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
}

export async function createConversation(userA: string, userB: string, listingId?: string | null, conversationType?: string, subject?: string) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      participant_a: userA,
      participant_b: userB,
      listing_id: listingId || null,
      status: 'active',
      conversation_type: conversationType || 'direct',
      subject: subject || null,
    })
    .select()
    .maybeSingle();
  return { conversation: data as Conversation | null, error };
}

export async function acceptEnquiry(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'active' })
    .eq('id', conversationId)
    .select()
    .maybeSingle();
  return { conversation: data as Conversation | null, error };
}

export async function closeConversation(conversationId: string) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'closed' })
    .eq('id', conversationId)
    .select()
    .maybeSingle();
  return { conversation: data as Conversation | null, error };
}

export async function getOrCreateConversation(userA: string, userB: string, listingId?: string | null, conversationType?: string, subject?: string) {
  // Try direction A→B
  let q1 = supabase
    .from('conversations')
    .select('*')
    .eq('participant_a', userA)
    .eq('participant_b', userB);
  if (listingId) q1 = q1.eq('listing_id', listingId);
  const { data: exist1 } = await q1.maybeSingle();
  if (exist1) return { conversation: exist1 as Conversation, error: null };

  // Try direction B→A
  let q2 = supabase
    .from('conversations')
    .select('*')
    .eq('participant_a', userB)
    .eq('participant_b', userA);
  if (listingId) q2 = q2.eq('listing_id', listingId);
  const { data: exist2 } = await q2.maybeSingle();
  if (exist2) return { conversation: exist2 as Conversation, error: null };

  // Create new
  return createConversation(userA, userB, listingId, conversationType, subject);
}

import { supabase } from './client';
import type { Conversation, Message } from '@/types';

// ═══════════════════════════════════════════════════════════════
// CHAT — Completely rewritten with reliable query patterns
// ═══════════════════════════════════════════════════════════════

// Get conversations where user is participant (uses RPC to bypass RLS issues)
export async function getConversations(userId: string) {
  // Use RPC which bypasses RLS and handles the query reliably
  const { data, error } = await supabase.rpc('get_user_conversations', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[getConversations] RPC error:', error);
    // Fallback: try direct query
    const { data: asA } = await supabase
      .from('conversations').select('*').eq('participant_a', userId);
    const { data: asB } = await supabase
      .from('conversations').select('*').eq('participant_b', userId);
    const merged = new Map<string, Conversation>();
    (asA || []).forEach((c: any) => merged.set(c.id, c as Conversation));
    (asB || []).forEach((c: any) => merged.set(c.id, c as Conversation));
    const sorted = Array.from(merged.values()).sort((a, b) => {
      const aTime = a.last_message_at || a.created_at;
      const bTime = b.last_message_at || b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    return { conversations: sorted, error: null };
  }

  return { conversations: (data || []) as Conversation[], error: null };
}

// For staff/admin/creator: personal conversations + ALL partner_support conversations
export async function getStaffConversations(userId: string) {
  // 1. Get personal conversations via RPC
  const { data: personal, error: personalErr } = await supabase.rpc('get_user_conversations', {
    p_user_id: userId,
  });
  if (personalErr) console.error('[getStaffConversations] personal error:', personalErr);

  // 2. Get ALL partner_support conversations via RPC
  const { data: support, error: supportErr } = await supabase.rpc('admin_get_support_conversations');
  if (supportErr) console.error('[getStaffConversations] support error:', supportErr);

  // 3. Merge (personal takes priority for dedup)
  const merged = new Map<string, Conversation>();
  (personal || []).forEach((c: any) => merged.set(c.id, c as Conversation));
  (support || []).forEach((c: any) => merged.set(c.id, c as Conversation));

  const sorted = Array.from(merged.values()).sort((a, b) => {
    const aTime = a.last_message_at || a.created_at;
    const bTime = b.last_message_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return { conversations: sorted };
}

export async function getMessages(conversationId: string) {
  // Try RPC first (bypasses RLS)
  const { data, error } = await supabase.rpc('get_conversation_messages', {
    p_conversation_id: conversationId,
  });
  if (!error && data) {
    return { messages: data as Message[], error: null };
  }
  // Fallback to direct query
  const { data: directData, error: directError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return { messages: directData as Message[] | null, error: directError };
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

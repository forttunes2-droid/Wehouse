import { supabase } from './client';
import type { Announcement, AnnouncementTargetType } from '@/types';

// ─── ANNOUNCEMENT SYSTEM v2 ────────────────────────

export async function checkAnnouncementTables() {
  try {
    const { error: msgErr } = await supabase.from('announcements').select('id').limit(1);
    const { error: recipErr } = await supabase.from('announcement_recipients').select('id').limit(1);
    const issues: string[] = [];
    if (msgErr && msgErr.message.includes('does not exist')) issues.push('announcements table missing');
    if (recipErr && recipErr.message.includes('does not exist')) issues.push('announcement_recipients table missing');
    return { ok: issues.length === 0 && !msgErr && !recipErr, issues, announcementsError: msgErr?.message || null, recipientsError: recipErr?.message || null };
  } catch (e: any) {
    return { ok: false, issues: ['Diagnostic failed'], announcementsError: e.message, recipientsError: null };
  }
}

export async function sendAnnouncement(
  senderId: string,
  senderRole: string,
  senderName: string,
  title: string,
  message: string,
  targetType: AnnouncementTargetType,
  options: { recipientIds?: string[]; scopeState?: string; scopeLga?: string } = {}
) {
  const { recipientIds, scopeState, scopeLga } = options;

  // Step 1: Insert the announcement
  const { data: announcement, error: insertErr } = await supabase
    .from('announcements')
    .insert({ title, message, created_by: senderId, sender_name: senderName, sender_role: senderRole, target_type: targetType, target_state: scopeState || null, target_lga: scopeLga || null })
    .select()
    .maybeSingle();

  if (insertErr || !announcement) {
    console.error('[sendAnnouncement] insert failed:', insertErr);
    return { error: { message: `Insert failed: ${insertErr?.message || 'unknown'}` } };
  }

  // Step 2: Determine target users based on target_type
  let targetUserIds: string[] = [];

  if (targetType === 'specific_user' && recipientIds && recipientIds.length > 0) {
    targetUserIds = recipientIds;
  } else {
    // Build query based on target_type
    let query = supabase.from('profiles').select('user_id').is('deleted_at', null);

    switch (targetType) {
      case 'all_workers':
        query = query.eq('role', 'worker');
        break;
      case 'verified_workers':
        query = query.eq('role', 'worker').eq('worker_verified', true);
        break;
      case 'admins':
        query = query.in('role', ['admin', 'creator']);
        break;
      case 'staff_only':
        query = query.eq('role', 'staff');
        break;
      case 'admin_only':
        query = query.eq('role', 'admin');
        break;
      case 'partners_only':
        query = query.eq('role', 'property_partner');
        break;
      case 'all_users':
      default:
        // Send to ALL non-deleted users regardless of role
        break;
    }

    // Apply scope
    if (scopeState) query = query.eq('state', scopeState);
    if (scopeLga) query = query.eq('city', scopeLga);

    const { data: users, error: userErr } = await query;
    if (userErr) {
      console.error('[sendAnnouncement] fetch users failed:', userErr);
      return { error: { message: `Failed to fetch users: ${userErr.message}` } };
    }
    targetUserIds = (users || []).map((u: any) => u.user_id).filter((id: string) => id && id !== senderId);
  }

  if (targetUserIds.length === 0) {
    return { error: { message: 'No users match the selected target' } };
  }

  // Step 3: Insert recipient rows
  const rows = targetUserIds.map((uid) => ({ announcement_id: announcement.id, user_id: uid }));
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error: batchErr } = await supabase.from('announcement_recipients').insert(batch);
    if (batchErr) console.error(`[sendAnnouncement] batch ${i} failed:`, batchErr);
  }

  // Step 4: Update recipient_count
  await supabase.from('announcements').update({ recipient_count: rows.length }).eq('id', announcement.id);

  return { error: null, announcement: { ...announcement, recipient_count: rows.length } as Announcement, recipientCount: rows.length };
}

export async function getAnnouncementsForUser(userId: string) {
  try {
    // Join announcement_recipients with announcements
    const { data, error } = await supabase
      .from('announcement_recipients')
      .select('id, announcement_id, read_status, delivered_at, announcements(*)')
      .eq('user_id', userId)
      .order('delivered_at', { ascending: false });

    if (error) {
      if (error.message?.includes('does not exist')) return { messages: [], error: null };
      return { messages: [], error };
    }

    const messages = (data || []).map((row: any) => ({
      ...row,
      message: row.announcements,
    }));

    return { messages, error: null };
  } catch (e: any) {
    return { messages: [], error: null };
  }
}

export async function markAnnouncementRead(announcementId: number, userId: string) {
  // Update recipient row
  const { error: updateErr } = await supabase
    .from('announcement_recipients')
    .update({ read_status: true })
    .eq('announcement_id', announcementId)
    .eq('user_id', userId);

  // Update read count on announcement
  const { count } = await supabase
    .from('announcement_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('announcement_id', announcementId)
    .eq('read_status', true);

  await supabase.from('announcements').update({ read_count: count || 0 }).eq('id', announcementId);

  return { error: updateErr };
}

export async function deleteAnnouncement(announcementId: number) {
  const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
  return { error };
}

export async function getAnnouncementsSentBy(senderId: string) {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('created_by', senderId)
    .order('created_at', { ascending: false });
  return { messages: data as Announcement[] | null, error };
}

export async function getAllAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  return { messages: data as Announcement[] | null, error };
}

export async function getUnreadAnnouncementCount(userId: string) {
  const { count, error } = await supabase
    .from('announcement_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read_status', false);
  return { count: count || 0, error };
}

export async function getAnnouncementStats(announcementId: number) {
  const { data: announcement, error } = await supabase
    .from('announcements')
    .select('recipient_count, read_count')
    .eq('id', announcementId)
    .maybeSingle();
  return { stats: announcement || { recipient_count: 0, read_count: 0 }, error };
}

// Legacy aliases for backward compatibility
export const getOfficialMessagesForUser = getAnnouncementsForUser;
export const markOfficialMessageRead = (rowId: string) => markAnnouncementRead(Number(rowId), '');
export const deleteOfficialMessage = (id: string) => deleteAnnouncement(Number(id));
export const getOfficialMessagesSentBy = getAnnouncementsSentBy;
export const getAllOfficialMessages = getAllAnnouncements;
export const getUnreadOfficialCount = getUnreadAnnouncementCount;
export const checkOfficialMessageTables = checkAnnouncementTables;
export const getMessageRecipientCount = async (id: string | number) => {
  const { stats } = await getAnnouncementStats(Number(id));
  return { count: stats.recipient_count, error: null };
};
export const getFilteredRecipientCount = async (includeWorkers: boolean, includeStaff: boolean, scopeState?: string, scopeLga?: string) => {
  const allowedRoles: string[] = ['user'];
  if (includeWorkers) allowedRoles.push('worker');
  if (includeStaff) allowedRoles.push('staff', 'admin');
  let query = supabase.from('profiles').select('*', { count: 'exact', head: true }).is('deleted_at', null).in('role', allowedRoles);
  if (scopeState) query = query.eq('state', scopeState);
  if (scopeLga) query = query.eq('city', scopeLga);
  const { count, error } = await query;
  return { count: count || 0, error };
};

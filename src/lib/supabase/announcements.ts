import { supabase } from './client';
import type { Announcement, AnnouncementTargetType } from '@/types';

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
  _senderName: string,
  title: string,
  message: string,
  targetType: AnnouncementTargetType,
  options: { recipientIds?: string[]; scopeState?: string; scopeLga?: string; targetRoles?: string[] } = {}
) {
  const { recipientIds, scopeState, scopeLga, targetRoles } = options;

  // Admin announcements are always derived from the authenticated Admin's branch server-side.
  if (senderRole === 'admin') {
    const roles = (targetRoles || []).filter((role) => ['user', 'worker', 'staff', 'property_partner'].includes(role));
    const { data, error } = await supabase.rpc('admin_send_branch_announcement', {
      p_content: message.trim(),
      p_target_roles: roles,
      p_recipient_ids: targetType === 'specific_user' ? (recipientIds || []) : null,
    });
    return {
      error,
      announcement: error ? null : ({ id: (data as any)?.id, title, content: message, sender_id: senderId, sender_role: senderRole, target_type: targetType, recipient_count: (data as any)?.recipient_count || 0 } as any),
      recipientCount: error ? 0 : Number((data as any)?.recipient_count || 0),
    };
  }

  // Creator path remains global or explicitly scoped by the Creator UI.
  const { data: announcement, error: insertErr } = await supabase
    .from('announcements')
    .insert({
      title,
      content: message,
      sender_id: senderId,
      sender_role: senderRole,
      target_type: targetType,
      scope: scopeState && scopeLga ? `${scopeState} / ${scopeLga}` : null,
    })
    .select()
    .maybeSingle();

  if (insertErr || !announcement) {
    return { error: { message: `Insert failed: ${insertErr?.message || 'unknown'}` } };
  }

  let targetUserIds: string[] = [];
  if (targetType === 'specific_user' && recipientIds && recipientIds.length > 0) {
    targetUserIds = recipientIds;
  } else {
    let query = supabase.from('profiles').select('user_id').is('deleted_at', null);
    if (targetRoles?.length) {
      query = query.in('role', targetRoles);
    } else {
      switch (targetType) {
        case 'all_workers': query = query.eq('role', 'worker'); break;
        case 'verified_workers': query = query.eq('role', 'worker').eq('worker_verified', true); break;
        case 'admins': query = query.in('role', ['admin', 'creator']); break;
        case 'staff_only': query = query.eq('role', 'staff'); break;
        case 'admin_only': query = query.eq('role', 'admin'); break;
        case 'partners_only': query = query.eq('role', 'property_partner'); break;
        default: break;
      }
    }
    if (scopeState) query = query.eq('state', scopeState);
    if (scopeLga) query = query.or(`local_government.eq.${scopeLga},city.eq.${scopeLga}`);
    const { data: users, error: userErr } = await query;
    if (userErr) return { error: { message: `Failed to fetch users: ${userErr.message}` } };
    targetUserIds = (users || []).map((u: any) => u.user_id).filter((id: string) => id && id !== senderId);
  }

  if (targetUserIds.length === 0) return { error: { message: 'No users match the selected target' } };

  const rows = targetUserIds.map((uid) => ({ announcement_id: announcement.id, user_id: uid }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('announcement_recipients').insert(rows.slice(i, i + 500));
    if (error) return { error };
  }
  await supabase.from('announcements').update({ recipient_count: rows.length }).eq('id', announcement.id);
  return { error: null, announcement: { ...announcement, recipient_count: rows.length } as Announcement, recipientCount: rows.length };
}

export async function getAnnouncementsForUser(userId: string) {
  try {
    const { data, error } = await supabase
      .from('announcement_recipients')
      .select('id, announcement_id, read_status, delivered_at, announcements(*)')
      .eq('user_id', userId)
      .order('delivered_at', { ascending: false });
    if (error) {
      if (error.message?.includes('does not exist')) return { messages: [], error: null };
      return { messages: [], error };
    }
    return { messages: (data || []).map((row: any) => ({ ...row, message: row.announcements })), error: null };
  } catch {
    return { messages: [], error: null };
  }
}

export async function markAnnouncementRead(announcementId: number, _userId: string) {
  const { error } = await supabase.rpc('mark_my_announcement_read', { p_announcement_id: announcementId });
  return { error };
}

export async function deleteAnnouncement(announcementId: number) {
  const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
  return { error };
}

export async function getAnnouncementsSentBy(senderId: string) {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, content, sender_id, sender_role, target_type, scope, recipient_count, read_count, created_at, profiles:sender_id (username)')
    .eq('sender_id', senderId)
    .order('created_at', { ascending: false });
  return { messages: data as any[] | null, error };
}

export async function getAllAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, content, sender_id, sender_role, target_type, scope, recipient_count, read_count, created_at, profiles:sender_id (username)')
    .order('created_at', { ascending: false });
  return { messages: data as any[] | null, error };
}

export async function getUnreadAnnouncementCount(userId: string) {
  const { count, error } = await supabase.from('announcement_recipients').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('read_status', false);
  return { count: count || 0, error };
}

export async function getAnnouncementStats(announcementId: number) {
  const { data: announcement, error } = await supabase.from('announcements').select('recipient_count, read_count').eq('id', announcementId).maybeSingle();
  return { stats: announcement || { recipient_count: 0, read_count: 0 }, error };
}

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

export const getFilteredRecipientCount = async (
  includeUsers: boolean,
  includeWorkers: boolean,
  includeStaff: boolean,
  includePartners: boolean,
  scopeState?: string,
  scopeLga?: string,
  senderRole?: string
) => {
  const allowedRoles: string[] = [];
  if (includeUsers) allowedRoles.push('user');
  if (includeWorkers) allowedRoles.push('worker');
  if (includeStaff) allowedRoles.push('staff');
  if (includePartners) allowedRoles.push('property_partner');
  if (allowedRoles.length === 0) return { count: 0, error: null };

  if (senderRole === 'admin') {
    const { data, error } = await supabase.rpc('admin_count_branch_announcement_recipients', { p_target_roles: allowedRoles });
    return { count: Number(data || 0), error };
  }

  let query = supabase.from('profiles').select('*', { count: 'exact', head: true }).is('deleted_at', null).in('role', allowedRoles);
  if (scopeState) query = query.eq('state', scopeState);
  if (scopeLga) query = query.or(`local_government.eq.${scopeLga},city.eq.${scopeLga}`);
  const { count, error } = await query;
  return { count: count || 0, error };
};

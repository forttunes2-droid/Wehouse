import { supabase } from './client';
import type { Notification } from '@/types';

// ─── NOTIFICATIONS ─────────────────────────────────

export async function getNotifications(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { notifications: data as Notification[] | null, error };
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
  return { error };
}

export async function createNotification(userId: string, title: string, body: string, type: string = 'general') {
  const { error } = await supabase.from('notifications').insert({ user_id: userId, title, body, type });
  return { error };
}

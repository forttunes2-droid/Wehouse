import { supabase } from './client';
import type { Notification } from '@/types';

// Get notifications for a user
export async function getNotifications(userId: string, limit = 50) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { notifications: data as Notification[] | null, error };
}

// Get unread count
export async function getUnreadNotificationCount(userId: string) {
  const { data, error } = await supabase.rpc('get_unread_notification_count', {
    p_user_id: userId,
  });
  return { count: data || 0, error };
}

// Mark all as read
export async function markNotificationsRead(userId: string) {
  const { error } = await supabase.rpc('mark_notifications_read', {
    p_user_id: userId,
  });
  return { error };
}

// Mark single as read
export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);
  return { error };
}

// Subscribe to notifications (real-time)
export function subscribeToNotifications(userId: string, onNotification: (notif: Notification) => void) {
  return supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        onNotification(payload.new as Notification);
      }
    )
    .subscribe();
}

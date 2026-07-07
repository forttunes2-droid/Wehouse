// ═══════════════════════════════════════════════════════════
// PART 4.6 — UNREAD COUNTS
// Messages, Notifications, Support, Bookings, Inspections
// Everything updates automatically.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export interface UnreadCounts {
  messages: number;        // Unread conversation messages
  notifications: number;   // Unread notifications
  support: number;         // Unread support messages
  bookings: number;        // New/pending bookings
  inspections: number;     // New/pending inspections
  total: number;           // Sum of all
}

/**
 * Get all unread counts for a user.
 * Fetches from multiple tables and aggregates.
 */
export function useUnreadCounts(userId: string, userRole: string) {
  const [counts, setCounts] = useState<UnreadCounts>({
    messages: 0,
    notifications: 0,
    support: 0,
    bookings: 0,
    inspections: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!userId) return;

    try {
      // 1. Unread messages (conversation unread counts)
      const { data: convs } = await supabase
        .from('conversations')
        .select('unread_a, unread_b, participant_a, participant_b')
        .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
        .eq('status', 'active');

      let unreadMessages = 0;
      (convs || []).forEach((c: any) => {
        if (c.participant_a === userId) unreadMessages += c.unread_a || 0;
        if (c.participant_b === userId) unreadMessages += c.unread_b || 0;
      });

      // 2. Unread notifications
      const { count: unreadNotifications } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      // 3. Support unread (for staff: new partner_support messages)
      let supportCount = 0;
      if (userRole === 'staff' || userRole === 'admin' || userRole === 'creator') {
        const { data: supportConvs } = await supabase
          .from('partner_support_conversations')
          .select('unread_partner_count, unread_staff_count')
          .eq('status', 'active');
        (supportConvs || []).forEach((c: any) => {
          supportCount += c.unread_staff_count || 0;
        });
      }

      // 4. New/pending bookings
      let bookingCount = 0;
      if (userRole === 'worker') {
        const { count } = await supabase
          .from('worker_bookings')
          .select('*', { count: 'exact', head: true })
          .eq('worker_id', userId)
          .eq('status', 'pending');
        bookingCount = count || 0;
      } else if (userRole === 'property_partner') {
        const { count } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        bookingCount = count || 0;
      }

      // 5. Pending inspections
      let inspectionCount = 0;
      if (userRole === 'staff' || userRole === 'field_officer') {
        const { count } = await supabase
          .from('user_inspection_requests')
          .select('*', { count: 'exact', head: true })
          .eq('field_officer_id', userId)
          .in('status', ['pending', 'scheduled']);
        inspectionCount = count || 0;
      } else if (userRole === 'user') {
        const { count } = await supabase
          .from('user_inspection_requests')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('status', ['pending', 'scheduled', 'in_progress']);
        inspectionCount = count || 0;
      } else if (userRole === 'property_partner') {
        const { count } = await supabase
          .from('user_inspection_requests')
          .select('*', { count: 'exact', head: true })
          .in('status', ['pending', 'scheduled']);
        inspectionCount = count || 0;
      }

      const newCounts: UnreadCounts = {
        messages: unreadMessages,
        notifications: unreadNotifications || 0,
        support: supportCount,
        bookings: bookingCount,
        inspections: inspectionCount,
        total: unreadMessages + (unreadNotifications || 0) + supportCount + bookingCount + inspectionCount,
      };

      setCounts(newCounts);
      setLoading(false);
    } catch (err) {
      console.error('[useUnreadCounts] Error:', err);
      setLoading(false);
    }
  }, [userId, userRole]);

  useEffect(() => {
    fetchCounts();

    // Poll every 30 seconds for updates
    intervalRef.current = setInterval(fetchCounts, 30000);

    // Subscribe to real-time changes
    const channels: any[] = [];

    // Subscribe to conversation changes
    const convChannel = supabase
      .channel(`unread-convs:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, fetchCounts)
      .subscribe();
    channels.push(convChannel);

    // Subscribe to notification changes
    const notifChannel = supabase
      .channel(`unread-notifs:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, fetchCounts)
      .subscribe();
    channels.push(notifChannel);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [fetchCounts, userId]);

  return { counts, loading, refresh: fetchCounts };
}

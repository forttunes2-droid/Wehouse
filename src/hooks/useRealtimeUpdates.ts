// ═══════════════════════════════════════════════════════════
// PART 4.5 — REAL-TIME RULES
// "Everything updates after refresh. Nothing is hardcoded."
// Subscribe to database changes for live dashboard updates.
// ═══════════════════════════════════════════════════════════

import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export type RealtimeChangeType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeConfig {
  table: string;
  event?: RealtimeChangeType;
  filter?: string;
  onChange: (payload: any) => void;
}

/**
 * Subscribe to real-time database changes.
 * Used by dashboards to auto-update when data changes.
 *
 * Example:
 *   useRealtimeUpdates([
 *     { table: 'bookings', event: 'INSERT', onChange: (p) => refreshBookings() },
 *     { table: 'notifications', filter: `user_id=eq.${userId}`, onChange: (p) => refreshNotifications() },
 *   ]);
 */
export function useRealtimeUpdates(configs: RealtimeConfig[], deps: any[] = []) {
  const channelsRef = useRef<any[]>([]);

  const subscribe = useCallback(() => {
    // Unsubscribe from previous channels
    channelsRef.current.forEach((ch) => {
      supabase.removeChannel(ch);
    });
    channelsRef.current = [];

    configs.forEach((cfg) => {
      const channelName = `realtime:${cfg.table}:${cfg.event || 'ALL'}:${Math.random().toString(36).slice(2, 8)}`;

      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: cfg.event || '*',
            schema: 'public',
            table: cfg.table,
            filter: cfg.filter,
          },
          (payload) => {
            cfg.onChange(payload);
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            // console.log(`[Realtime] Subscribed to ${cfg.table}`);
          }
          if (status === 'CHANNEL_ERROR') {
            console.error(`[Realtime] Error subscribing to ${cfg.table}`);
          }
        });

      channelsRef.current.push(channel);
    });
  }, deps);

  useEffect(() => {
    subscribe();
    return () => {
      channelsRef.current.forEach((ch) => {
        supabase.removeChannel(ch);
      });
      channelsRef.current = [];
    };
  }, [subscribe]);
}

/**
 * Specific hook for admin/creator dashboards.
 * Subscribes to all tables that affect dashboard stats.
 */
export function useDashboardRealtime(
  userRole: string,
  userId: string,
  onRefresh: () => void
) {
  const configs: RealtimeConfig[] = [];

  if (userRole === 'creator' || userRole === 'admin') {
    // Platform-wide stats
    configs.push(
      { table: 'profiles', event: 'INSERT', onChange: onRefresh },
      { table: 'profiles', event: 'UPDATE', onChange: onRefresh },
      { table: 'listings', event: 'INSERT', onChange: onRefresh },
      { table: 'listings', event: 'UPDATE', onChange: onRefresh },
      { table: 'bookings', event: 'INSERT', onChange: onRefresh },
      { table: 'bookings', event: 'UPDATE', onChange: onRefresh },
      { table: 'transactions', event: 'INSERT', onChange: onRefresh },
      { table: 'worker_bookings', event: 'INSERT', onChange: onRefresh },
      { table: 'worker_bookings', event: 'UPDATE', onChange: onRefresh },
      { table: 'user_inspection_requests', event: 'INSERT', onChange: onRefresh },
      { table: 'user_inspection_requests', event: 'UPDATE', onChange: onRefresh },
      { table: 'inspection_requests', event: 'INSERT', onChange: onRefresh },
      { table: 'inspection_requests', event: 'UPDATE', onChange: onRefresh }
    );
  } else if (userRole === 'staff') {
    // Staff-specific: inspections assigned to them
    configs.push(
      { table: 'user_inspection_requests', filter: `field_officer_id=eq.${userId}`, onChange: onRefresh },
      { table: 'inspection_requests', filter: `assigned_to=eq.${userId}`, onChange: onRefresh },
      { table: 'partner_support_conversations', event: 'INSERT', onChange: onRefresh }
    );
  } else if (userRole === 'property_partner') {
    // Partner-specific: their properties, bookings, inspections
    configs.push(
      { table: 'listings', filter: `owner_id=eq.${userId}`, onChange: onRefresh },
      { table: 'bookings', onChange: onRefresh },
      { table: 'user_inspection_requests', onChange: onRefresh },
      { table: 'transactions', filter: `recipient_id=eq.${userId}`, onChange: onRefresh }
    );
  } else if (userRole === 'worker') {
    // Worker-specific: their bookings, messages
    configs.push(
      { table: 'worker_bookings', filter: `worker_id=eq.${userId}`, onChange: onRefresh },
      { table: 'conversations', filter: `participant_b=eq.${userId}`, onChange: onRefresh }
    );
  } else if (userRole === 'user') {
    // User-specific: their reservations, bookings, messages
    configs.push(
      { table: 'reservations', filter: `user_id=eq.${userId}`, onChange: onRefresh },
      { table: 'bookings', filter: `user_id=eq.${userId}`, onChange: onRefresh },
      { table: 'user_inspection_requests', filter: `user_id=eq.${userId}`, onChange: onRefresh },
      { table: 'conversations', filter: `participant_a=eq.${userId}`, onChange: onRefresh },
      { table: 'notifications', filter: `user_id=eq.${userId}`, event: 'INSERT', onChange: onRefresh }
    );
  }

  useRealtimeUpdates(configs, [userRole, userId]);
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { formatActivityItem, getActionVerb } from '@/lib/activity-formatter';
import type { Profile } from '@/types';

interface ActivityProps {
  profile: Profile;
  onNavigate: (page: string, listingId?: string) => void;
  onGoToChat?: (convId: string) => void;
}

// ─── ACTION COLOR MAP ──────────────────────────────

function actionColor(action: string): string {
  switch (action) {
    case 'BAN': return 'bg-red-500/15 text-red-400 border-red-500/20';
    case 'SUSPEND': return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
    case 'ROLE_CHANGE': return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
    case 'PROMOTE': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
    case 'REACTIVATE': return 'bg-green-500/15 text-green-400 border-green-500/20';
    case 'UPDATE': return 'bg-purple-500/15 text-purple-400 border-purple-500/20';
    case 'INSERT': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20';
    case 'DELETE': return 'bg-red-500/15 text-red-400 border-red-500/20';
    default: return 'bg-gray-500/15 text-gray-400 border-gray-500/20';
  }
}

function actionIcon(action: string): string {
  switch (action) {
    case 'BAN': return '🚫';
    case 'SUSPEND': return '⏸️';
    case 'ROLE_CHANGE': return '👤';
    case 'PROMOTE': return '⬆️';
    case 'REACTIVATE': return '✅';
    case 'UPDATE': return '✏️';
    case 'INSERT': return '➕';
    case 'DELETE': return '🗑️';
    default: return '📌';
  }
}

function timeAgo(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── MAIN COMPONENT ─────────────────────────────────

export default function Activity({ profile: _profile }: ActivityProps) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      // Query audit_logs with profiles join (admin_id = auth.uid()::text → profiles.auth_id)
      const { data } = await supabase
        .from('audit_logs')
        .select(`
          action, target_type, target_id, details, admin_id, created_at,
          profiles:admin_id (username, role)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      setItems(data || []);
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  // Real-time: refresh when audit_logs changes
  useEffect(() => {
    const channel = supabase
      .channel('activity-audit')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => {
        loadActivity();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadActivity]);

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent pb-24">
        <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
          <div className="h-7 w-32 rounded-lg shimmer mb-2" />
          <div className="h-4 w-48 rounded shimmer" />
        </header>
        <div className="max-w-lg mx-auto px-5 space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-2xl">
              <div className="w-10 h-10 rounded-xl shimmer flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded shimmer w-2/3" />
                <div className="h-3 rounded shimmer w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-24">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <h1 className="text-lg font-bold text-white">Activity</h1>
        <p className="text-xs text-[#5C5E72] mt-1">
          {items.length > 0 ? `${items.length} platform events` : 'Platform activity feed'}
        </p>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-1">
        {items.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[#1A1A24] flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5">
                <path d="M12 20h9M12 20V10M12 20l-7-7m7 7V4m0 6l7-7" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white mb-1">No activity yet</p>
            <p className="text-xs text-[#5C5E72] leading-relaxed max-w-[260px] mx-auto">
              Platform activity will appear here — user actions, role changes, settings updates, and more.
            </p>
          </div>
        ) : (
          /* Audit timeline */
          items.map((item, index) => {
            const { title, subtitle, meta } = formatActivityItem(item);
            return (
              <div key={item.id || index} className="relative">
                {/* Timeline connector */}
                {index < items.length - 1 && (
                  <div className="absolute left-5 top-12 bottom-[-4px] w-px bg-[#1E1E2C]" />
                )}

                <div className="flex items-start gap-3 py-3 px-3 rounded-2xl">
                  {/* Action icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${actionColor(item.action)}`}>
                    <span className="text-base">{actionIcon(item.action)}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white/90 truncate">
                      {title}
                    </p>
                    {subtitle && (
                      <p className="text-[11px] text-[#5C5E72] truncate mt-0.5">{subtitle}</p>
                    )}
                    <p className="text-[9px] text-[#5C5E72]/60 mt-1">{meta}</p>
                  </div>

                  {/* Time ago */}
                  <span className="text-[9px] text-[#5C5E72] flex-shrink-0 mt-2.5">
                    {timeAgo(item.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

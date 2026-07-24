import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export function NotificationCenter({ profile }: { profile: Profile }) {
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const userId = profile.user_id;

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifs(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [userId]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`notifs:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const n = payload.new as NotifItem;
        setNotifs(prev => [n, ...prev]);
        toast.info(n.title, { description: n.body });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  async function markRead(id: string) {
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('user_id', userId).eq('is_read', false);
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
    toast.success('All notifications marked as read');
  }

  const unreadCount = notifs.filter(n => !n.is_read).length;

  const typeIcon = (type: string) => {
    if (type.includes('message')) return '💬';
    if (type.includes('booking')) return '📅';
    if (type.includes('inspection')) return '🔍';
    if (type.includes('payment')) return '💰';
    return '📢';
  };

  return (
    <div className="space-y-3">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Notifications</h3>
          {unreadCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-[10px] text-[#3B82F6] hover:text-white transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      {loading && (
        <div className="flex items-center gap-2 text-[10px] text-[#5C5E72] py-4">
          <div className="w-3 h-3 border border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      )}

      {!loading && notifs.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-[#5C5E72]">No notifications</p>
          <p className="text-[10px] text-[#5C5E72]/70 mt-1">Notifications appear here when something happens</p>
        </div>
      )}

      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {notifs.map(n => (
          <button
            key={n.id}
            onClick={() => !n.is_read && markRead(n.id)}
            className={`w-full text-left glass rounded-xl p-3 transition-all ${
              n.is_read ? 'opacity-50 border border-white/[0.02]' : 'border border-[#3B82F6]/10 bg-[#3B82F6]/[0.02]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-base flex-shrink-0">{typeIcon(n.type)}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs ${n.is_read ? 'text-[#8A8B9C]' : 'text-white font-medium'}`}>
                  {n.title}
                </p>
                <p className="text-[10px] text-[#5C5E72] mt-0.5">{n.body}</p>
                <p className="text-[9px] text-[#5C5E72] mt-1">
                  {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {' · '}
                  {new Date(n.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#3B82F6] flex-shrink-0 mt-1" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

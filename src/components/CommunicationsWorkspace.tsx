import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { AnnouncementsTab } from '@/components/AnnouncementsTab';
import type { Profile } from '@/types';

type View = 'inbox' | 'announcements';
type Scope = 'all' | { state: string; lga: string };

type Props = {
  profile: Profile;
  scope: Scope;
  onOpenConversation?: (id?: string) => void;
};

export default function CommunicationsWorkspace({ profile, scope, onOpenConversation }: Props) {
  const [view, setView] = useState<View>('inbox');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  async function loadInbox() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_support_inbox');
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (view === 'inbox') void loadInbox();
  }, [view, profile.user_id, profile.assigned_state, profile.assigned_lga]);

  const types = useMemo(() => {
    const values = Array.from(new Set(rows.map(row => row.conversation_type).filter(Boolean))) as string[];
    return ['all', ...values];
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (filter !== 'all' && row.conversation_type !== filter) return false;
      if (!q) return true;
      return [row.subject, row.user_name, row.user_email, row.last_message, row.conversation_type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, filter, search]);

  const unread = rows.filter(row => Number(row.unread_b || 0) > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Communications</h2>
          <p className="mt-1 text-[10px] text-[#707386]">
            {profile.role === 'creator'
              ? 'Platform conversations and official announcements in one workspace.'
              : `Branch conversations and announcements for ${profile.assigned_lga || 'your assigned branch'}.`}
          </p>
        </div>
        <div className="flex w-full rounded-xl border border-white/[0.06] bg-[#0D1017] p-1 sm:w-auto">
          <button onClick={() => setView('inbox')} className={`flex-1 rounded-lg px-4 py-2 text-[10px] font-semibold sm:flex-none ${view === 'inbox' ? 'bg-violet-500 text-white' : 'text-[#777A8C]'}`}>
            Inbox {unread > 0 ? `(${unread})` : ''}
          </button>
          <button onClick={() => setView('announcements')} className={`flex-1 rounded-lg px-4 py-2 text-[10px] font-semibold sm:flex-none ${view === 'announcements' ? 'bg-violet-500 text-white' : 'text-[#777A8C]'}`}>
            Announcements
          </button>
        </div>
      </div>

      {view === 'announcements' ? (
        <AnnouncementsTab profile={profile} scope={scope} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search conversations"
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#141720] px-3 text-xs text-white outline-none focus:border-violet-500/40"
            />
            <div className="flex max-w-full gap-2 overflow-x-auto scrollbar-hide">
              {types.map(type => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-semibold ${filter === type ? 'bg-violet-500 text-white' : 'border border-white/[0.06] bg-[#10131B] text-[#777A8C]'}`}
                >
                  {type === 'all' ? 'All' : type.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid min-h-40 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-12 text-center">
              <p className="text-sm font-semibold text-white">Inbox clear</p>
              <p className="mx-auto mt-2 max-w-md text-[10px] text-[#66697B]">No conversations match the current view.</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {shown.map(row => (
                <button
                  key={row.id}
                  onClick={() => onOpenConversation?.(row.id)}
                  className="rounded-2xl border border-white/[0.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{row.subject || row.user_name || row.user_email || 'Conversation'}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#6D7082]">{row.last_message || 'Open conversation'}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-[#565A6C]">
                        <span>{String(row.conversation_type || 'support').replace(/_/g, ' ')}</span>
                        {row.user_lga && <span>· {row.user_lga}</span>}
                        {row.user_state && <span>· {row.user_state}</span>}
                      </div>
                    </div>
                    {Number(row.unread_b || 0) > 0 && <span className="shrink-0 rounded-full bg-violet-500 px-2 py-1 text-[8px] font-bold text-white">{row.unread_b}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

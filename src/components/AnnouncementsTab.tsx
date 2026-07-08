import { useState, useEffect } from 'react';
import { supabase, getAllUsers, sendAnnouncement, deleteAnnouncement, getAnnouncementsSentBy, getAllAnnouncements, getFilteredRecipientCount, checkAnnouncementTables } from '@/lib/supabase';
import { canSendAnnouncements } from '@/hooks/useAuth';
import { useConfirm } from '@/hooks/useConfirm';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

const checkIsCreator = (p: Profile): boolean => p.role === 'creator';

// Individual announcement card — shows full content prominently
function AnnouncementCard({ msg, canSend, onDelete }: { msg: any; canSend: boolean; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const content = msg.content || '';
  const isLong = content.length > 200;
  const displayContent = expanded || !isLong ? content : content.slice(0, 200) + '...';

  return (
    <div className="rounded-2xl bg-[#1A1A24] border border-[#2A2A3A] overflow-hidden">
      {/* Header: sender + meta */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
          {(msg.sender_name || 'W').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-white truncate">{msg.sender_name || 'WeHouse'}</p>
          <p className="text-[9px] text-[#5C5E72]">
            {msg.sender_role || 'System'} · {new Date(msg.created_at).toLocaleString()}
          </p>
        </div>
        <span className="text-[9px] text-[#5C5E72] bg-white/[0.04] px-2 py-0.5 rounded-full flex-shrink-0">
          {msg.target_type === 'all_users' ? 'All Users' : msg.target_type}
        </span>
      </div>

      {/* CONTENT — the main focus */}
      <div className="px-4 pb-3">
        <button
          onClick={() => isLong && setExpanded(!expanded)}
          className={`w-full text-left ${isLong ? 'cursor-pointer' : ''}`}
        >
          <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{displayContent}</p>
          {isLong && (
            <span className="text-[10px] text-[#3B82F6] mt-1 block">
              {expanded ? 'Show less' : 'Read more'}
            </span>
          )}
        </button>
      </div>

      {/* Footer: scope + delete */}
      <div className="px-4 py-2 border-t border-white/[0.04] flex items-center justify-between">
        <span className="text-[9px] text-[#5C5E72]">
          {msg.scope_state ? `${msg.scope_state}${msg.scope_lga ? `, ${msg.scope_lga}` : ''}` : 'Platform-wide'}
        </span>
        {canSend && (
          <button onClick={() => onDelete(msg.id)} className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function AnnouncementsTab({ profile, scope }: { profile: Profile; scope: 'all' | { state: string; lga: string } }) {
  const canSend = canSendAnnouncements(profile.role);
  const isCreatorScope = scope === 'all';
  const isStateScope = !isCreatorScope && typeof scope === 'object';

  const [users, setUsers] = useState<any[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<any[]>([]);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [message, setMessage] = useState('');
  const [sendMode, setSendMode] = useState<'all' | 'select'>('all');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sentMessages, setSentMessages] = useState<any[]>([]);
  const [activeView, setActiveView] = useState<'compose' | 'history'>('compose');
  const { ask, dialogProps } = useConfirm();

  const canIncludeWorkers = checkIsCreator(profile) || profile.role === 'admin';
  const canIncludeStaff = checkIsCreator(profile) || profile.role === 'admin';
  const [includeUsers, setIncludeUsers] = useState(false);
  const [includeWorkers, setIncludeWorkers] = useState(false);
  const [includeStaff, setIncludeStaff] = useState(false);
  const [includePartners, setIncludePartners] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [countLoading, setCountLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ ok: boolean; issues: string[] }>({ ok: true, issues: [] });

  useEffect(() => {
    if (canSend) {
      checkAnnouncementTables().then((status) => {
        setDbStatus(status);
        if (!status.ok) toast.error('Announcement tables not set up. Run SQL in Supabase.', { duration: 8000 });
      });
      loadSentMessages();
      loadUsers();
    } else {
      loadSentMessages();
    }
  }, []);

  useEffect(() => {
    if (!canSend || sendMode === 'select') return;
    let cancelled = false;
    async function updateCount() {
      setCountLoading(true);
      const { count } = await getFilteredRecipientCount(
        includeUsers, includeWorkers, includeStaff, includePartners,
        isStateScope ? scope.state : undefined,
        isStateScope ? scope.lga : undefined
      );
      if (!cancelled) { setLiveCount(count); setCountLoading(false); }
    }
    updateCount();
    return () => { cancelled = true; };
  }, [includeUsers, includeWorkers, includeStaff, includePartners, sendMode, canSend, isStateScope]);

  async function loadUsers() {
    setUsersLoadError(null);
    const { users: data, error } = await getAllUsers();
    if (error || !data) {
      setUsersLoadError(error?.message || 'Database error');
      setUsers([]); setFilteredUsers([]); return;
    }
    let list = data.filter((u: any) => !u.deleted && !u.deleted_at && u.user_id !== profile.user_id && u.role === 'user');
    if (isStateScope) list = list.filter((u: any) => u.state === scope.state);
    setUsers(list); setFilteredUsers(list);
  }

  useEffect(() => {
    if (!userSearch.trim()) { setFilteredUsers(users); return; }
    const q = userSearch.toLowerCase();
    setFilteredUsers(users.filter((u: any) => {
      return (u.username || '').toLowerCase().includes(q) || (u.state || '').toLowerCase().includes(q) || (u.city || '').toLowerCase().includes(q);
    }));
  }, [userSearch, users]);

  async function loadSentMessages() {
    const isCreatorRole = checkIsCreator(profile);
    const { messages } = isCreatorRole ? await getAllAnnouncements() : await getAnnouncementsSentBy(profile.user_id);
    setSentMessages(messages || []);
  }

  async function handleDeleteMessage(messageId: string) {
    const ok = await ask({ title: 'Delete this message?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    toast.loading('Deleting...', { id: 'del-msg' });
    const { error } = await deleteAnnouncement(Number(messageId));
    toast.dismiss('del-msg');
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Message deleted');
    setSentMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  async function handleSend() {
    if (!message.trim()) { toast.error('Enter a message'); return; }
    if (sendMode === 'select' && selectedUsers.length === 0) { toast.error('Select at least one user'); return; }

    setSending(true);
    toast.loading('Sending...', { id: 'send' });

    const targetRoles: string[] = [];
    if (includeUsers) targetRoles.push('user');
    if (includeWorkers) targetRoles.push('worker');
    if (includeStaff) targetRoles.push('staff');
    if (includePartners) targetRoles.push('property_partner');

    const { error } = await sendAnnouncement(
      profile.user_id,
      profile.role,
      profile.full_name || profile.username || 'WeHouse',
      'Announcement',
      message.trim(),
      sendMode === 'all' ? 'all_users' : 'specific_user',
      {
        recipientIds: sendMode === 'select' ? selectedUsers : undefined,
        scopeState: isStateScope ? (scope as any).state : undefined,
        scopeLga: isStateScope ? (scope as any).lga : undefined,
      }
    );

    toast.dismiss('send'); setSending(false);
    if (error) { toast.error('Failed: ' + error.message); return; }

    toast.success(`Announcement sent to ${sendMode === 'select' ? selectedUsers.length + ' users' : 'all users'}`);
    setMessage(''); setSelectedUsers([]); setSendMode('all');
    loadSentMessages();
  }

  return (
    <div>
      <ConfirmDialog {...dialogProps} />
      <Toaster position="top-center" richColors theme="dark" />
      <div className="flex gap-2 mb-4">
        <button onClick={() => setActiveView('compose')} className={`px-4 py-2 rounded-xl text-xs font-semibold ${activeView === 'compose' ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] text-[#5C5E72]'}`}>Compose</button>
        <button onClick={() => setActiveView('history')} className={`px-4 py-2 rounded-xl text-xs font-semibold ${activeView === 'history' ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] text-[#5C5E72]'}`}>History ({sentMessages.length})</button>
      </div>

      {activeView === 'compose' && canSend && (
        <div className="space-y-4">
          {!dbStatus.ok && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400">Database issue: {dbStatus.issues.join(', ')}</p>
            </div>
          )}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your announcement..." rows={4} className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm p-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 focus:outline-none resize-none" />
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setSendMode('all')} className={`px-3 py-1.5 rounded-lg text-xs ${sendMode === 'all' ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] text-[#5C5E72]'}`}>All Users</button>
            <button onClick={() => setSendMode('select')} className={`px-3 py-1.5 rounded-lg text-xs ${sendMode === 'select' ? 'bg-[#3B82F6] text-white' : 'bg-[#1A1A24] text-[#5C5E72]'}`}>Select Users</button>
          </div>
          {sendMode === 'all' && (
            <div className="flex gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-[#8A8B9C]"><input type="checkbox" checked={includeUsers} onChange={(e) => setIncludeUsers(e.target.checked)} className="accent-[#3B82F6]" /> Users</label>
              {canIncludeWorkers && <label className="flex items-center gap-2 text-xs text-[#8A8B9C]"><input type="checkbox" checked={includeWorkers} onChange={(e) => setIncludeWorkers(e.target.checked)} className="accent-[#3B82F6]" /> Workers</label>}
              {canIncludeStaff && <label className="flex items-center gap-2 text-xs text-[#8A8B9C]"><input type="checkbox" checked={includeStaff} onChange={(e) => setIncludeStaff(e.target.checked)} className="accent-[#3B82F6]" /> Staff</label>}
              <label className="flex items-center gap-2 text-xs text-[#8A8B9C]"><input type="checkbox" checked={includePartners} onChange={(e) => setIncludePartners(e.target.checked)} className="accent-[#3B82F6]" /> Partners</label>
              {countLoading ? <span className="text-xs text-[#5C5E72]">Counting...</span> : <span className="text-xs text-[#3B82F6]">{liveCount} recipients</span>}
            </div>
          )}
          {sendMode === 'select' && (
            <div>
              <Input placeholder="Search users..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="mb-2" />
              {usersLoadError && <p className="text-xs text-red-400 mb-2">{usersLoadError}</p>}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredUsers.map((u: any) => (
                  <label key={u.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-[#1A1A24] hover:bg-[#232330] cursor-pointer">
                    <input type="checkbox" checked={selectedUsers.includes(u.user_id)} onChange={(e) => {
                      if (e.target.checked) setSelectedUsers([...selectedUsers, u.user_id]);
                      else setSelectedUsers(selectedUsers.filter((id) => id !== u.user_id));
                    }} className="accent-[#3B82F6]" />
                    <span className="text-xs text-white">{u.username || u.user_id}</span>
                    <span className="text-[10px] text-[#5C5E72]">{u.state}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-[#5C5E72] mt-1">{selectedUsers.length} selected</p>
            </div>
          )}
          <button onClick={handleSend} disabled={sending || !message.trim()} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold disabled:opacity-40">
            {sending ? 'Sending...' : 'Send Announcement'}
          </button>
        </div>
      )}

      {activeView === 'history' && (
        <div className="space-y-3">
          {sentMessages.length === 0 && <p className="text-sm text-[#5C5E72] text-center py-8">No announcements yet</p>}
          {sentMessages.map((msg: any) => (
            <AnnouncementCard key={msg.id} msg={msg} canSend={canSend} onDelete={handleDeleteMessage} />
          ))}
        </div>
      )}

      {!canSend && activeView === 'compose' && (
        <div className="text-center py-8">
          <p className="text-sm text-[#5C5E72]">You can only view announcements</p>
        </div>
      )}
    </div>
  );
}

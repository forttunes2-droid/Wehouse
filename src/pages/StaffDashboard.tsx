import { useState, useEffect, useCallback } from 'react';
import { supabase, getConversations, getListingsByOwner, getMessages, deleteListing, getProfileByAuthId } from '@/lib/supabase';
import type { Profile, Listing, Conversation } from '@/types';
import { Toaster, toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';


type StaffTab = 'overview' | 'listings' | 'enquiries';

interface StaffDashboardProps {
  profile: Profile;
  onLogout: () => void;
  onGoToChat?: (convId?: string) => void;
}

export default function StaffDashboard({ profile, onLogout, onGoToChat }: StaffDashboardProps) {
  const TAB_KEY = 'wh_staff_tab';
  // StaffTab type is defined at module level above
  const [activeTab, setActiveTab] = useState<StaffTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved && ['overview', 'listings', 'enquiries'].includes(saved) ? saved as StaffTab : 'overview';
    } catch { return 'overview'; }
  });

  const handleSetTab = useCallback((tab: StaffTab) => {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  }, []);

  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [enquiryDetails, setEnquiryDetails] = useState<Array<{ conv: Conversation; otherName: string; lastMessage: string; unread: number }>>([]);
  const [stats, setStats] = useState({ listings: 0, enquiries: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Get my listings
    const { listings: data } = await getListingsByOwner(profile.auth_id);
    const myList = data || [];
    setMyListings(myList);
    setStats(s => ({ ...s, listings: myList.length }));

    // Get my conversations (enquiries from users)
    const { conversations: convData } = await getConversations(profile.user_id);
    const convs = convData || [];
    setStats(s => ({ ...s, enquiries: convs.length }));

    // Build enquiry details with usernames
    const details = await Promise.all(
      convs.map(async (conv) => {
        const otherId = conv.participant_a === profile.user_id ? conv.participant_b : conv.participant_a;
        const isUnread = conv.participant_a === profile.user_id ? conv.unread_a > 0 : conv.unread_b > 0;
        // Get last message
        const { messages } = await getMessages(conv.id);
        const lastMsg = messages?.[messages.length - 1];
        // Get other person's profile
        const { profile: otherProfile } = await getProfileByAuthId(otherId);
        return {
          conv,
          otherName: otherProfile?.username || `User ${otherId.slice(-4)}`,
          lastMessage: lastMsg?.content || conv.last_message || 'No messages yet',
          unread: isUnread ? 1 : 0,
        };
      })
    );
    setEnquiryDetails(details);

    setLoading(false);
  }, [profile.auth_id, profile.user_id]);

  useEffect(() => { load(); }, [load]);

  // Subscribe to conversation updates
  useEffect(() => {
    const channel = supabase
      .channel('staff-enquiries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const tabs: Array<{ id: StaffTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'M4 6h16M4 12h16M4 18h16' },
    { id: 'listings', label: 'My Listings', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { id: 'enquiries', label: 'Enquiries', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-6">
      <Toaster position="top-center" toastOptions={{ style: { background: '#1A1A24', color: '#fff', border: '1px solid #232330' } }} />

      {/* Header */}
      <header className="bg-gradient-to-r from-amber-600 to-amber-800 px-5 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold text-white">Staff Dashboard</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-amber-400 bg-amber-500/10 border-amber-500/20">STAFF</span>
            </div>
            <p className="text-xs text-white/60">
              {profile.assigned_state || profile.state || 'No state assigned'}
              {profile.assigned_lga || profile.city ? ` · ${profile.assigned_lga || profile.city}` : ''}
            </p>
          </div>
          <button onClick={onLogout} className="h-8 px-3 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 transition-colors">Logout</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          {[
            { label: 'My Listings', value: stats.listings },
            { label: 'Enquiries', value: stats.enquiries },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => handleSetTab(s.label === 'My Listings' ? 'listings' : 'enquiries')}
              className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center text-left active:scale-[0.97] transition-transform"
            >
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="text-[10px] text-white/60">{s.label}</div>
            </button>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="px-5 -mt-4">
        <div className="glass rounded-xl p-1 flex gap-1 overflow-x-auto scrollbar-hide">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleSetTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium whitespace-nowrap rounded-lg transition-all flex-shrink-0 ${
                activeTab === tab.id ? 'bg-amber-500 text-white' : 'text-[#8A8B9C] hover:text-white'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={tab.icon} /></svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pt-4">
        {activeTab === 'overview' && <OverviewTab profile={profile} stats={stats} onGoToTab={handleSetTab} />}
        {activeTab === 'listings' && <MyListingsTab listings={myListings} loading={loading} onRefresh={load} />}
        {activeTab === 'enquiries' && <EnquiriesTab enquiries={enquiryDetails} loading={loading} onGoToChat={onGoToChat} />}
      </div>
    </div>
  );
}

// ─── OVERVIEW ──────────────────────────────────────
function OverviewTab({ profile, stats, onGoToTab }: { profile: Profile; stats: { listings: number; enquiries: number }; onGoToTab?: (tab: StaffTab) => void }) {
  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4 border border-amber-500/10">
        <p className="text-xs text-[#8A8B9C]">
          You have {stats.listings} listing{stats.listings !== 1 ? 's' : ''} and {stats.enquiries} active enquiry{stats.enquiries !== 1 ? 'ies' : ''}.
        </p>
        <p className="text-[10px] text-amber-400/70 mt-2">
          Your assigned location: {profile.assigned_lga || profile.city || 'Not set'}, {profile.assigned_state || profile.state || 'Not set'}
        </p>
      </div>

      {/* Quick Actions — clickable */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onGoToTab?.('listings')}
          className="glass rounded-2xl p-4 border border-amber-500/5 text-left active:scale-[0.97] transition-transform"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          </div>
          <p className="text-xs font-medium text-white">My Listings</p>
          <p className="text-[10px] text-[#5C5E72]">View and manage your listings</p>
        </button>
        <button
          onClick={() => onGoToTab?.('enquiries')}
          className="glass rounded-2xl p-4 border border-amber-500/5 text-left active:scale-[0.97] transition-transform"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center mb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </div>
          <p className="text-xs font-medium text-white">Reply Enquiries</p>
          <p className="text-[10px] text-[#5C5E72]">Chat with interested users</p>
        </button>
      </div>
    </div>
  );
}

// ─── MY LISTINGS ───────────────────────────────────
function MyListingsTab({ listings, loading, onRefresh }: { listings: Listing[]; loading: boolean; onRefresh: () => void }) {
  const { ask, dialogProps } = useConfirm();

  async function handleDelete(id: string) {
    const ok = await ask({ title: 'Delete this listing?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    const { error } = await deleteListing(id);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Listing deleted');
    onRefresh();
  }

  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <ConfirmDialog {...dialogProps} />
      {listings.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <p className="text-sm text-[#8A8B9C]">No listings yet</p>
          <p className="text-xs text-[#5C5E72] mt-1">Create your first listing from the Listings tab</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{listings.length} Listings</div>
          {listings.map(l => (
            <div key={l.id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3">
                <img src={l.images?.[0] || 'https://placehold.co/100x100/1A1A24/5C5E72?text=No+Image'} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{l.title}</p>
                  <p className="text-[10px] text-[#5C5E72]">{l.city} · N{l.price?.toLocaleString()}</p>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full border ${
                    l.status === 'available' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    l.status === 'reserved' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    'bg-[#1A1A24] text-[#5C5E72] border-[#232330]'
                  }`}>{l.status}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(l.id)}
                className="mt-2 w-full h-7 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ENQUIRIES ─────────────────────────────────────
function EnquiriesTab({ enquiries, loading, onGoToChat }: {
  enquiries: Array<{ conv: Conversation; otherName: string; lastMessage: string; unread: number }>;
  loading: boolean;
  onGoToChat?: (convId?: string) => void;
}) {
  if (loading) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-2">
      {enquiries.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </div>
          <p className="text-sm text-[#8A8B9C]">No enquiries yet</p>
          <p className="text-xs text-[#5C5E72] mt-1">When users message you about your listings, they will appear here</p>
        </div>
      ) : (
        <>
          <div className="text-[10px] text-[#5C5E72] font-medium uppercase tracking-wider">{enquiries.length} Enquiries</div>
          {enquiries.map(({ conv, otherName, lastMessage, unread }) => (
            <button
              key={conv.id}
              onClick={() => onGoToChat?.(conv.id)}
              className="w-full glass rounded-xl p-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {otherName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white truncate">@{otherName}</span>
                  {unread > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />}
                </div>
                <p className="text-xs text-[#8A8B9C] truncate">{lastMessage}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

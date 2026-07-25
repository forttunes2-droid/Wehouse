import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface UserProfileModalProps {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string) => void;
}

interface WorkerStats {
  totalBookings: number;
  completedBookings: number;
  totalEarnings: number;
  avgRating: number;
  reviewCount: number;
}

interface PartnerProperty {
  id: string;
  title: string;
  state: string;
  city: string;
  price: number;
  status: string;
  created_at: string;
}

export default function UserProfileModal({ user, adminProfile, onClose, onPromote, onNavigate }: UserProfileModalProps) {
  if (!user) return null;

  const [confirmingPromote, setConfirmingPromote] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [workerStats, setWorkerStats] = useState<WorkerStats | null>(null);
  const [partnerProperties, setPartnerProperties] = useState<PartnerProperty[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [supportConvoId, setSupportConvoId] = useState<string | null>(null);

  const isAdmin = adminProfile?.role === 'admin';
  const isCreator = adminProfile?.role === 'creator' || adminProfile?.role === 'creator_admin';
  const isOperator = isAdmin || isCreator;

  // Admin branch
  const adminState = adminProfile?.assigned_state || adminProfile?.state || '';
  const adminLga = (adminProfile as any)?.assigned_lga || (adminProfile as any).local_government || (adminProfile as any).city || '';

  // User location
  const userState = user.state || '';
  const userLga = (user as any).local_government || (user as any).city || '';
  const inBranch = userState === adminState && userLga === adminLga;

  // Can appoint: Admin + user in branch + user role is 'user'
  const canAppoint = isAdmin && inBranch && user.role === 'user';

  const initials = (user.username || user.email[0] || 'U').toUpperCase();

  // Load role-specific data
  useEffect(() => {
    if (!user) return;
    const u = user; // capture for async closures

    async function loadWorkerStats() {
      if (u.role !== 'worker') return;
      setLoadingStats(true);

      // Get bookings
      const { data: bookings } = await supabase
        .from('worker_bookings')
        .select('status, agreed_amount, worker_receives')
        .eq('worker_id', u.user_id);

      const totalBookings = bookings?.length || 0;
      const completedBookings = bookings?.filter(b => b.status === 'approved_released').length || 0;
      const totalEarnings = bookings?.filter(b => b.status === 'approved_released').reduce((sum, b) => sum + (b.worker_receives || 0), 0) || 0;

      // Get reviews
      const { data: reviews } = await supabase
        .from('reviews')
        .select('rating')
        .eq('worker_id', u.user_id);

      const reviewCount = reviews?.length || 0;
      const avgRating = reviewCount > 0 ? (reviews!.reduce((sum, r) => sum + r.rating, 0) / reviewCount) : 0;

      setWorkerStats({ totalBookings, completedBookings, totalEarnings, avgRating, reviewCount });
      setLoadingStats(false);
    }

    async function loadPartnerProperties() {
      if (u.role !== 'property_partner') return;
      setLoadingStats(true);

      // Try partner_id first, then owner_id
      const { data: byPartner } = await supabase
        .from('listings')
        .select('id, title, state, city, price, status, created_at')
        .eq('partner_id', u.user_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (byPartner && byPartner.length > 0) {
        setPartnerProperties(byPartner);
      } else {
        // Fallback: try owner_id
        const { data: byOwner } = await supabase
          .from('listings')
          .select('id, title, state, city, price, status, created_at')
          .eq('owner_id', u.user_id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        setPartnerProperties(byOwner || []);
      }
      setLoadingStats(false);
    }

    async function findSupportConversation() {
      // Look for existing support conversation
      const { data: convos } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_a.eq.${u.user_id},participant_b.eq.${u.user_id}`)
        .in('conversation_type', ['partner_support', 'general_support'])
        .limit(1);

      if (convos && convos.length > 0) {
        setSupportConvoId(convos[0].id);
      }
    }

    loadWorkerStats();
    loadPartnerProperties();
    findSupportConversation();
  }, [user.user_id, user.role]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  async function handlePromote() {
    if (!user) return;
    setPromoting(true);
    const { data, error } = await supabase.rpc('admin_promote_to_staff', {
      p_target_user_id: user.user_id,
    });
    setPromoting(false);
    setConfirmingPromote(false);

    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    if (data) {
      toast.success(`${user.username || 'User'} appointed as Staff`);
      onPromote?.();
      onClose();
    }
  }

  async function goToSupportConversation() {
    if (supportConvoId && onNavigate) {
      onNavigate(`chat_${supportConvoId}`);
      onClose();
    } else {
      toast.info('No support conversation found');
    }
  }

  function viewProperty(listingId: string) {
    if (onNavigate) {
      onNavigate(`detail_${listingId}`);
      onClose();
    }
  }

  function viewAllProperties() {
    // Navigate to listings tab filtered by this partner
    toast.info('Partner listings filter coming soon');
  }

  const roleDisplay = user.role === 'user' ? 'User'
    : user.role === 'worker' ? 'Worker'
    : user.role === 'property_partner' ? 'Property Partner'
    : user.role === 'staff' ? 'Staff'
    : user.role === 'admin' ? 'Admin'
    : user.role;

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.75)',
      }}
      onClick={onClose}
    >
      {/* Scrollable container */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top spacer for bottom-sheet feel */}
        <div className="h-[6vh] sm:h-[8vh]" />

        {/* Modal Card */}
        <div className="bg-[#0E0E14] w-full sm:w-[460px] sm:rounded-3xl rounded-t-3xl border border-[#232330] mx-auto shadow-2xl">
          {/* DEBUG: Version marker */}
          <div className="bg-red-600 text-white text-[10px] font-bold text-center py-1 px-3">v2.1 ENHANCED PROFILE</div>
          
          {/* ═══ HEADER ═══ */}
          <div className="relative bg-gradient-to-br from-indigo-900/30 to-[#0E0E14] px-5 pt-6 pb-6">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center active:bg-white/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xl font-bold mb-3">
                {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full rounded-2xl object-cover" alt="" /> : initials}
              </div>
              <h3 className="text-base font-bold text-white">@{user.username || 'unknown'}</h3>
              <p className="text-xs text-[#5C5E72] mt-0.5">{user.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                  {roleDisplay}
                </span>
                {user.worker_verified && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Verified
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ═══ CONTENT ═══ */}
          <div className="px-5 pb-8 space-y-3">

            {/* ─── WORKER STATS ─── */}
            {user.role === 'worker' && workerStats && (
              <div className="grid grid-cols-2 gap-2">
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-white">{workerStats.totalBookings}</p>
                  <p className="text-[10px] text-[#5C5E72]">Total Bookings</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-emerald-400">{workerStats.completedBookings}</p>
                  <p className="text-[10px] text-[#5C5E72]">Completed</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-white">N{workerStats.totalEarnings.toLocaleString()}</p>
                  <p className="text-[10px] text-[#5C5E72]">Earnings</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-amber-400">{workerStats.avgRating > 0 ? workerStats.avgRating.toFixed(1) : '—'}</p>
                  <p className="text-[10px] text-[#5C5E72]">{workerStats.reviewCount} Reviews</p>
                </div>
              </div>
            )}

            {/* ─── PROPERTY PARTNER STATS ─── */}
            {user.role === 'property_partner' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-white">{partnerProperties.length}</p>
                  <p className="text-[10px] text-[#5C5E72]">Properties</p>
                </div>
                <div className="glass rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-emerald-400">{partnerProperties.filter(p => p.status === 'available').length}</p>
                  <p className="text-[10px] text-[#5C5E72]">Available</p>
                </div>
              </div>
            )}

            {/* ─── DETAILS ─── */}
            <div className="glass rounded-2xl p-4 space-y-3">
              {[
                { label: 'ID', value: user.user_id },
                { label: 'Full Name', value: user.full_name || 'Not set' },
                { label: 'Phone', value: user.phone || 'Not set' },
                { label: 'State', value: user.state || 'Not set' },
                { label: 'LGA', value: (user as any).local_government || (user as any).city || 'Not set' },
                { label: 'Joined', value: new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) },
                { label: 'Status', value: (user as any).deleted ? 'Deleted' : (user as any).worker_status === 'suspended' ? 'Suspended' : 'Active' },
              ].map(item => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">{item.label}</span>
                  <span className="text-white/80 font-medium">{item.value}</span>
                </div>
              ))}
            </div>

            {/* ─── WORKER BIO & SKILLS ─── */}
            {user.role === 'worker' && (
              <>
                {user.worker_occupation && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Occupation</p>
                    <p className="text-xs text-white/80 font-medium">{user.worker_occupation}</p>
                  </div>
                )}
                {user.worker_bio && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">About</p>
                    <p className="text-xs text-white/80 leading-relaxed">{user.worker_bio}</p>
                  </div>
                )}
                {user.worker_skills && user.worker_skills.length > 0 && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Skills</p>
                    <div className="flex flex-wrap gap-1.5">
                      {user.worker_skills.map((skill: string, i: number) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">{skill}</span>
                      ))}
                    </div>
                  </div>
                )}
                {user.worker_price && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Service Price</p>
                    <p className="text-xs text-white/80 font-medium">N{user.worker_price.toLocaleString()}</p>
                  </div>
                )}
                {user.worker_experience && (
                  <div className="glass rounded-2xl p-4">
                    <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Experience</p>
                    <p className="text-xs text-white/80">{user.worker_experience}</p>
                  </div>
                )}
              </>
            )}

            {/* ─── PROPERTY PARTNER PROPERTIES ─── */}
            {user.role === 'property_partner' && partnerProperties.length > 0 && (
              <div className="glass rounded-2xl p-4 space-y-3">
                <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Properties ({partnerProperties.length})</p>
                {partnerProperties.slice(0, 5).map(prop => (
                  <button
                    key={prop.id}
                    onClick={() => viewProperty(prop.id)}
                    className="w-full text-left glass rounded-xl p-3 hover:bg-[#1A1A24] transition-colors"
                  >
                    <p className="text-xs font-medium text-white truncate">{prop.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-[#5C5E72]">{prop.city}, {prop.state}</span>
                      <span className="text-[10px] text-[#3B82F6]">N{prop.price?.toLocaleString()}</span>
                    </div>
                    <span className={`inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded-full ${
                      prop.status === 'available' ? 'bg-emerald-500/10 text-emerald-400' :
                      prop.status === 'reserved' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-gray-500/10 text-gray-400'
                    }`}>{prop.status}</span>
                  </button>
                ))}
                {partnerProperties.length > 5 && (
                  <button onClick={viewAllProperties} className="w-full text-center text-[10px] text-[#3B82F6] py-1">
                    +{partnerProperties.length - 5} more properties
                  </button>
                )}
              </div>
            )}

            {/* ─── ABOUT / BIO ─── */}
            {(user as any).bio && (
              <div className="glass rounded-2xl p-4">
                <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">About</p>
                <p className="text-xs text-white/80 leading-relaxed">{(user as any).bio}</p>
              </div>
            )}

            {/* ─── CONTACT ─── */}
            <div className="glass rounded-2xl p-4 space-y-2">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Contact</p>
              {user.email && (
                <div className="flex items-center gap-2 text-xs text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  {user.email}
                </div>
              )}
              {user.phone && (
                <div className="flex items-center gap-2 text-xs text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  {user.phone}
                </div>
              )}
            </div>

            {/* ─── ACTION BUTTONS ─── */}
            <div className="space-y-2 pt-2">
              {/* Go to Support Conversation — for users, workers, partners */}
              {(user.role === 'user' || user.role === 'worker' || user.role === 'property_partner') && (
                <button
                  onClick={goToSupportConversation}
                  className="w-full h-10 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-[#3B82F6] text-xs font-semibold hover:bg-[#3B82F6]/20 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Go to Support Conversation
                </button>
              )}

              {/* View Properties — for property partners */}
              {user.role === 'property_partner' && partnerProperties.length > 0 && (
                <button
                  onClick={viewAllProperties}
                  className="w-full h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                  View All Properties
                </button>
              )}
            </div>

            {/* ─── MANAGEMENT: Promote to Staff ─── */}
            {canAppoint && (
              <div className="glass rounded-2xl p-4 border border-amber-500/10 mt-3">
                <h4 className="text-xs font-semibold text-amber-400 mb-2">Management</h4>
                {!confirmingPromote ? (
                  <button
                    onClick={() => setConfirmingPromote(true)}
                    className="w-full h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
                  >
                    Appoint as Staff
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] text-[#5C5E72]">
                      Promote <span className="text-white">@{user.username}</span> to Staff in your branch ({adminState} / {adminLga})?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmingPromote(false)}
                        className="flex-1 h-8 rounded-lg bg-[#12121A] border border-[#232330] text-[#5C5E72] text-[10px] font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handlePromote}
                        disabled={promoting}
                        className="flex-1 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-semibold disabled:opacity-50"
                      >
                        {promoting ? 'Appointing...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── CLOSE BUTTON ─── */}
            <button
              onClick={onClose}
              className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-[#5C5E72] text-xs font-semibold hover:bg-[#232330] transition-colors mt-2"
            >
              Close
            </button>
          </div>
        </div>

        {/* Bottom spacer */}
        <div className="h-20" />
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );

  return createPortal(modalContent, document.body);
}

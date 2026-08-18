import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';
import { Toaster, toast } from 'sonner';

interface UserProfileModalProps {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
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

type CreatorTeamRole='admin'|'staff';
type StaffModule='operations'|'finance'|'support'|'verification'|'field_officer';
const STAFF_MODULES:Array<[StaffModule,string]>=[['operations','Operations'],['finance','Finance'],['support','Support'],['verification','Verification'],['field_officer','Field Officer']];

export default function UserProfileModal({ user, adminProfile, onClose, onPromote, onNavigate, onGoToChat }: UserProfileModalProps) {
  if (!user) return null;

  const [confirmingPromote, setConfirmingPromote] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [workerStats, setWorkerStats] = useState<WorkerStats | null>(null);
  const [partnerProperties, setPartnerProperties] = useState<PartnerProperty[]>([]);
  const [supportConvoId, setSupportConvoId] = useState<string | null>(null);
  const [assigningTeamRole,setAssigningTeamRole]=useState(false);
  const [creatorRole,setCreatorRole]=useState<CreatorTeamRole|''>('');
  const [teamState,setTeamState]=useState('');
  const [teamLga,setTeamLga]=useState('');
  const [teamModule,setTeamModule]=useState<StaffModule|''>('');
  const [adminModule,setAdminModule]=useState<StaffModule>('operations');
  const [teamSaving,setTeamSaving]=useState(false);

  const isAdmin = adminProfile?.role === 'admin';
  const isCreator = adminProfile?.role === 'creator';
  const adminState = adminProfile?.assigned_state || adminProfile?.state || '';
  const adminLga = (adminProfile as any)?.assigned_lga || (adminProfile as any).local_government || (adminProfile as any).city || '';
  const userState = user.state || '';
  const userLga = (user as any).local_government || (user as any).city || '';
  const inBranch = userState === adminState && userLga === adminLga;
  const canAppoint = isAdmin && inBranch && user.role === 'user';
  const canCreatorAssign = isCreator && user.role === 'user';
  const teamStateData=NIGERIA_STATES.find(item=>item.state===teamState);
  const initials = (user.username || user.email[0] || 'U').toUpperCase();

  useEffect(() => {
    const u = user;

    async function loadWorkerStats() {
      if (u.role !== 'worker') return;
      const { data: bookings } = await supabase.from('worker_bookings').select('status, agreed_amount, worker_receives').eq('worker_id', u.user_id);
      const totalBookings = bookings?.length || 0;
      const completedBookings = bookings?.filter((b: any) => b.status === 'approved_released').length || 0;
      const totalEarnings = bookings?.filter((b: any) => b.status === 'approved_released').reduce((sum: number, b: any) => sum + (b.worker_receives || 0), 0) || 0;
      const { data: reviews } = await supabase.from('reviews').select('rating').eq('worker_id', u.user_id);
      const reviewCount = reviews?.length || 0;
      const avgRating = reviewCount > 0 ? (reviews!.reduce((sum: number, r: any) => sum + r.rating, 0) / reviewCount) : 0;
      setWorkerStats({ totalBookings, completedBookings, totalEarnings, avgRating, reviewCount });
    }

    async function loadPartnerProperties() {
      if (u.role !== 'property_partner') return;
      const { data: byPartner } = await supabase.from('listings').select('id, title, state, city, price, status, created_at').eq('partner_id', u.user_id).is('deleted_at', null).order('created_at', { ascending: false });
      if (byPartner && byPartner.length > 0) {
        setPartnerProperties(byPartner);
      } else {
        const { data: byOwner } = await supabase.from('listings').select('id, title, state, city, price, status, created_at').eq('owner_id', u.user_id).is('deleted_at', null).order('created_at', { ascending: false });
        setPartnerProperties(byOwner || []);
      }
    }

    async function findSupportConvo() {
      setSupportConvoId(null);
      const { data: convos } = await supabase.from('conversations').select('id').or(`participant_a.eq.${u.user_id},participant_b.eq.${u.user_id}`).in('conversation_type', ['partner_support', 'general_support']).limit(1);
      if (convos && convos.length > 0) setSupportConvoId(convos[0].id);
    }

    loadWorkerStats();
    loadPartnerProperties();
    findSupportConvo();
  }, [user.user_id, user.role]);

  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => { document.body.style.overflow = orig; document.body.style.touchAction = ''; };
  }, []);

  async function handlePromote() {
    if (!user) return;
    setPromoting(true);
    const { data, error } = await supabase.rpc('admin_appoint_staff', { p_target_user_id: user.user_id, p_module: adminModule });
    setPromoting(false); setConfirmingPromote(false);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    if (data) { toast.success(`${user.username || 'User'} appointed as ${STAFF_MODULES.find(([id])=>id===adminModule)?.[1]||'Staff'} Staff`); onPromote?.(); onClose(); }
  }

  async function handleCreatorAssign(){
    if(!user)return;
    if(!creatorRole)return toast.error('Choose Admin or Staff');
    if(!teamState||!teamLga)return toast.error('Choose the State and LGA for this team member');
    if(creatorRole==='staff'&&!teamModule)return toast.error('Choose the Staff operational module');
    setTeamSaving(true);
    const{data,error}=await supabase.rpc('creator_set_team_role',{p_target_user_id:user.user_id,p_new_role:creatorRole,p_state:teamState,p_lga:teamLga,p_module:creatorRole==='staff'?teamModule:null});
    setTeamSaving(false);
    if(error||data!==true)return toast.error(error?.message||'Could not assign team role');
    toast.success(`${user.username||'User'} assigned as ${creatorRole==='admin'?'Admin':'Staff'} in ${teamLga}, ${teamState}`);
    onPromote?.();
    onClose();
  }

  const roleLabel = user.role === 'user' ? 'User' : user.role === 'worker' ? 'Worker' : user.role === 'property_partner' ? 'Partner' : user.role === 'staff' ? 'Staff' : user.role === 'admin' ? 'Admin' : user.role;

  const content = (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" style={{ zIndex: 99999, touchAction: 'none' }} onClick={onClose}>
      <div className="absolute inset-0 overflow-y-auto bg-[#0E0E14] sm:bg-transparent sm:p-6" style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto min-h-full w-full bg-[#0E0E14] sm:min-h-0 sm:max-w-[560px] sm:rounded-3xl sm:border sm:border-[#232330] sm:shadow-2xl">
          <div className="relative border-b border-white/[.06] px-5 pb-5 pt-16 sm:pt-8">
            <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center active:bg-white/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-xl font-bold">
                {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full rounded-2xl object-cover" alt="" /> : initials}
              </div>
              <div className="min-w-0"><h3 className="truncate text-lg font-bold text-white">{user.full_name||`@${user.username||'unknown'}`}</h3>
              <p className="mt-0.5 truncate text-xs text-[#6D7282]">@{user.username||'unknown'} · {user.email}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">{roleLabel}</span>
                {user.worker_verified && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Verified</span>}
              </div></div>
            </div>
          </div>

          <div className="space-y-0 px-5 pb-8">
            {user.role === 'worker' && workerStats && (
              <div className="grid grid-cols-2 gap-2">
                <div className="glass rounded-xl p-3 text-center"><p className="text-lg font-bold text-white">{workerStats.totalBookings}</p><p className="text-[10px] text-[#5C5E72]">Total Bookings</p></div>
                <div className="glass rounded-xl p-3 text-center"><p className="text-lg font-bold text-emerald-400">{workerStats.completedBookings}</p><p className="text-[10px] text-[#5C5E72]">Completed</p></div>
                <div className="glass rounded-xl p-3 text-center"><p className="text-lg font-bold text-white">N{workerStats.totalEarnings.toLocaleString()}</p><p className="text-[10px] text-[#5C5E72]">Earnings</p></div>
                <div className="glass rounded-xl p-3 text-center"><p className="text-lg font-bold text-amber-400">{workerStats.avgRating > 0 ? workerStats.avgRating.toFixed(1) : '—'}</p><p className="text-[10px] text-[#5C5E72]">{workerStats.reviewCount} Reviews</p></div>
              </div>
            )}

            {user.role === 'property_partner' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="glass rounded-xl p-3 text-center"><p className="text-lg font-bold text-white">{partnerProperties.length}</p><p className="text-[10px] text-[#5C5E72]">Properties</p></div>
                <div className="glass rounded-xl p-3 text-center"><p className="text-lg font-bold text-emerald-400">{partnerProperties.filter(p => p.status === 'available').length}</p><p className="text-[10px] text-[#5C5E72]">Available</p></div>
              </div>
            )}

            <section className="divide-y divide-white/[.055] border-b border-white/[.06] py-3">
              {[
                { label: 'ID', value: user.user_id },
                { label: 'Full Name', value: user.full_name || 'Not set' },
                { label: 'Phone', value: user.phone || 'Not set' },
                { label: 'State', value: user.state || 'Not set' },
                { label: 'LGA', value: (user as any).local_government || (user as any).city || 'Not set' },
                { label: 'Joined', value: new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) },
                { label: 'Status', value: (user as any).deleted ? 'Deleted' : (user as any).banned ? 'Banned' : (user as any).suspended ? 'Suspended' : 'Active' },
              ].map(item => <div key={item.label} className="flex min-h-11 items-center justify-between gap-4 text-xs"><span className="text-[#676C7D]">{item.label}</span><span className="max-w-[65%] break-words text-right font-medium text-white/85">{item.value}</span></div>)}
            </section>

            {user.role === 'worker' && (
              <>
                {user.worker_occupation && <div className="glass rounded-2xl p-4"><p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Occupation</p><p className="text-xs text-white/80 font-medium">{user.worker_occupation}</p></div>}
                {user.worker_bio && <div className="glass rounded-2xl p-4"><p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">About</p><p className="text-xs text-white/80 leading-relaxed">{user.worker_bio}</p></div>}
                {user.worker_skills && user.worker_skills.length > 0 && <div className="glass rounded-2xl p-4"><p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Skills</p><div className="flex flex-wrap gap-1.5">{user.worker_skills.map((s: string, i: number) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">{s}</span>)}</div></div>}
                {user.worker_price && <div className="glass rounded-2xl p-4"><p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Service Price</p><p className="text-xs text-white/80 font-medium">N{user.worker_price.toLocaleString()}</p></div>}
                {user.worker_experience && <div className="glass rounded-2xl p-4"><p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Experience</p><p className="text-xs text-white/80">{user.worker_experience}</p></div>}
              </>
            )}

            {user.role === 'property_partner' && partnerProperties.length > 0 && (
              <div className="glass rounded-2xl p-4 space-y-3">
                <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Properties ({partnerProperties.length})</p>
                {partnerProperties.slice(0, 5).map(prop => <button key={prop.id} onClick={() => { onNavigate?.(`detail_${prop.id}`); onClose(); }} className="w-full text-left glass rounded-xl p-3 hover:bg-[#1A1A24] transition-colors"><p className="text-xs font-medium text-white truncate">{prop.title}</p><div className="flex items-center justify-between mt-1"><span className="text-[10px] text-[#5C5E72]">{prop.city}, {prop.state}</span><span className="text-[10px] text-[#3B82F6]">N{prop.price?.toLocaleString()}</span></div></button>)}
              </div>
            )}

            {(user as any).bio && <div className="glass rounded-2xl p-4"><p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">About</p><p className="text-xs text-white/80 leading-relaxed">{(user as any).bio}</p></div>}

            <div className="glass rounded-2xl p-4 space-y-2">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider mb-2">Contact</p>
              {user.email && <div className="flex items-center gap-2 break-all text-xs text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>{user.email}</div>}
              {user.phone && <div className="flex items-center gap-2 text-xs text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>{user.phone}</div>}
            </div>

            {supportConvoId && (user.role === 'user' || user.role === 'worker' || user.role === 'property_partner') && (
              <button onClick={() => {if (onGoToChat) {onGoToChat(supportConvoId);onClose();} else if (onNavigate) {onNavigate(`chat_${supportConvoId}`);onClose();}}} className="w-full h-10 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-[#3B82F6] text-xs font-semibold hover:bg-[#3B82F6]/20 transition-colors flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                Go to Support Conversation
              </button>
            )}

            {canCreatorAssign && (
              <div className="glass rounded-2xl border border-violet-500/15 p-4">
                <h4 className="text-xs font-semibold text-violet-300">Team assignment</h4>
                <p className="mt-1 text-[10px] leading-relaxed text-[#686D7E]">This account is currently a User. No operational role or module is assigned until you deliberately choose and confirm one.</p>
                {!assigningTeamRole?<button type="button" onClick={()=>setAssigningTeamRole(true)} className="mt-3 h-10 w-full rounded-xl border border-violet-500/25 text-xs font-semibold text-violet-200">Assign team role</button>:<><div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block"><span className="mb-1 block text-[9px] uppercase text-[#5E6375]">Role</span><select value={creatorRole} onChange={e=>{setCreatorRole(e.target.value as CreatorTeamRole|'');setTeamModule('')}} className="h-10 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs"><option value="">Choose role</option><option value="admin">Admin</option><option value="staff">Staff</option></select></label>
                  <label className="block"><span className="mb-1 block text-[9px] uppercase text-[#5E6375]">State</span><select value={teamState} onChange={e=>{setTeamState(e.target.value);setTeamLga('')}} className="h-10 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs"><option value="">Select State</option>{NIGERIA_STATES.map(item=><option key={item.state} value={item.state}>{item.state}</option>)}</select></label>
                  <label className="block"><span className="mb-1 block text-[9px] uppercase text-[#5E6375]">LGA</span><select value={teamLga} disabled={!teamState} onChange={e=>setTeamLga(e.target.value)} className="h-10 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs disabled:opacity-40"><option value="">Select LGA</option>{(teamStateData?.cities||[]).map(lga=><option key={lga} value={lga}>{lga}</option>)}</select></label>
                  {creatorRole==='staff'&&<label className="block"><span className="mb-1 block text-[9px] uppercase text-[#5E6375]">Staff module</span><select value={teamModule} onChange={e=>setTeamModule(e.target.value as StaffModule|'')} className="h-10 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs"><option value="">Choose one module</option>{STAFF_MODULES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={()=>{setAssigningTeamRole(false);setCreatorRole('');setTeamState('');setTeamLga('');setTeamModule('')}} className="h-10 rounded-xl border border-white/[.08] text-xs text-[#8C91A2]">Cancel</button><button onClick={()=>void handleCreatorAssign()} disabled={teamSaving||!creatorRole||!teamState||!teamLga||(creatorRole==='staff'&&!teamModule)} className="h-10 rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-40">{teamSaving?'Assigning…':'Confirm assignment'}</button></div></>}
              </div>
            )}

            {canAppoint && (
              <div className="glass rounded-2xl p-4 border border-amber-500/10">
                <h4 className="text-xs font-semibold text-amber-400">Management</h4>
                <p className="mt-1 text-[10px] text-[#666B7B]">Appoint this branch User as Staff and choose the one operational module they will work in.</p>
                <label className="mt-3 block"><span className="mb-1 block text-[9px] uppercase tracking-wide text-[#5E6375]">Staff module</span><select value={adminModule} disabled={promoting} onChange={e=>setAdminModule(e.target.value as StaffModule)} className="h-10 w-full rounded-xl border border-white/[.08] bg-[#171A23] px-3 text-xs text-white disabled:opacity-50">{STAFF_MODULES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
                {!confirmingPromote ? <button onClick={() => setConfirmingPromote(true)} className="mt-3 w-full h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors">Appoint as Staff</button> : <div className="mt-3 space-y-2"><p className="text-[10px] text-[#5C5E72]">Appoint <span className="text-white">@{user.username}</span> to the <span className="text-white">{STAFF_MODULES.find(([id])=>id===adminModule)?.[1]}</span> module?</p><div className="flex gap-2"><button onClick={() => setConfirmingPromote(false)} className="flex-1 h-8 rounded-lg bg-[#12121A] border border-[#232330] text-[#5C5E72] text-[10px] font-semibold">Cancel</button><button onClick={handlePromote} disabled={promoting} className="flex-1 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-[10px] font-semibold disabled:opacity-50">{promoting ? 'Appointing...' : 'Confirm'}</button></div></div>}
              </div>
            )}

            <button onClick={onClose} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-[#5C5E72] text-xs font-semibold hover:bg-[#232330] transition-colors">Close</button>
          </div>
        </div>
       </div>
      <Toaster position="top-center" richColors />
    </div>
  );

  return createPortal(content, document.body);
}

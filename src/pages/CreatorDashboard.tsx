import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import CreatorWorkerOversight from '@/components/CreatorWorkerOversight';
import CreatorAuditWorkspace from '@/components/CreatorAuditWorkspace';
import ServiceBookingOversight from '@/components/ServiceBookingOversight';
import UserProfileModal from '@/components/UserProfileModal';
import ServiceCategoryManager from '@/components/ServiceCategoryManager';
import PropertyTypeManager from '@/components/PropertyTypeManager';
import StaffListTab from './StaffListTab';
import CreatorAnalyticsV2 from './CreatorAnalyticsV2';
import CreatorSettingsTabV2 from './CreatorSettingsTabV2';
import Notifications from './Notifications';
import { supabase } from '@/lib/supabase';
import { useCreatorInboxSummary } from '@/hooks/useCreatorInboxSummary';
import type { Profile } from '@/types';

type Tab = 'home' | 'operations' | 'inbox' | 'settings';
type Operation = 'people' | 'team' | 'properties' | 'workers' | 'bookings' | 'reports' | 'finance' | 'analytics' | 'audit';
type PersonRole = 'user' | 'property_partner';
type Props = { profile: Profile; onLogout: () => void; onNavigate?: (page: string, id?: string) => void; onGoToChat?: (id?: string) => void };
type OperationTarget = { operation: Operation; id?: string } | null;

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'operations', label: 'Operations' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'settings', label: 'Settings' },
];

const NOTES: Record<Tab, string> = {
  home: 'A single overview of live inventory, people and work needing attention.',
  operations: 'Open the authoritative record for people, properties, bookings and platform control.',
  inbox: 'Support conversations and recent Activity.',
  settings: 'Platform rules, trust and marketplace configuration.',
};

const OPS: Array<{ id: Operation; label: string; note: string; group: 'Accounts' | 'Marketplace' | 'Platform' }> = [
  { id: 'people', label: 'People', note: 'Regular Users and Property Partners.', group: 'Accounts' },
  { id: 'team', label: 'Team', note: 'Admins, Operations members, branches and work areas.', group: 'Accounts' },
  { id: 'properties', label: 'Properties', note: 'Review submissions, visits and publishing.', group: 'Marketplace' },
  { id: 'workers', label: 'Workers', note: 'Worker onboarding and account decisions.', group: 'Marketplace' },
  { id: 'bookings', label: 'Bookings', note: 'Worker services, apartments and hotel stays.', group: 'Marketplace' },
  { id: 'reports', label: 'Listing issues', note: 'Review complaints about published listings.', group: 'Marketplace' },
  { id: 'finance', label: 'Finance', note: 'Payout requests and platform settlement records.', group: 'Platform' },
  { id: 'analytics', label: 'Analytics', note: 'Platform trends and lifecycle movement.', group: 'Platform' },
  { id: 'audit', label: 'Change history', note: 'Accountable changes to platform records.', group: 'Platform' },
];
const OP_GROUPS = ['Accounts', 'Marketplace', 'Platform'] as const;

export default function CreatorDashboard({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const [tab, setTab] = useState<Tab>('home');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [operationTarget, setOperationTarget] = useState<OperationTarget>(null);
  const [inboxTargetId, setInboxTargetId] = useState<string | undefined>();
  const [viewing, setViewing] = useState<Profile | null>(null);
  const inboxSummary = useCreatorInboxSummary(profile.user_id);

  function openOperation(next: Operation, id?: string) {
    setOperationTarget({ operation: next, id });
    setOperation(next);
    setTab('operations');
  }

  function openCreatorDestination(page: string, id?: string) {
    const route = String(page || '').toLowerCase();
    if (route === 'operations_properties' || route === 'listing_detail' || route === 'detail' || route.includes('propert')) {
      openOperation('properties', id);
      return;
    }
    if (route === 'operations_inbox' || route === 'my_reservations' || route === 'my_bookings' || route.includes('reservation') || route.includes('booking')) {
      openOperation('bookings', id);
      return;
    }
    if (route.includes('worker')) {
      openOperation('workers', id);
      return;
    }
    if (route === 'conversation' || route === 'messages' || route === 'chat') {
      setInboxTargetId(id);
      setTab('inbox');
      return;
    }
    onNavigate?.(page, id);
  }

  const nav = NAV.map((item) => item.id === 'inbox' ? { ...item, badge: inboxSummary.totalUnread } : item);
  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label="WEHOUSE · CREATOR"
        title={NAV.find((item) => item.id === tab)?.label || 'Creator'}
        description={NOTES[tab]}
        items={nav}
        active={tab}
        setActive={(id) => setTab(id as Tab)}
        onAccount={onNavigate ? () => onNavigate('profile') : undefined}
        onLogout={onLogout}
      >
        {tab === 'home' && <Overview openOperation={openOperation} openInbox={() => setTab('inbox')} />}
        {tab === 'operations' && <Operations profile={profile} active={operation} target={operationTarget} setActive={(next) => { setOperation(next); if (!next) setOperationTarget(null); }} onView={setViewing} />}
        {tab === 'inbox' && <CreatorInbox profile={profile} onNavigate={openCreatorDestination} onGoToChat={onGoToChat} initialConversationId={inboxTargetId} summary={inboxSummary} />}
        {tab === 'settings' && <Settings profile={profile} />}
      </WorkspaceFrameV2>
      {viewing && <UserProfileModal user={viewing} adminProfile={profile} onClose={() => setViewing(null)} onNavigate={openCreatorDestination} onGoToChat={onGoToChat} />}
    </>
  );
}

function Overview({ openOperation, openInbox }: { openOperation: (tab: Operation) => void; openInbox: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [base, hotels, team, payouts, inspections] = await Promise.all([
        supabase.rpc('admin_get_my_branch_stats'),
        supabase.from('hotels').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['admin', 'staff']).eq('deleted', false),
        supabase.from('withdrawals').select('*', { count: 'exact', head: true }).in('status', ['pending', 'processing']),
        supabase.from('inspection_requests').select('*', { count: 'exact', head: true }).in('status', ['pending', 'scheduled', 'in_progress']),
      ]);
      if (base.error) toast.error(base.error.message);
      setStats({ ...(base.data || {}), hotels: hotels.count || 0, team: team.count || 0, pendingPayouts: payouts.count || 0, pendingInspections: inspections.count || 0 });
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;
  const cards: Array<[string, number, () => void, string]> = [
    ['Users', stats?.users || 0, () => openOperation('people'), 'Customer accounts'],
    ['Property Partners', stats?.partners || 0, () => openOperation('people'), 'Property owners'],
    ['Team', stats?.team || 0, () => openOperation('team'), 'Admins and Operations members'],
    ['Workers', stats?.workers || 0, () => openOperation('workers'), `${stats?.pending_verifications || 0} under verification`],
    ['Published apartments', stats?.listings || 0, () => openOperation('properties'), 'Public apartment inventory'],
    ['Published hotels', stats?.hotels || 0, () => openOperation('properties'), 'Public hotel inventory'],
    ['Property inspections', stats?.pendingInspections || 0, () => openOperation('properties'), 'Pending or active field work'],
    ['Payout requests', stats?.pendingPayouts || 0, () => openOperation('finance'), 'Worker and Partner settlements'],
  ];

  return <div className="space-y-5"><section className="border-b border-white/[.07] pb-5"><h2 className="text-2xl font-bold sm:text-3xl">What needs your attention</h2><p className="mt-2 max-w-xl text-[10px] leading-5 text-[#73798A]">Counts open the same authoritative records used by Operations. Nothing here creates a second dashboard or a duplicate status.</p><div className="mt-4 flex flex-wrap gap-2"><Quick label="Review properties" onClick={() => openOperation('properties')} primary /><Quick label="Open Inbox" onClick={openInbox} /></div></section><section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">{cards.map(([label,value,action,note]) => <button key={label} onClick={action} className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[8px] leading-relaxed text-[#5F6677]">{note}</p></button>)}</section></div>;
}

function Operations({ profile, active, target, setActive, onView }: { profile: Profile; active: Operation | null; target: OperationTarget; setActive: (value: Operation | null) => void; onView: (profile: Profile) => void }) {
  if (!active) return <div className="space-y-5"><p className="max-w-2xl text-[10px] leading-5 text-[#73798A]">Choose a work area. Each opens its canonical records inside this Operations workspace.</p>{OP_GROUPS.map(group=><section key={group}><h2 className="mb-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#686F80]">{group}</h2><div className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#10131B]">{OPS.filter(item=>item.group===group).map((item,index)=><div key={item.id}>{index>0&&<div className="ml-4 h-px bg-white/[.055]"/>}<button onClick={()=>setActive(item.id)} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left"><span><strong className="block text-sm">{item.label}</strong><span className="mt-1 block text-[9px] text-[#6D7384]">{item.note}</span></span><span className="text-[#697082]">›</span></button></div>)}</div></section>)}</div>;
  const current=OPS.find(item=>item.id===active)!;
  return <div className="space-y-5"><header className="flex items-center gap-3 border-b border-white/[.07] pb-3"><button onClick={()=>setActive(null)} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.04] text-lg" aria-label="Back to Operations">‹</button><div><p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">Operations</p><h2 className="mt-0.5 text-lg font-bold">{current.label}</h2><p className="mt-0.5 text-[9px] text-[#707687]">{current.note}</p></div></header>{active === 'people' && <People onView={onView} />}{active === 'team' && <StaffListTab profile={profile} />}{active === 'properties' && <PropertyPipelineWorkspace profile={profile} initialRecordId={target?.operation === 'properties' ? target.id : undefined} />}{active === 'workers' && <CreatorWorkerOversight />}{active === 'bookings' && <Bookings initialRecordId={target?.operation === 'bookings' ? target.id : undefined} />}{active === 'reports' && <Reports />}{active === 'finance' && <Finance />}{active === 'analytics' && <CreatorAnalyticsV2 profile={profile} />}{active === 'audit' && <CreatorAuditWorkspace />}</div>;
}

function CreatorInbox({profile,onNavigate,onGoToChat,initialConversationId,summary}:{profile:Profile;onNavigate?:Props['onNavigate'];onGoToChat?:Props['onGoToChat'];initialConversationId?:string;summary:ReturnType<typeof useCreatorInboxSummary>}){
  const[view,setView]=useState<'chats'|'activity'|'compose'>('chats');
  useEffect(()=>{if(initialConversationId)setView('chats')},[initialConversationId]);
  if(view==='compose')return <Nested title="New update" back={()=>setView('activity')}><CommunicationsWorkspace profile={profile} scope="all" forcedView="broadcast" hideViewTabs/></Nested>;
  return <div className="space-y-4"><div className="grid grid-cols-2 border-b border-white/[.07]">{([['chats','Chats',summary.messageUnread],['activity','Activity',summary.activityUnread]] as const).map(([id,label,count])=><button key={id} onClick={()=>setView(id)} className={`relative min-h-12 text-xs font-semibold ${view===id?'text-white':'text-[#747A8B]'}`}>{label}{count>0?` · ${count>99?'99+':count}`:''}{view===id&&<span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-violet-400"/>}</button>)}</div>{view==='chats'?<CommunicationsWorkspace profile={profile} scope="all" forcedView="inbox" hideViewTabs initialConversationId={initialConversationId} onOpenConversation={onGoToChat} onUnreadChange={summary.setMessageUnread}/>:<><div className="flex justify-end"><button onClick={()=>setView('compose')} className="rounded-xl border border-violet-500/20 bg-violet-500/[.08] px-3 py-2 text-[10px] font-semibold text-violet-200">Post update</button></div><Notifications profile={profile} embedded onUnreadChange={summary.setActivityUnread} onNavigate={(page,id)=>onNavigate?.(page,id)}/></>}</div>;
}

function Nested({title,back,children}:{title:string;back:()=>void;children:React.ReactNode}){return <div className="space-y-5"><header className="flex items-center gap-3 border-b border-white/[.07] pb-3"><button onClick={back} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.04] text-lg" aria-label="Back">‹</button><h2 className="text-lg font-bold">{title}</h2></header>{children}</div>}

function People({ onView }: { onView: (profile: Profile) => void }) {
  const [role, setRole] = useState<PersonRole>('user');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { void load(); }, [role]);
  async function load() { setLoading(true); const { data, error } = await supabase.rpc('admin_get_my_branch_profiles', { p_role: role }); if (error) toast.error(error.message); setRows(Array.isArray(data) ? data : []); setLoading(false); }
  const shown = useMemo(() => { const q=search.trim().toLowerCase(); return rows.filter((row)=>!q||[row.full_name,row.username,row.email,row.user_id,row.state,row.local_government,row.city].filter(Boolean).join(' ').toLowerCase().includes(q)); }, [rows,search]);
  return <Section title="People" note="Regular Users and Property Partners. Team members and Workers have dedicated workspaces."><div className="flex gap-2"><Chip active={role==='user'} onClick={()=>setRole('user')}>Users</Chip><Chip active={role==='property_partner'} onClick={()=>setRole('property_partner')}>Property Partners</Chip></div><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search accounts" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#141720] px-3 text-xs outline-none focus:border-violet-500/40"/>{loading?<Loading/>:shown.length===0?<Empty text="No matching accounts."/>:<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{shown.slice(0,120).map((person)=><button key={person.user_id} onClick={()=>onView(person)} className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 text-left"><p className="truncate text-sm font-semibold">{person.full_name||person.username||'WeHouse account'}</p><p className="mt-1 truncate text-[9px] text-[#666D7E]">{person.email}</p><p className="mt-2 text-[8px] capitalize text-[#565D6E]">{String(person.role||'user').replace(/_/g,' ')} · {[person.local_government||person.city,person.state].filter(Boolean).join(', ')||'Location not set'}</p></button>)}</div>}</Section>;
}

function Bookings({initialRecordId}:{initialRecordId?:string}) {
  const [view,setView]=useState<'worker'|'apartments'|'hotels'>(initialRecordId?'apartments':'worker');
  const [rows,setRows]=useState<any[]>([]); const [loading,setLoading]=useState(false);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<any|null>(null);
  useEffect(()=>{if(initialRecordId)setView('apartments')},[initialRecordId]);
  useEffect(()=>{if(view!=='worker')void load()},[view,initialRecordId]);
  async function load(){
    setLoading(true);let data:any[]=[];let error:any=null;
    if(view==='apartments'){
      const reservations=await supabase.from('reservations').select('*').order('created_at',{ascending:false}).limit(100);
      data=reservations.data||[];error=reservations.error;
      if(!error){
        const ids=[...new Set(data.map((row:any)=>row.listing_id).filter(Boolean))];
        if(ids.length){
          const listings=await supabase.from('listings').select('id,title,address,city,state,images,sub_type').in('id',ids);
          if(listings.error) error=listings.error;
          else {
            const byId=new Map((listings.data||[]).map((listing:any)=>[listing.id,listing]));
            data=data.map((row:any)=>({...row,listing:byId.get(row.listing_id)||null}));
          }
        }
      }
    }else if(view==='hotels'){
      const result=await supabase.from('hotel_bookings').select('*,hotels(name,city,state,images),hotel_rooms(room_type)').order('created_at',{ascending:false}).limit(100);
      data=result.data||[];error=result.error;
    }
    if(!error&&data.length){
      const userIds=[...new Set(data.map((row:any)=>row.user_id).filter(Boolean))];
      if(userIds.length){
        const profiles=await supabase.from('profiles').select('user_id,full_name,username,email,phone').in('user_id',userIds);
        if(profiles.error)error=profiles.error;
        else{const byId=new Map((profiles.data||[]).map((person:any)=>[person.user_id,person]));data=data.map((row:any)=>({...row,customer:byId.get(row.user_id)||null}))}
      }
    }
    if(error)toast.error(error.message);
    setRows(data);
    if(!error&&initialRecordId){
      const target=data.find((row:any)=>[row.id,row.booking_id,row.reservation_id].filter(Boolean).some(value=>String(value)===String(initialRecordId)));
      if(target)setSelected(target);
      else if(view==='apartments')toast.error('The linked booking record is no longer available.');
    }
    setLoading(false);
  }
  const shown=useMemo(()=>{const q=search.trim().toLowerCase();return rows.filter((row)=>{const property=view==='hotels'?row.hotels?.name:(row.listing?.title||row.listing_title);const customer=row.guest_name||row.customer?.full_name||row.customer?.username||row.customer?.email||row.user_email;const code=row.booking_code;return !q||[property,customer,code,row.hotels?.city,row.hotels?.state,row.listing?.city,row.listing?.state,row.status].filter(Boolean).join(' ').toLowerCase().includes(q)})},[rows,search,view]);
  if(selected)return <BookingRecord row={selected} kind={view==='hotels'?'hotel':'apartment'} onBack={()=>setSelected(null)}/>;
  return <div className="space-y-4"><div><h2 className="text-lg font-bold">Booking records</h2><p className="mt-1 text-[10px] leading-relaxed text-[#707687]">Worker services, apartment reservations and hotel stays, organised by customer, property and booking code.</p></div><nav className="grid grid-cols-3 border-y border-white/[.07]" aria-label="Booking types">{([['worker','Worker services'],['apartments','Apartments'],['hotels','Hotels']] as const).map(([id,label])=><button key={id} onClick={()=>{setView(id);setSearch('');setSelected(null)}} className={`relative min-h-12 px-1 text-[9px] font-semibold ${view===id?'text-violet-300':'text-[#73798A]'}`}>{label}{view===id&&<span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-violet-400"/>}</button>)}</nav>{view==='worker'?<ServiceBookingOversight title="Worker service bookings" note="Platform-wide oversight. Participants control the job; WeHouse watches lifecycle and exceptions."/>:<><input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label={`Search ${view} bookings`} placeholder="Search customer, property or booking code" className="h-11 w-full border-b border-white/[.08] bg-transparent px-1 text-xs outline-none focus:border-violet-500/40"/>{loading?<Loading/>:shown.length===0?<Empty text={rows.length?'No bookings match your search.':'No bookings in this view.'}/>:<div className="divide-y divide-white/[.065] border-y border-white/[.065]">{shown.map((row)=>{const media=view==='hotels'?row.hotels?.images?.[0]:row.listing?.images?.[0];const title=view==='hotels'?(row.hotels?.name||'Hotel booking'):(row.listing?.title||row.listing_title||'Apartment reservation');const location=view==='hotels'?[row.hotels?.city,row.hotels?.state]:[row.listing?.city,row.listing?.state];const customer=row.guest_name||row.customer?.full_name||row.customer?.username||row.customer?.email||row.user_email||'Customer name unavailable';const code=row.booking_code||'Booking code unavailable';return <button key={row.id||row.booking_id} onClick={()=>setSelected(row)} className="flex min-h-24 w-full items-center gap-3 py-3 text-left">{media?<img src={media} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover"/>:<div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-xs font-bold text-violet-300">WH</div>}<div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{customer}</p><p className="mt-1 truncate text-[10px] text-[#9BA0AF]">{title}</p><p className="mt-1 truncate text-[9px] text-[#686F7F]">{location.filter(Boolean).join(', ')||'Location unavailable'} · {new Date(row.created_at).toLocaleString()}</p><p className="mt-1 truncate text-[8px] font-semibold tracking-wide text-violet-300">{code}</p></div><div className="shrink-0 text-right">{(row.total_price||row.amount||row.reservation_fee_amount)!=null&&<p className="mb-1 text-xs font-bold">₦{Number(row.total_price||row.amount||row.reservation_fee_amount||0).toLocaleString('en-NG')}</p>}<span className="rounded-full bg-white/[.05] px-2 py-1 text-[8px] capitalize text-[#A2A7B5]">{String(row.status||'recorded').replace(/_/g,' ')}</span><span className="ml-2 text-[#686F7F]">›</span></div></button>})}</div>}</>}</div>;
}

function BookingRecord({row,kind,onBack}:{row:any;kind:'apartment'|'hotel';onBack:()=>void}){
  const property=kind==='hotel'?(row.hotels?.name||'Hotel stay'):(row.listing?.title||row.listing_title||'Apartment reservation');
  const location=kind==='hotel'?[row.hotels?.city,row.hotels?.state]:[row.listing?.city,row.listing?.state];
  const customer=row.guest_name||row.customer?.full_name||row.customer?.username||row.customer?.email||row.user_email||'Customer name unavailable';
  const amount=Number(row.total_price||row.amount||row.reservation_fee_amount||0);
  const facts=[['Customer',customer],['Property',property],['Location',location.filter(Boolean).join(', ')||'Location unavailable'],['Booking code',row.booking_code||'Unavailable'],['Created',row.created_at?new Date(row.created_at).toLocaleString():'Unavailable'],['Amount',amount?`₦${amount.toLocaleString('en-NG')}`:'Not recorded']];
  return <section className="space-y-5"><header className="flex items-start gap-3 border-b border-white/[.07] pb-4"><button onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.04] text-lg" aria-label="Back to booking records">‹</button><div className="min-w-0 flex-1"><p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">{kind==='hotel'?'Hotel booking':'Apartment reservation'}</p><h2 className="mt-1 truncate text-lg font-bold">{property}</h2><p className="mt-1 truncate text-[10px] text-[#707687]">{row.booking_code||String(row.id||row.booking_id||'')}</p></div><span className="shrink-0 rounded-full bg-violet-500/10 px-3 py-1.5 text-[9px] font-semibold capitalize text-violet-200">{String(row.status||'recorded').replace(/_/g,' ')}</span></header><div className="divide-y divide-white/[.06] border-y border-white/[.06]">{facts.map(([label,value])=><div key={label} className="flex min-h-12 items-center justify-between gap-4 py-3 text-[10px]"><span className="text-[#6D7384]">{label}</span><span className="max-w-[68%] text-right font-semibold text-[#D8DAE2]">{value}</span></div>)}</div>{row.rent_payment_status&&<div className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4"><p className="text-[9px] uppercase tracking-wide text-[#686F80]">Payment state</p><p className="mt-2 text-sm font-semibold capitalize">{String(row.rent_payment_status).replace(/_/g,' ')}</p></div>}</section>;
}

function Reports() {
  const [rows,setRows]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  async function load(){setLoading(true);const{data,error}=await supabase.rpc('admin_get_my_branch_reports');if(error)toast.error(error.message);setRows(Array.isArray(data)?data:[]);setLoading(false)}
  useEffect(()=>{void load()},[]);
  async function act(id:string,action:'resolved'|'dismissed'){const{error}=await supabase.rpc('admin_resolve_my_branch_report',{p_report_id:id,p_action:action});if(error)return toast.error(error.message);toast.success(action==='resolved'?'Report resolved':'Report dismissed');void load()}
  return <Section title="Listing issues" note="These are complaints people submitted about listings. Support conversations remain in Communications.">{loading?<Loading/>:rows.length===0?<Empty text="No listing complaints need review."/>:<div className="space-y-2">{rows.map((row)=><Card key={row.id}><Top title={row.reason||'Listing complaint'} sub={`${row.listing_id||'Listing'} · ${new Date(row.created_at).toLocaleString()}`} status={row.status||'pending'}/>{row.status==='pending'&&<div className="mt-3 flex gap-2"><Btn onClick={()=>void act(row.id,'resolved')}>Mark resolved</Btn><Btn muted onClick={()=>void act(row.id,'dismissed')}>Dismiss</Btn></div>}</Card>)}</div>}</Section>;
}

function Finance() {
  const [view,setView]=useState<'payouts'|'commissions'>('payouts');
  const [rows,setRows]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  useEffect(()=>{void load()},[view]);
  async function load(){setLoading(true);const result=view==='payouts'?await supabase.from('withdrawals').select('*').order('created_at',{ascending:false}).limit(100):await supabase.from('commission_ledger').select('*').order('created_at',{ascending:false}).limit(100);if(result.error)toast.error(result.error.message);setRows(result.data||[]);setLoading(false)}
  return <Section title="Platform finance" note="Read-only settlement records. Change commissions, fees and payout limits only from Creator Settings."><div className="flex gap-1 overflow-x-auto scrollbar-hide"><Chip active={view==='payouts'} onClick={()=>setView('payouts')}>Payout requests</Chip><Chip active={view==='commissions'} onClick={()=>setView('commissions')}>Commission ledger</Chip></div>{loading?<Loading/>:rows.length===0?<Empty text={view==='payouts'?'No payout requests.':'No commission records.'}/>:<div className="space-y-2">{rows.map((row)=><Card key={row.id}><Top title={view==='payouts'?(row.snapshot_bank_account_name||'Payout request'):(row.booking_type||'Commission')} sub={new Date(row.created_at).toLocaleString()} status={row.status||'recorded'} amount={view==='payouts'?row.amount:row.commission_amount}/></Card>)}</div>}</Section>;
}

function Settings({profile}:{profile:Profile}){return <div className="space-y-7"><CreatorSettingsTabV2 profile={profile}/><section className="space-y-4"><div><h2 className="text-base font-bold">Marketplace configuration</h2><p className="mt-1 text-[10px] text-[#686C7E]">Choices used by live Worker and property forms.</p></div><div className="grid gap-4 xl:grid-cols-2"><Card><h3 className="mb-3 text-sm font-semibold">Worker service categories</h3><ServiceCategoryManager profile={profile}/></Card><Card><h3 className="mb-3 text-sm font-semibold">Property types</h3><PropertyTypeManager profile={profile}/></Card></div></section></div>}

function Section({title,note,children}:{title:string;note:string;children:React.ReactNode}){return <div className="space-y-4"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] text-[#707687]">{note}</p></div>{children}</div>}
function Quick({label,onClick,primary=false}:{label:string;onClick:()=>void;primary?:boolean}){return <button onClick={onClick} className={`rounded-xl px-4 py-3 text-[10px] font-semibold ${primary?'bg-violet-500':'border border-white/[.08] bg-white/[.03]'}`}>{label}</button>}
function Chip({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){return <button onClick={onClick} className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-semibold ${active?'bg-violet-500 text-white':'border border-white/[.06] bg-[#10131B] text-[#777D8D]'}`}>{children}</button>}
function Card({children}:{children:React.ReactNode}){return <div className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4">{children}</div>}
function Top({title,sub,status,amount}:{title:string;sub:string;status:string;amount?:any}){return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 text-[9px] text-[#686F7F]">{sub}</p></div><div className="shrink-0 text-right">{amount!=null&&<p className="mb-1 text-sm font-bold">₦{Number(amount||0).toLocaleString('en-NG')}</p>}<span className="rounded-full bg-white/[.05] px-2 py-1 text-[8px] capitalize text-[#A2A7B5]">{String(status).replace(/_/g,' ')}</span></div></div>}
function Btn({children,onClick,muted=false}:{children:React.ReactNode;onClick:()=>void;muted?:boolean}){return <button onClick={onClick} className={`min-h-10 flex-1 rounded-xl px-3 text-[10px] font-semibold ${muted?'border border-white/[.08] text-[#A4A9B6]':'bg-violet-500 text-white'}`}>{children}</button>}
function Loading(){return <div className="grid min-h-44 place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div>}
function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">{text}</div>}

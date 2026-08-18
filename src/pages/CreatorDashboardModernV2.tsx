import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import CreatorWorkerOversight from '@/components/CreatorWorkerOversight';
import CreatorAuditWorkspace from '@/components/CreatorAuditWorkspace';
import ServiceBookingOversight from '@/components/ServiceBookingOversight';
import UserProfileModal from '@/components/UserProfileModal';
import DomainSettingsPanel from '@/components/DomainSettingsPanel';
import ServiceCategoryManager from '@/components/ServiceCategoryManager';
import PropertyTypeManager from '@/components/PropertyTypeManager';
import StaffListTab from './StaffListTab';
import CreatorAnalyticsV2 from './CreatorAnalyticsV2';
import CreatorSettingsTabV2 from './CreatorSettingsTabV2';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

type Tab = 'overview' | 'operations' | 'communications' | 'finance' | 'analytics' | 'audit' | 'settings';
type Operation = 'people' | 'team' | 'properties' | 'workers' | 'bookings' | 'reports';
type PersonRole = 'user' | 'property_partner';
type Props = { profile: Profile; onLogout: () => void; onNavigate?: (page: string) => void; onGoToChat?: (id?: string) => void };

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'operations', label: 'Operations' },
  { id: 'communications', label: 'Communications' },
  { id: 'finance', label: 'Finance' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'audit', label: 'Change History' },
  { id: 'settings', label: 'Settings' },
];

const NOTES: Record<Tab, string> = {
  overview: 'Platform health and priority work.',
  operations: 'People, Team, properties, Worker oversight, bookings and moderation.',
  communications: 'Human Support conversations and official announcements.',
  finance: 'Payout requests, commission records and settlement policy.',
  analytics: 'Trends, marketplace movement and lifecycle distribution.',
  audit: 'Safe operational history of important management changes.',
  settings: 'Global platform, Worker verification, trust and marketplace configuration.',
};

const OPS: Array<{ id: Operation; label: string; note: string }> = [
  { id: 'people', label: 'People', note: 'Regular Users and Property Partners.' },
  { id: 'team', label: 'Team', note: 'Admins, Staff capacity, branch placement and operational modules.' },
  { id: 'properties', label: 'Properties', note: 'Property request → inspection → preparation → publication.' },
  { id: 'workers', label: 'Workers', note: 'Worker lifecycle oversight. Verification Staff own routine approval.' },
  { id: 'bookings', label: 'Bookings', note: 'Worker-service, apartment and hotel booking records.' },
  { id: 'reports', label: 'Reports', note: 'Listing reports and moderation decisions.' },
];

export default function CreatorDashboardModernV2({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [operation, setOperation] = useState<Operation>('people');
  const [viewing, setViewing] = useState<Profile | null>(null);

  function openOperation(next: Operation) { setOperation(next); setTab('operations'); }

  return (
    <>
      <Toaster position="top-center" richColors />
      <WorkspaceFrameV2
        label="WEHOUSE · CREATOR"
        title={NAV.find((item) => item.id === tab)?.label || 'Creator'}
        description={NOTES[tab]}
        items={NAV}
        active={tab}
        setActive={(id) => setTab(id as Tab)}
        onAccount={onNavigate ? () => onNavigate('profile') : undefined}
        onLogout={onLogout}
      >
        {tab === 'overview' && <Overview openOperation={openOperation} openCommunications={() => setTab('communications')} openFinance={() => setTab('finance')} openAnalytics={() => setTab('analytics')} openAudit={() => setTab('audit')} />}
        {tab === 'operations' && <Operations profile={profile} active={operation} setActive={setOperation} onView={setViewing} />}
        {tab === 'communications' && <CommunicationsWorkspace profile={profile} scope="all" onOpenConversation={onGoToChat} />}
        {tab === 'finance' && <Finance />}
        {tab === 'analytics' && <CreatorAnalyticsV2 profile={profile} />}
        {tab === 'audit' && <CreatorAuditWorkspace />}
        {tab === 'settings' && <Settings profile={profile} />}
      </WorkspaceFrameV2>
      {viewing && <UserProfileModal user={viewing} adminProfile={profile} onClose={() => setViewing(null)} onNavigate={onNavigate} onGoToChat={onGoToChat} />}
    </>
  );
}

function Overview({ openOperation, openCommunications, openFinance, openAnalytics, openAudit }: { openOperation: (tab: Operation) => void; openCommunications: () => void; openFinance: () => void; openAnalytics: () => void; openAudit: () => void }) {
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
    ['Team', stats?.team || 0, () => openOperation('team'), 'Admins and Staff'],
    ['Workers', stats?.workers || 0, () => openOperation('workers'), `${stats?.pending_verifications || 0} under verification`],
    ['Published apartments', stats?.listings || 0, () => openOperation('properties'), 'Public apartment inventory'],
    ['Published hotels', stats?.hotels || 0, () => openOperation('properties'), 'Public hotel inventory'],
    ['Property inspections', stats?.pendingInspections || 0, () => openOperation('properties'), 'Pending or active field work'],
    ['Payout requests', stats?.pendingPayouts || 0, openFinance, 'Worker/Partner settlement requests'],
  ];

  return <div className="space-y-5"><section className="rounded-3xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[.12] via-[#14111F] to-[#0E1118] p-5 sm:p-6 lg:p-8"><p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-300">PLATFORM OVERVIEW</p><h2 className="mt-3 text-2xl font-bold sm:text-3xl">What needs your attention</h2><p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#858B9B]">Overview summarizes. Each action opens the one workspace that owns the responsibility.</p><div className="mt-5 flex flex-wrap gap-2"><Quick label="Properties" onClick={() => openOperation('properties')} primary /><Quick label="Communications" onClick={openCommunications} /><Quick label="Finance" onClick={openFinance} /><Quick label="Analytics" onClick={openAnalytics} /><Quick label="Change History" onClick={openAudit} /></div></section><section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">{cards.map(([label,value,action,note]) => <button key={label} onClick={action} className="rounded-2xl border border-white/[.06] bg-[#10131B] p-4 text-left hover:border-violet-500/25"><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-[10px] font-semibold">{label}</p><p className="mt-1 text-[8px] leading-relaxed text-[#5F6677]">{note}</p></button>)}</section></div>;
}

function Operations({ profile, active, setActive, onView }: { profile: Profile; active: Operation; setActive: (value: Operation) => void; onView: (profile: Profile) => void }) {
  return <div className="space-y-6"><div><h2 className="text-lg font-bold">Platform operations</h2><p className="mt-1 text-[10px] leading-relaxed text-[#707687]">Choose an operational area. Each area shows its own records and actions without repeating dashboard summaries.</p></div><nav aria-label="Creator operation areas" className="grid grid-cols-3 border-y border-white/[.07] sm:grid-cols-6">{OPS.map((item) => <button key={item.id} onClick={() => setActive(item.id)} className={`relative min-h-12 px-1 text-[9px] font-semibold sm:text-[10px] ${active === item.id ? 'text-violet-300' : 'text-[#73798A]'}`}>{item.label}{active === item.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-violet-400"/>}</button>)}</nav>{active === 'people' && <People onView={onView} />}{active === 'team' && <StaffListTab profile={profile} />}{active === 'properties' && <PropertyPipelineWorkspace profile={profile} />}{active === 'workers' && <CreatorWorkerOversight />}{active === 'bookings' && <Bookings />}{active === 'reports' && <Reports />}</div>;
}

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

function Bookings() {
  const [view,setView]=useState<'worker'|'apartments'|'hotels'>('worker');
  const [rows,setRows]=useState<any[]>([]); const [loading,setLoading]=useState(false);
  useEffect(()=>{if(view!=='worker')void load()},[view]);
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
    if(error)toast.error(error.message);setRows(data);setLoading(false);
  }
  return <div className="space-y-4"><div><h2 className="text-lg font-bold">Bookings</h2><p className="mt-1 text-[10px] leading-relaxed text-[#707687]">Worker services, apartment reservations and hotel stays. Open records by recognisable names—not database identifiers.</p></div><nav className="grid grid-cols-3 border-y border-white/[.07]" aria-label="Booking types">{([['worker','Worker services'],['apartments','Apartments'],['hotels','Hotels']] as const).map(([id,label])=><button key={id} onClick={()=>setView(id)} className={`relative min-h-12 px-1 text-[9px] font-semibold ${view===id?'text-violet-300':'text-[#73798A]'}`}>{label}{view===id&&<span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-violet-400"/>}</button>)}</nav>{view==='worker'?<ServiceBookingOversight title="Worker service bookings" note="Platform-wide oversight. Participants control the job; WeHouse watches lifecycle and exceptions."/>:loading?<Loading/>:rows.length===0?<Empty text="No bookings in this view."/>:<div className="divide-y divide-white/[.065] border-y border-white/[.065]">{rows.map((row)=>{const media=view==='hotels'?row.hotels?.images?.[0]:row.listing?.images?.[0];const title=view==='hotels'?(row.hotels?.name||'Hotel booking'):(row.listing?.title||'Apartment reservation');const location=view==='hotels'?[row.hotels?.city,row.hotels?.state]:[row.listing?.city,row.listing?.state];const code=row.reservation_code||row.booking_code||row.id||row.booking_id;return <div key={row.id||row.booking_id} className="flex min-h-20 items-center gap-3 py-3">{media?<img src={media} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover"/>:<div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-xs font-bold text-violet-300">WH</div>}<div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{title}</p><p className="mt-1 truncate text-[9px] text-[#686F7F]">{location.filter(Boolean).join(', ')||'Location unavailable'} · {new Date(row.created_at).toLocaleString()}</p><p className="mt-1 truncate text-[8px] font-semibold tracking-wide text-violet-300">{code}</p></div><div className="shrink-0 text-right">{(row.total_price||row.amount||row.reservation_fee_amount)!=null&&<p className="mb-1 text-xs font-bold">₦{Number(row.total_price||row.amount||row.reservation_fee_amount||0).toLocaleString('en-NG')}</p>}<span className="rounded-full bg-white/[.05] px-2 py-1 text-[8px] capitalize text-[#A2A7B5]">{String(row.status||'recorded').replace(/_/g,' ')}</span></div></div>})}</div>}</div>;
}

function Reports() {
  const [rows,setRows]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  async function load(){setLoading(true);const{data,error}=await supabase.rpc('admin_get_my_branch_reports');if(error)toast.error(error.message);setRows(Array.isArray(data)?data:[]);setLoading(false)}
  useEffect(()=>{void load()},[]);
  async function act(id:string,action:'resolved'|'dismissed'){const{error}=await supabase.rpc('admin_resolve_my_branch_report',{p_report_id:id,p_action:action});if(error)return toast.error(error.message);toast.success(action==='resolved'?'Report resolved':'Report dismissed');void load()}
  return <Section title="Reports & moderation" note="Listing reports only. Human Support remains in Communications.">{loading?<Loading/>:rows.length===0?<Empty text="No listing reports are waiting for moderation."/>:<div className="space-y-2">{rows.map((row)=><Card key={row.id}><Top title={row.reason||'Listing report'} sub={`${row.listing_id||'Listing'} · ${new Date(row.created_at).toLocaleString()}`} status={row.status||'pending'}/>{row.status==='pending'&&<div className="mt-3 flex gap-2"><Btn onClick={()=>void act(row.id,'resolved')}>Resolve</Btn><Btn muted onClick={()=>void act(row.id,'dismissed')}>Dismiss</Btn></div>}</Card>)}</div>}</Section>;
}

function Finance() {
  const [view,setView]=useState<'payouts'|'commissions'|'rules'>('payouts');
  const [rows,setRows]=useState<any[]>([]);const [loading,setLoading]=useState(true);
  useEffect(()=>{void load()},[view]);
  async function load(){if(view==='rules'){setRows([]);setLoading(false);return}setLoading(true);const result=view==='payouts'?await supabase.from('withdrawals').select('*').order('created_at',{ascending:false}).limit(100):await supabase.from('commission_ledger').select('*').order('created_at',{ascending:false}).limit(100);if(result.error)toast.error(result.error.message);setRows(result.data||[]);setLoading(false)}
  return <Section title="Platform finance" note="Settlement oversight. There is no Creator personal withdrawal function."><div className="flex gap-1 overflow-x-auto scrollbar-hide"><Chip active={view==='payouts'} onClick={()=>setView('payouts')}>Payout requests</Chip><Chip active={view==='commissions'} onClick={()=>setView('commissions')}>Commission ledger</Chip><Chip active={view==='rules'} onClick={()=>setView('rules')}>Settlement rules</Chip></div>{view==='rules'?<DomainSettingsPanel title="Settlement rules" description="Commission and minimum payout rules used by Worker and Property Partner settlements." settings={[{key:'worker_commission_rate',label:'Worker commission (%)',description:'WeHouse commission from completed Worker jobs.',type:'number',defaultValue:'10'},{key:'commission_apartment',label:'Apartment Partner commission (%)',description:'WeHouse commission on eligible apartment rent.',type:'number',defaultValue:'10'},{key:'commission_hotel',label:'Hotel Partner commission (%)',description:'WeHouse commission on eligible hotel payments.',type:'number',defaultValue:'10'},{key:'wallet_minimum_withdrawal',label:'Worker minimum payout (₦)',description:'Minimum available Worker balance for payout.',type:'number',defaultValue:'1000'},{key:'min_withdrawal',label:'Property Partner minimum payout (₦)',description:'Minimum available Partner balance for payout.',type:'number',defaultValue:'5000'}]}/>:loading?<Loading/>:rows.length===0?<Empty text={view==='payouts'?'No payout requests.':'No commission records.'}/>:<div className="space-y-2">{rows.map((row)=><Card key={row.id}><Top title={view==='payouts'?(row.snapshot_bank_account_name||'Payout request'):(row.booking_type||'Commission')} sub={new Date(row.created_at).toLocaleString()} status={row.status||'recorded'} amount={view==='payouts'?row.amount:row.commission_amount}/></Card>)}</div>}</Section>;
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

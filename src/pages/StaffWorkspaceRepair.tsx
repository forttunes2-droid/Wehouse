import { useMemo, useState } from 'react';
import { Toaster } from 'sonner';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import HousingOperationsWorkspace from '@/components/HousingOperationsWorkspace';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import OfficialChannel from '@/components/OfficialChannel';
import StaffWorkerReviewModern from '@/components/StaffWorkerReviewModern';
import StaffInspectionWorkspaceV2 from '@/components/StaffInspectionWorkspaceV2';
import StaffFinanceSummary from '@/components/StaffFinanceSummary';
import StaffFinanceRecords from '@/components/StaffFinanceRecords';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import type { Profile } from '@/types';

type Module = 'operations' | 'finance' | 'support' | 'verification' | 'field_officer';
type MainTab = 'home' | 'work' | 'conversations' | 'announcements';
type WorkView = 'pipeline' | 'housing' | 'overview' | 'payments' | 'payouts' | 'ledger';
type Props = { profile:Profile; onLogout:()=>void; onGoToChat?:(id?:string)=>void; onNavigate?:(page:string)=>void };
const MODULES:Module[]=['operations','finance','support','verification','field_officer'];
const MODULE_COPY:Record<Module,{title:string;description:string;workLabel:string}>={
 operations:{title:'Property Operations',description:'Move assigned properties from request through inspection and publication.',workLabel:'Properties'},
 finance:{title:'Finance',description:'Review assigned payments, payouts and financial records.',workLabel:'Finance Work'},
 support:{title:'Support',description:'Handle conversations assigned to your branch support desk.',workLabel:'Conversations'},
 verification:{title:'Worker Verification',description:'Review professional evidence and make the permitted verification decision.',workLabel:'Worker Reviews'},
 field_officer:{title:'Field Operations',description:'Complete property visits and submit inspection evidence.',workLabel:'Inspections'},
};

export default function StaffWorkspaceRepair({profile,onLogout,onNavigate}:Props){
 const{permissions,loading}=useStaffPermissions(profile.user_id);
 const assigned=useMemo(()=>permissions.filter((value):value is Module=>MODULES.includes(value as Module)),[permissions]);
 if(loading)return <State title="Loading staff workspace" text="Checking your branch and Staff module assignment…"/>;
 if(!profile.assigned_state||!profile.assigned_lga)return <State title="Branch assignment required" text="An Admin or Creator must assign this Staff account to a State and LGA before operational work can begin."/>;
 if(assigned.length!==1)return <State title="Staff assignment needs attention" text={assigned.length?'This Staff account has conflicting module assignments. Keep one active operational module.':'No Staff module is assigned to this account.'}/>;
 return <Workspace module={assigned[0]} profile={profile} onLogout={onLogout} onNavigate={onNavigate}/>;
}

function Workspace({module,profile,onLogout,onNavigate}:{module:Module;profile:Profile;onLogout:()=>void;onNavigate?:(page:string)=>void}){
 const copy=MODULE_COPY[module],directConversation=module==='support';
 const items=directConversation?[{id:'home',label:'Home'},{id:'conversations',label:'Conversations'},{id:'announcements',label:'Announcements'}]:[{id:'home',label:'Home'},{id:'work',label:copy.workLabel},{id:'announcements',label:'Announcements'}];
 const[tab,setTab]=useState<MainTab>('home'),[workView,setWorkView]=useState<WorkView>(module==='finance'?'overview':'pipeline');
 const scope={state:profile.assigned_state||'',lga:profile.assigned_lga||''},branch=[scope.lga,scope.state].filter(Boolean).join(', ');
 let content:React.ReactNode;
 if(tab==='home')content=<StaffHome module={module} copy={copy} branch={branch} openWork={()=>setTab(directConversation?'conversations':'work')} openAnnouncements={()=>setTab('announcements')}/>;
 else if(tab==='announcements')content=<OfficialChannel profile={profile} embedded/>;
 else if(tab==='conversations'&&directConversation)content=<CommunicationsWorkspace profile={profile} scope={scope} forcedView="inbox" hideViewTabs/>;
 else content=<ModuleWork module={module} profile={profile} view={workView} setView={setWorkView}/>;
 const activeLabel=items.find(item=>item.id===tab)?.label||copy.title;
 return <><Toaster position="top-center" richColors/><WorkspaceFrameV2 label={`WEHOUSE · STAFF · ${copy.title}`} title={activeLabel} description={`${copy.description} · ${branch}`} items={items} active={tab} setActive={(id)=>setTab(id as MainTab)} onAccount={onNavigate?()=>onNavigate('profile'):undefined} onLogout={onLogout}>{content}</WorkspaceFrameV2></>;
}

function ModuleWork({module,profile,view,setView}:{module:Module;profile:Profile;view:WorkView;setView:(view:WorkView)=>void}){
 if(module==='field_officer')return <StaffInspectionWorkspaceV2 profile={profile}/>;
 if(module==='verification')return <StaffWorkerReviewModern/>;
 if(module==='operations')return <div className="space-y-5"><LocalTabs items={[["pipeline","Property Pipeline"],["housing","Published Housing"]]} active={view} set={setView}/>{view==='housing'?<HousingOperationsWorkspace/>:<PropertyPipelineWorkspace profile={profile}/>}</div>;
 if(module==='finance')return <div className="space-y-5">{view==='overview'?<StaffFinanceSummary open={(id)=>setView(id)}/>:<><LocalTabs items={[["overview","Overview"],["payments","Payments"],["payouts","Payouts"],["ledger","Ledger"]]} active={view} set={setView}/><StaffFinanceRecords view={view as 'payments'|'payouts'|'ledger'}/></>}</div>;
 return null;
}

function StaffHome({module,copy,branch,openWork,openAnnouncements}:{module:Module;copy:{title:string;description:string;workLabel:string};branch:string;openWork:()=>void;openAnnouncements:()=>void}){return <div className="space-y-6"><section className="border-b border-white/[.07] pb-6"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">YOUR STAFF ASSIGNMENT</p><h2 className="mt-3 text-2xl font-bold">{copy.title}</h2><p className="mt-2 max-w-xl text-xs leading-6 text-[#858B9B]">{copy.description}</p><p className="mt-2 text-[10px] text-[#666D7E]">Branch · {branch}</p></section><div className="divide-y divide-white/[.06] border-y border-white/[.06]"><button onClick={openWork} className="flex min-h-16 w-full items-center justify-between py-3 text-left"><span><strong className="block text-sm">{module==='support'?'Open conversations':copy.workLabel}</strong><span className="mt-1 block text-[10px] text-[#6E7484]">Continue work assigned to your module</span></span><span className="text-violet-300">›</span></button><button onClick={openAnnouncements} className="flex min-h-16 w-full items-center justify-between py-3 text-left"><span><strong className="block text-sm">Announcements</strong><span className="mt-1 block text-[10px] text-[#6E7484]">Official updates for your account and branch</span></span><span className="text-violet-300">›</span></button></div></div>}
function LocalTabs({items,active,set}:{items:Array<[WorkView,string]>;active:WorkView;set:(view:WorkView)=>void}){return <div className="flex gap-5 overflow-x-auto border-b border-white/[.07]">{items.map(([id,label])=><button key={id} onClick={()=>set(id)} className={`relative shrink-0 pb-3 text-[10px] font-semibold ${active===id?'text-white':'text-[#6E7484]'}`}>{label}{active===id&&<span className="absolute inset-x-0 bottom-0 h-0.5 bg-violet-500"/>}</button>)}</div>}
function State({title,text}:{title:string;text:string}){return <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F] px-5 text-white"><div className="w-full max-w-lg rounded-3xl border border-white/[.07] bg-[#10141C] p-6 text-center"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">WEHOUSE STAFF</p><h1 className="mt-3 text-lg font-bold capitalize">{title}</h1><p className="mt-2 text-[11px] leading-relaxed text-[#747A8B]">{text}</p></div></div>}

import { useMemo, useState } from 'react';
import { Toaster } from 'sonner';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import HousingOperationsWorkspace from '@/components/HousingOperationsWorkspace';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import StaffWorkerReviewModern from '@/components/StaffWorkerReviewModern';
import StaffInspectionWorkspaceV2 from '@/components/StaffInspectionWorkspaceV2';
import StaffFinanceSummary from '@/components/StaffFinanceSummary';
import StaffFinanceRecords from '@/components/StaffFinanceRecords';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import type { Profile } from '@/types';

type Module = 'operations' | 'finance' | 'support' | 'verification' | 'field_officer';
type Props = { profile:Profile; onLogout:()=>void; onGoToChat?:(id?:string)=>void; onNavigate?:(page:string)=>void };
const MODULES:Module[]=['operations','finance','support','verification','field_officer'];

export default function StaffWorkspaceRepair({profile,onLogout,onNavigate}:Props){
 const{permissions,loading}=useStaffPermissions(profile.user_id);
 const assigned=useMemo(()=>permissions.filter((value):value is Module=>MODULES.includes(value as Module)),[permissions]);
 if(loading)return <State title="Loading staff workspace" text="Checking your branch and Staff module assignment…"/>;
 if(!profile.assigned_state||!profile.assigned_lga)return <State title="Branch assignment required" text="An Admin or Creator must assign this Staff account to a State and LGA before operational work can begin."/>;
 if(assigned.length!==1)return <State title="Staff assignment needs attention" text={assigned.length?'This Staff account has conflicting module assignments. Keep one active operational module.':'No Staff module is assigned to this account.'}/>;
 return <Workspace module={assigned[0]} profile={profile} onLogout={onLogout} onNavigate={onNavigate}/>;
}

function Workspace({module,profile,onLogout,onNavigate}:{module:Module;profile:Profile;onLogout:()=>void;onNavigate?:(page:string)=>void}){
 const first=module==='verification'?'reviews':module==='finance'?'overview':module==='operations'?'pipeline':'work';
 const[tab,setTab]=useState(first);const scope={state:profile.assigned_state||'',lga:profile.assigned_lga||''};
 const config=module==='operations'?{title:'Property Operations',description:'Manage property preparation and live housing activity for your assigned branch.',items:[{id:'pipeline',label:'Pipeline'},{id:'housing',label:'Live Housing'}]}:module==='support'?{title:'Support',description:'Handle real support conversations for your assigned branch.',items:[{id:'work',label:'Inbox'}]}:module==='field_officer'?{title:'Field Operations',description:'Carry out and record assigned property inspections.',items:[{id:'work',label:'Inspections'}]}:module==='finance'?{title:'Finance',description:'Review payments, payouts and branch financial records.',items:[{id:'overview',label:'Overview'},{id:'payments',label:'Payments'},{id:'payouts',label:'Payouts'},{id:'ledger',label:'Ledger & Audit'}]}:{title:'Worker Verification',description:'Review Local Service Worker identity freshness and real professional work evidence before activation.',items:[{id:'reviews',label:'Worker Reviews'}]};
 let content:React.ReactNode;if(module==='operations')content=tab==='housing'?<HousingOperationsWorkspace/>:<PropertyPipelineWorkspace profile={profile}/>;else if(module==='support')content=<CommunicationsWorkspace profile={profile} scope={scope} forcedView="inbox" hideViewTabs/>;else if(module==='field_officer')content=<StaffInspectionWorkspaceV2 profile={profile}/>;else if(module==='finance')content=tab==='overview'?<StaffFinanceSummary open={setTab as any}/>:<StaffFinanceRecords view={tab as 'payments'|'payouts'|'ledger'}/>;else content=<StaffWorkerReviewModern/>;
 const branch=[scope.lga,scope.state].filter(Boolean).join(', ');
 return <><Toaster position="top-center" richColors/><WorkspaceFrameV2 label="WEHOUSE · STAFF" title={config.title} description={`${config.description} · ${branch}`} items={config.items} active={tab} setActive={setTab} onAccount={onNavigate?()=>onNavigate('profile'):undefined} onLogout={onLogout}>{content}</WorkspaceFrameV2></>;
}
function State({title,text}:{title:string;text:string}){return <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F] px-5 text-white"><div className="w-full max-w-lg rounded-3xl border border-white/[.07] bg-[#10141C] p-6 text-center"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">WEHOUSE STAFF</p><h1 className="mt-3 text-lg font-bold capitalize">{title}</h1><p className="mt-2 text-[11px] leading-relaxed text-[#747A8B]">{text}</p></div></div>}

import { useMemo,useState } from 'react';
import { Toaster } from 'sonner';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import StaffVerificationQueueV2 from '@/components/StaffVerificationQueueV2';
import StaffInspectionWorkspaceV2 from '@/components/StaffInspectionWorkspaceV2';
import StaffFinanceSummary from '@/components/StaffFinanceSummary';
import StaffFinanceRecords from '@/components/StaffFinanceRecords';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import type { Profile } from '@/types';

type Module='operations'|'finance'|'support'|'verification'|'field_officer';
type Props={profile:Profile;onLogout:()=>void;onGoToChat?:(id?:string)=>void;onNavigate?:(page:string)=>void};
const MODULES:Module[]=['operations','finance','support','verification','field_officer'];
export default function StaffWorkspaceRepair({profile,onLogout,onNavigate}:Props){const{permissions,loading}=useStaffPermissions(profile.user_id);const assigned=useMemo(()=>permissions.filter((value):value is Module=>MODULES.includes(value as Module)),[permissions]);if(loading)return <State text="Loading staff workspace…"/>;if(assigned.length!==1)return <State text={assigned.length?'This Staff account has conflicting module assignments.':'No Staff module is assigned to this account.'}/>;return <Workspace module={assigned[0]} profile={profile} onLogout={onLogout} onNavigate={onNavigate}/>}
function Workspace({module,profile,onLogout,onNavigate}:{module:Module;profile:Profile;onLogout:()=>void;onNavigate?:((page:string)=>void)}){const first=module==='verification'?'reviews':module==='finance'?'overview':'work';const[tab,setTab]=useState(first);const scope={state:profile.assigned_state||profile.state||'',lga:profile.assigned_lga||profile.local_government||profile.city||''};const config=module==='operations'?{title:'Property Operations',items:[{id:'work',label:'Properties'}]}:module==='support'?{title:'Support',items:[{id:'work',label:'Inbox'}]}:module==='field_officer'?{title:'Field Operations',items:[{id:'work',label:'Inspections'}]}:module==='finance'?{title:'Finance',items:[{id:'overview',label:'Overview'},{id:'payments',label:'Payments'},{id:'payouts',label:'Payouts'},{id:'ledger',label:'Ledger & Audit'}]}:{title:'Worker Verification',items:[{id:'reviews',label:'Worker Reviews'}]};let content:React.ReactNode;if(module==='operations')content=<PropertyPipelineWorkspace profile={profile}/>;else if(module==='support')content=<CommunicationsWorkspace profile={profile} scope={scope} forcedView="inbox" hideViewTabs/>;else if(module==='field_officer')content=<StaffInspectionWorkspaceV2 profile={profile}/>;else if(module==='finance')content=tab==='overview'?<StaffFinanceSummary open={setTab as any}/>:<StaffFinanceRecords view={tab as 'payments'|'payouts'|'ledger'}/>;else content=<StaffVerificationQueueV2/>;return <><Toaster position="top-center" richColors/><WorkspaceFrameV2 label={`WEHOUSE STAFF · ${scope.lga||'BRANCH'}`} title={config.title} items={config.items} active={tab} setActive={setTab} onAccount={onNavigate?()=>onNavigate('profile'):undefined} onLogout={onLogout}>{content}</WorkspaceFrameV2></>}
function State({text}:{text:string}){return <div className="grid min-h-[70dvh] place-items-center bg-[#080A0F] px-5 text-center text-xs text-[#747A8B]">{text}</div>}

import { useMemo,useState } from 'react';
import { Toaster } from 'sonner';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import PropertyPipelineWorkspace from '@/components/PropertyPipelineWorkspace';
import CommunicationsWorkspace from '@/components/CommunicationsWorkspace';
import StaffSecurityOverviewV2 from '@/components/StaffSecurityOverviewV2';
import StaffVerificationQueueV2 from '@/components/StaffVerificationQueueV2';
import StaffInspectionWorkspaceV2 from '@/components/StaffInspectionWorkspaceV2';
import StaffDashboardLegacy from './StaffDashboardLegacy';
import { useStaffPermissions } from '@/hooks/useStaffPermissions';
import type { Profile } from '@/types';

type Module='operations'|'finance'|'support'|'verification'|'field_officer';
type Props={profile:Profile;onLogout:()=>void;onGoToChat?:(id?:string)=>void;onNavigate?:(page:string)=>void};
const MODULES:Module[]=['operations','finance','support','verification','field_officer'];
export default function StaffWorkspaceRepair(props:Props){const{profile,onLogout,onNavigate}=props;const{permissions,loading}=useStaffPermissions(profile.user_id);const assigned=useMemo(()=>permissions.filter((value):value is Module=>MODULES.includes(value as Module)),[permissions]);if(loading)return <State text="Loading staff workspace…"/>;if(assigned.length!==1)return <State text={assigned.length?'This Staff account has conflicting module assignments.':'No Staff module is assigned to this account.'}/>;const mod=assigned[0];if(mod==='finance')return <StaffDashboardLegacy {...props}/>;return <Workspace module={mod} profile={profile} onLogout={onLogout} onNavigate={onNavigate}/>}
function Workspace({module,profile,onLogout,onNavigate}:{module:Exclude<Module,'finance'>;profile:Profile;onLogout:()=>void;onNavigate?:((page:string)=>void)}){const[tab,setTab]=useState(module==='verification'?'overview':'work');const scope={state:profile.assigned_state||profile.state||'',lga:profile.assigned_lga||profile.local_government||profile.city||''};const config=module==='operations'?{title:'Property Operations',items:[{id:'work',label:'Properties'}]}:module==='support'?{title:'Support',items:[{id:'work',label:'Inbox'}]}:module==='field_officer'?{title:'Field Operations',items:[{id:'work',label:'Inspections'}]}:{title:'Security & Verification',items:[{id:'overview',label:'Overview'},{id:'reviews',label:'Reviews'}]};const content=module==='operations'?<PropertyPipelineWorkspace profile={profile}/>:module==='support'?<CommunicationsWorkspace profile={profile} scope={scope} forcedView="inbox" hideViewTabs/>:module==='field_officer'?<StaffInspectionWorkspaceV2 profile={profile}/>:tab==='reviews'?<StaffVerificationQueueV2/>:<StaffSecurityOverviewV2 onOpenReviews={()=>setTab('reviews')} onOpenCases={()=>setTab('reviews')}/>;return <><Toaster position="top-center" richColors/><WorkspaceFrameV2 label={`WEHOUSE STAFF · ${scope.lga||'BRANCH'}`} title={config.title} items={config.items} active={tab} setActive={setTab} onAccount={onNavigate?()=>onNavigate('profile'):undefined} onLogout={onLogout}>{content}</WorkspaceFrameV2></>}
function State({text}:{text:string}){return <div className="grid min-h-[70dvh] place-items-center bg-[#080A0F] px-5 text-center text-xs text-[#747A8B]">{text}</div>}

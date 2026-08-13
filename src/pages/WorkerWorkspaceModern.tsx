import { useState } from 'react';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import WorkerSummaryPanelV2 from '@/components/WorkerSummaryPanelV2';
import WorkerPriorityPanelV2 from '@/components/WorkerPriorityPanelV2';
import WorkerNextJobPanelV2 from '@/components/WorkerNextJobPanelV2';
import WorkerJobsPanelV2 from '@/components/WorkerJobsPanelV2';
import WorkerProfilePanelV2 from '@/components/WorkerProfilePanelV2';
import WorkerWallet from './WorkerWallet';
import type { Profile } from '@/types';

type Tab='home'|'jobs'|'earnings'|'profile';
const NAV=[{id:'home',label:'Home'},{id:'jobs',label:'Jobs'},{id:'earnings',label:'Earnings'},{id:'profile',label:'Profile'}];
export default function WorkerWorkspaceModern({profile,onGoToSetup,onLogout,onNavigate}:{profile:Profile;onGoToSetup:()=>void;onLogout:()=>void;onNavigate?:(page:string)=>void}){const[tab,setTab]=useState<Tab>('home');const content=tab==='jobs'?<WorkerJobsPanelV2 profile={profile}/>:tab==='earnings'?<WorkerWallet profile={profile}/>:tab==='profile'?<WorkerProfilePanelV2 profile={profile} onEdit={onGoToSetup} onVerification={()=>onNavigate?.('worker_verification')}/>:<WorkerHome profile={profile} setTab={setTab} onNavigate={onNavigate}/>;return <WorkspaceFrameV2 label="WEHOUSE LOCAL SERVICES" title={NAV.find(x=>x.id===tab)?.label||'Worker'} items={NAV} active={tab} setActive={id=>setTab(id as Tab)} onAccount={onNavigate?()=>onNavigate('profile'):undefined} onLogout={onLogout}>{content}</WorkspaceFrameV2>}
function WorkerHome({profile,setTab,onNavigate}:{profile:Profile;setTab:(tab:Tab)=>void;onNavigate?:(page:string)=>void}){return <div className="space-y-5"><WorkerSummaryPanelV2 profile={profile} onJobs={()=>setTab('jobs')} onEarnings={()=>setTab('earnings')} onProfile={()=>setTab('profile')} onVerification={()=>onNavigate?.('worker_verification')}/><div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]"><WorkerPriorityPanelV2 profile={profile} onOpenJobs={()=>setTab('jobs')}/><WorkerNextJobPanelV2 profile={profile} onOpenJobs={()=>setTab('jobs')}/></div></div>}

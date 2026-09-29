import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AccountCenter from '@/pages/AccountCenter';
import WorkspaceFrameV2 from '@/components/WorkspaceFrameV2';
import '@/index.css';

const profile: any = { auth_id:'preview-auth',user_id:'preview-user',role:'user',
  full_name:'Ada Example',username:'ada',email:'ada@example.invalid' };
const access: any = { identity:{user_id:'preview-user',account_kind:'consumer'},personal_workspace:true,
  privileged_workspaces:[{role:'worker'},{role:'property_partner'}] };
const root = createRoot(document.getElementById('root')!);
root.render(<AccountCenter profile={profile} workspaceAccess={access} activeWorkspace="personal"
  onSwitchWorkspace={() => {}} onGoToPrivacy={() => {}} onGoToSaved={() => {}}
  onGoToSecurity={() => {}} onGoToProfileEdit={() => {}} />);

function MotionWorkspace({ bounded = true }: { bounded?: boolean }) {
  const [active,setActive]=useState('overview');
  return <div className="scrollable-content" style={{height:bounded ? 844 : undefined,minHeight:bounded ? undefined : '100dvh',overflowY:'auto'}} data-test-scroll>
    <WorkspaceFrameV2 label="WeHouse" title="Property Partner" items={[
      {id:'overview',label:'Overview'},{id:'properties',label:'Properties'},
    ]} active={active} setActive={setActive} onLogout={() => {}}>
      <div data-test-stage={active} style={{height:1600,background:'#121720',padding:16,borderRadius:16}}>
        <h2 className="text-xl">{active === 'overview' ? 'Overview' : 'Properties'}</h2>
        <p className="mt-4 text-sm">Your section retains its place when you return.</p>
      </div>
    </WorkspaceFrameV2>
  </div>;
}
(window as any).__showWorkspaceFixture = () => root.render(<MotionWorkspace />);
(window as any).__showDocumentWorkspaceFixture = () => root.render(<MotionWorkspace key="document" bounded={false} />);

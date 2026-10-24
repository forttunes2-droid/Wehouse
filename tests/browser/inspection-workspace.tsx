import {createRoot} from 'react-dom/client';
import {Toaster} from 'sonner';
import StaffInspectionWorkspace from '@/components/StaffInspectionWorkspaceV2';
const profile:any={user_id:'field-a',role:'staff',full_name:'Assigned inspector'};
createRoot(document.getElementById('root')!).render(<main className="mx-auto min-h-screen max-w-4xl bg-[var(--wh-bg)] p-4 text-[var(--wh-text-primary)]"><StaffInspectionWorkspace profile={profile}/><Toaster/></main>);

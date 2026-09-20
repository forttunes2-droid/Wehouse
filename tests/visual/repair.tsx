import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReceiptViewer } from '../../src/components/PaymentReceipt';
import RoommatePublicProfile from '../../src/components/RoommatePublicProfile';
import { PublicProfileAction } from '../../src/components/PublicProfileSurface';
import AccountCenter from '../../src/pages/AccountCenter';
import type { WorkspaceChoice } from '../../src/pages/AccountCenter';
import type { Profile } from '../../src/types';
import '../../src/index.css';
const receipt = { id: 'layout-only', reference: 'WH-TEST-LAYOUT-12345678901234567890-12345678901234567890', purpose: 'hotel_booking', amount: 180000, currency: 'NGN', paid_at: '2026-09-20T10:00:00Z', status: 'paid', environment: 'test' as const, payer_name: 'Example Customer', merchant_name: 'Example Hotel and Suites', description: 'Deluxe room', package_name: 'Breakfast included', check_in: '2026-09-24', check_out: '2026-09-30', nights: 6, guests: 2 };
function Review() {
  const [open, setOpen] = useState(true);
  const [workspace,setWorkspace] = useState<WorkspaceChoice>('personal');
  const inner = new URLSearchParams(location.search).get('view');
  if (inner === 'receipt') return <><button onClick={() => setOpen(true)}>Open example receipt</button><ReceiptViewer open={open} onClose={() => setOpen(false)} receipt={receipt} /></>;
  if (inner === 'conversation') return open ? <RoommatePublicProfile context="conversation" person={{ name: 'Example Contact', username: 'example', bio: 'Example public profile. This is separate from conversation info.', location: 'Lafia, Nasarawa', occupation: 'Designer' }} onClose={() => setOpen(false)} actions={<PublicProfileAction label="Audio" onClick={() => {}}>☎</PublicProfileAction>} /> : <button onClick={() => setOpen(true)}>Open conversation info</button>;
  if (inner === 'account') return <AccountCenter key={workspace} profile={{user_id:'layout-review',role:'user',full_name:'Example Account',worker_status:'profile_under_review'} as Profile} activeWorkspace={workspace} workspaceAccess={{identity:{user_id:'layout-review'},personal_workspace:true,privileged_workspaces:[{role:'worker'},{role:'property_partner'},{role:'hotel'},{role:'admin'}]}} onSwitchWorkspace={setWorkspace} onGoToPrivacy={()=>{}} onGoToSaved={()=>{}} onGoToSecurity={()=>{}} onGoToProfileEdit={()=>{}} />;
  return <main style={{ padding: 24, color: 'white' }}><h1>Layout review · simulated data</h1><p>No customer, verification, or payment changes. Account records require authentication and will show a recoverable error here.</p><nav style={{display:'flex',gap:24,margin:'24px 0'}}>{['receipt','conversation','account'].map(kind => <a key={kind} href={`?view=${kind}`}>{kind}</a>)}</nav></main>;
}
createRoot(document.getElementById('root')!).render(<Review />);

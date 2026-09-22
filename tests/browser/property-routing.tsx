import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import PropertyOwnerDashboard from '../../src/pages/PropertyOwnerDashboard';
import HotelTeamDashboard from '../../src/pages/HotelTeamDashboard';
import UserProfileModal from '../../src/components/UserProfileModal';
import AccountCenter from '../../src/pages/AccountCenter';
import { fixtureProfile } from './authFixture';
import '../../src/index.css';
const noop = () => {};
const mode = new URLSearchParams(location.search).get('mode') || 'partner';
const partner = { ...fixtureProfile, user_id: 'qa-owner', role: 'property_partner' as const,
 full_name: 'Test Partner', username: 'test-partner', email: 'partner@example.invalid' };
function Fixture() {
 const [account, setAccount] = useState(false);
 const [person, setPerson] = useState(false);
 useEffect(() => { history.replaceState({ page: mode, workspace: mode === 'team' ? 'hotel' : mode === 'creator' ? 'creator' : 'property_partner' }, ''); }, []);
 const navigate = (page: string) => { (window as any).__navigation = page; if (page === 'profile') setAccount(true); };
 if (account) return <AccountCenter profile={partner} activeWorkspace={mode === 'team' ? 'hotel' : 'property_partner'} onBack={() => setAccount(false)}
 onGoToSaved={noop} onGoToPrivacy={noop} onGoToSecurity={noop} onGoToProfileEdit={noop}
 onSwitchWorkspace={workspace => { (window as any).__workspaceSwitch = workspace; }}
 workspaceAccess={{ identity: { user_id: partner.user_id }, personal_workspace: true, privileged_workspaces: [{ role: mode === 'team' ? 'hotel' : 'property_partner' }] }} />;
 if (mode === 'creator') return <main className="min-h-screen bg-[#0A0A0F] p-6 text-white">
 <h1>Creator property review</h1><button onClick={() => setPerson(true)}>View partner</button>
 {person ? <UserProfileModal user={partner} adminProfile={fixtureProfile} onClose={() => setPerson(false)} onNavigate={navigate} /> : null}
 </main>;
 return mode === 'team' ? <HotelTeamDashboard profile={partner} onLogout={noop} onNavigate={navigate} />
 : <PropertyOwnerDashboard profile={partner} onLogout={noop} onNavigate={navigate} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /><Toaster /></StrictMode>);

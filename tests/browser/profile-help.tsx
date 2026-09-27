import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import AccountCenter from '../../src/pages/AccountCenter';
import AccountHelpCenter from '../../src/components/AccountHelpCenter';
import RoommatePublicProfile from '../../src/components/RoommatePublicProfile';
import SupportChat from '../../src/components/SupportChat';
import { fixtureProfile } from './authFixture';
import '../../src/index.css';
import '../../src/chat-mobile.css';
const noop = () => {};
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'profile';
const partner = params.get('workspace') === 'property_partner';
const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#7c3aed"/><text x="40" y="52" font-size="36" text-anchor="middle" fill="white">T</text></svg>');
const profile = { ...fixtureProfile, user_id: 'qa-self', role: partner ? 'property_partner' as const : 'user' as const,
  full_name: 'Taylor Test', username: 'taylor-test', email: 'qa-self@example.invalid', avatar_url: avatar };
const person = { name: 'Avery Test', username: 'avery-test', avatar, bio: 'A quiet, tidy home.', location: 'Lafia, Nasarawa', preferredArea: 'Flexible' };
function Fixture() {
  const [screen, setScreen] = useState<'discovery' | 'conversation' | null>(null);
  useEffect(() => {
    history.replaceState({ page: 'conversation', workspace: 'personal' }, '');
    const record = (event: Event) => { (window as any).__lastSupportContext = (event as CustomEvent).detail; };
    window.addEventListener('openSupportChat', record);
    return () => window.removeEventListener('openSupportChat', record);
  }, []);
  if (mode === 'account') return <AccountCenter profile={profile} onBack={noop} onGoToSaved={noop}
    onGoToPrivacy={noop} onGoToSecurity={noop} onGoToProfileEdit={noop} activeWorkspace="personal"
    workspaceAccess={{ identity: { user_id: profile.user_id }, personal_workspace: true, privileged_workspaces: [] }} />;
  if (mode === 'help') return <>
    <AccountHelpCenter profile={profile} onBack={noop} workspace={partner ? 'property_partner' : 'personal'} />
    <SupportChat profile={profile} />
  </>;
  return <main className="min-h-screen bg-[#090B10] p-5 text-white">
    <h1 className="mb-5 text-lg">Roommate conversation</h1>
    <button className="mr-3 min-h-11 rounded-xl bg-violet-600 px-3" onClick={() => setScreen('discovery')}>Open discovery profile</button>
    <button className="min-h-11 rounded-xl border border-white/30 px-3" onClick={() => setScreen('conversation')}>Open conversation info</button>
    {screen ? <RoommatePublicProfile person={person} context={screen} onClose={() => setScreen(null)}
      score={screen === 'discovery' ? 82 : undefined} matchLabel="Good match" highlights={['Budget','Location']}
      primaryAction={screen === 'discovery' ? <button className="h-12 w-full rounded-xl bg-violet-500" onClick={() => setScreen(null)}>Message</button> : undefined} /> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /><Toaster /></StrictMode>);

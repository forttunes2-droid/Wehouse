import { Toaster } from 'sonner';
import AccountShell from '@/components/AccountShell';
import PrivacySettings from '@/pages/PrivacySettings';
import SecuritySettings from '@/pages/SecuritySettings';
import type { Profile } from '@/types';
import SecureMessagesPanel from '@/components/SecureMessagesPanel';

type Props={profile:Profile;onUpdate:(profile:Profile)=>void;onBack:()=>void};

export default function PrivacySecuritySettings({profile,onUpdate,onBack}:Props){
  return <AccountShell profile={profile} title="Privacy & Security" description="Manage who can discover you, how private chats are protected, and access to your account." onBack={onBack}>
    <Toaster position="top-center" richColors/>
    <section>
      <p className="mb-2 px-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#656C7C]">Privacy & visibility</p>
      <PrivacySettings profile={profile} onUpdate={onUpdate} embedded/>
    </section>
    <section className="space-y-4">
      <p className="px-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#656C7C]">Private conversations</p>
      <SecureMessagesPanel/>
    </section>
    <section className="space-y-4">
      <p className="px-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#656C7C]">Sign-in & account access</p>
      <SecuritySettings profile={profile} embedded/>
    </section>
  </AccountShell>;
}

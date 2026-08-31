import { Toaster } from 'sonner';
import AccountShell from '@/components/AccountShell';
import PrivacySettings from '@/pages/PrivacySettings';
import SecuritySettings from '@/pages/SecuritySettings';
import type { Profile } from '@/types';
import SecureMessagesPanel from '@/components/SecureMessagesPanel';

type Props={profile:Profile;onUpdate:(profile:Profile)=>void;onBack:()=>void};

export default function PrivacySecuritySettings({profile,onUpdate,onBack}:Props){
  return <AccountShell profile={profile} title="Privacy & Security" description="Control visibility, sign-ins, devices and account protection in one place." onBack={onBack}>
    <Toaster position="top-center" richColors/>
    <section>
      <p className="mb-2 px-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#656C7C]">Privacy & visibility</p>
      <PrivacySettings profile={profile} onUpdate={onUpdate} embedded/>
    </section>
    <section className="space-y-4">
      <p className="px-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#656C7C]">Access & account protection</p>
      <SecuritySettings profile={profile} embedded/>
      <SecureMessagesPanel/>
    </section>
  </AccountShell>;
}

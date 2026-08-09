import BackButton from '@/components/BackButton';
import PropertyPartnerFinancePanel from '@/components/PropertyPartnerFinancePanel';
import WorkerWallet from './WorkerWallet';
import type { Profile } from '@/types';

interface WalletPageProps {
  profile: Profile;
  onBack: () => void;
}

export default function WalletPage({ profile, onBack }: WalletPageProps) {
  return (
    <div className="min-h-[100dvh] bg-[#09090D] text-white">
      <div className="mx-auto max-w-7xl px-4 pt-4 lg:px-8">
        <BackButton onBack={onBack} label="Back" />
      </div>
      {profile.role === 'worker' ? (
        <WorkerWallet profile={profile} />
      ) : profile.role === 'property_partner' ? (
        <div className="mx-auto max-w-7xl px-4 py-5 pb-24 lg:px-8 lg:py-8">
          <PropertyPartnerFinancePanel profile={profile} />
        </div>
      ) : (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="text-lg font-semibold">Wallet unavailable</h1>
          <p className="mt-2 text-xs text-[#77798B]">Wallets are only available to verified Workers and Property Partners.</p>
        </div>
      )}
    </div>
  );
}

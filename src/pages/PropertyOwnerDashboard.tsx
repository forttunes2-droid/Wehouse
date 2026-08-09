import PropertyInspectionRequestPanel from '@/components/PropertyInspectionRequestPanel';
import PropertyPartnerFinancePanel from '@/components/PropertyPartnerFinancePanel';
import LegacyPropertyOwnerDashboard from './PropertyOwnerDashboardLegacy';
import type { Profile } from '@/types';

interface Props {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
}

export default function PropertyOwnerDashboard(props: Props) {
  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <div className="relative z-50 px-4 pt-4 lg:px-8 space-y-4">
        <PropertyInspectionRequestPanel profile={props.profile} />
        <PropertyPartnerFinancePanel profile={props.profile} />
      </div>
      <LegacyPropertyOwnerDashboard {...props} />
    </div>
  );
}

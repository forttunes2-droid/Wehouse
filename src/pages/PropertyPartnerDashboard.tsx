import PropertyOwnerDashboard from '@/pages/PropertyOwnerDashboard';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

export default function PropertyPartnerDashboard(props: Props) {
  return <PropertyOwnerDashboard {...props} />;
}

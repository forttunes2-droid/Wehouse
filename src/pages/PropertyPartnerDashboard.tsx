import LegacyWorkspaceBridge from '@/components/LegacyWorkspaceBridge';
import PropertyOwnerDashboard from '@/pages/PropertyOwnerDashboard';
import type { Profile } from '@/types';

const ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'requests', label: 'Property Requests' },
  { id: 'properties', label: 'My Properties' },
  { id: 'finance', label: 'Finance' },
  { id: 'communication', label: 'Communication' },
];

type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

export default function PropertyPartnerDashboard(props: Props) {
  return (
    <LegacyWorkspaceBridge
      label="WEHOUSE PROPERTY PARTNER"
      items={ITEMS}
      onAccount={() => props.onNavigate('profile')}
      onLogout={props.onLogout}
    >
      <PropertyOwnerDashboard {...props} />
    </LegacyWorkspaceBridge>
  );
}

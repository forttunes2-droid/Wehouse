import LegacyWorkspaceBridge from '@/components/LegacyWorkspaceBridge';
import CreatorDashboard from '@/pages/CreatorDashboard';
import type { Profile } from '@/types';

const ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'operations', label: 'Operations' },
  { id: 'communications', label: 'Communications' },
  { id: 'finance', label: 'Finance' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
];

type Props = {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (id?: string) => void;
};

export default function CreatorDashboardUnified(props: Props) {
  return (
    <LegacyWorkspaceBridge
      label="WEHOUSE CREATOR"
      items={ITEMS}
      onAccount={props.onNavigate ? () => props.onNavigate?.('profile') : undefined}
      onLogout={props.onLogout}
    >
      <CreatorDashboard {...props} />
    </LegacyWorkspaceBridge>
  );
}

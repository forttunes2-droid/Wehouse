import LegacyWorkspaceBridge from '@/components/LegacyWorkspaceBridge';
import AdminDashboard from '@/pages/AdminDashboard';
import type { Profile } from '@/types';

const ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'operations', label: 'Operations' },
  { id: 'communications', label: 'Communications' },
  { id: 'issues', label: 'Issues' },
];

type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

export default function AdminDashboardUnified(props: Props) {
  return (
    <LegacyWorkspaceBridge
      label={`WEHOUSE ADMIN · ${props.profile.assigned_lga || 'BRANCH'}`}
      items={ITEMS}
      onAccount={props.onNavigate ? () => props.onNavigate?.('profile') : undefined}
      onLogout={props.onLogout}
    >
      <AdminDashboard {...props} />
    </LegacyWorkspaceBridge>
  );
}

import CreatorDashboardModern from './CreatorDashboardModern';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (id?: string) => void;
};

export default function CreatorDashboardUnified(props: Props) {
  return <CreatorDashboardModern {...props} />;
}

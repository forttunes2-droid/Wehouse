import CreatorDashboardModernV2 from './CreatorDashboardModernV2';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (id?: string) => void;
};

export default function CreatorDashboardUnified(props: Props) {
  return <CreatorDashboardModernV2 {...props} />;
}

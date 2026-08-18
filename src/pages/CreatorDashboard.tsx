import CreatorDashboardModernV2 from './CreatorDashboardModernV2';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onGoToNewListing?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (id?: string) => void;
};

// One canonical Creator workspace. Keeping this entry as a small adapter stops
// legacy and modern Creator dashboards from drifting apart.
export default function CreatorDashboard({ profile, onLogout, onNavigate, onGoToChat }: Props) {
  return <CreatorDashboardModernV2 profile={profile} onLogout={onLogout} onNavigate={onNavigate} onGoToChat={onGoToChat} />;
}

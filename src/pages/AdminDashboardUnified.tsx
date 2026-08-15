import AdminDashboardModernV2 from './AdminDashboardModernV2';
import type { Profile } from '@/types';

type Props = {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

export default function AdminDashboardUnified(props: Props) {
  return <AdminDashboardModernV2 {...props} />;
}

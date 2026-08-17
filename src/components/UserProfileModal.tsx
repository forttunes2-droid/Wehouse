import UserProfileModalLegacy from '@/components/UserProfileModalLegacy';
import type { Profile } from '@/types';

type Props = {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

// Staff access is managed by branch assignment and explicit module permission.
// The retired probation/trust checklist must not appear in the people modal.
export default function UserProfileModal(props: Props) {
  return <UserProfileModalLegacy {...props} />;
}

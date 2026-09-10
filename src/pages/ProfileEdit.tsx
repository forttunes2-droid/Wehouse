import ProfileEditAccount from './ProfileEditAccount';
import type { Profile } from '@/types';

type Props = { profile: Profile; onUpdate: (profile: Profile) => void; onBack: () => void };

export default function ProfileEdit(props: Props) {
  return <ProfileEditAccount {...props} />;
}

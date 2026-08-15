import { useEffect } from 'react';
import ProfileEditAccount from './ProfileEditAccount';
import type { Profile } from '@/types';

type Props = { profile: Profile; onUpdate: (profile: Profile) => void; onBack: () => void };

export default function ProfileEdit(props: Props) {
  const isWorker = props.profile.role === 'worker';

  useEffect(() => {
    if (!isWorker) return;
    try {
      localStorage.setItem('wh_navpage', 'worker_setup');
      window.history.replaceState({ page: 'worker_setup' }, '', '#worker_setup');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { page: 'worker_setup' } }));
    } catch {}
  }, [isWorker]);

  if (isWorker) {
    return (
      <div className="grid min-h-[70dvh] place-items-center bg-[#090A0F] px-5 text-white">
        <div className="rounded-2xl border border-white/[.07] bg-[#11141C] px-5 py-6 text-center">
          <p className="text-xs font-semibold">Opening Professional Profile…</p>
          <p className="mt-2 text-[10px] text-[#6D7383]">Worker professional information has one editor.</p>
        </div>
      </div>
    );
  }

  return <ProfileEditAccount {...props} />;
}

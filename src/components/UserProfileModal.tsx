import { useState } from 'react';
import UserProfileModalLegacy from '@/components/UserProfileModalLegacy';
import StaffTrustManager from '@/components/StaffTrustManager';
import type { Profile } from '@/types';

type Props = {
  user: Profile | null;
  adminProfile?: Profile | null;
  onClose: () => void;
  onPromote?: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: (convId?: string) => void;
};

export default function UserProfileModal(props: Props) {
  const [trustOpen, setTrustOpen] = useState(false);
  const canManageTrust =
    props.user?.role === 'staff' &&
    (props.adminProfile?.role === 'admin' || props.adminProfile?.role === 'creator');

  return (
    <>
      <UserProfileModalLegacy {...props} />

      {canManageTrust && props.user && (
        <>
          <button
            type="button"
            onClick={() => setTrustOpen(true)}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[100001] rounded-2xl border border-violet-500/25 bg-violet-500 px-4 py-3 text-[10px] font-semibold text-white shadow-2xl sm:bottom-6 sm:right-6"
          >
            Manage Staff trust
          </button>

          {trustOpen && (
            <div className="fixed inset-0 z-[100002] bg-black/80 backdrop-blur-sm" onClick={() => setTrustOpen(false)}>
              <div
                className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-white/[.08] bg-[#0E1017] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[430px] sm:rounded-none sm:border-l sm:border-t-0 sm:p-5"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">WEHOUSE TEAM</p>
                    <h2 className="mt-1 text-lg font-bold">Staff trust</h2>
                    <p className="mt-1 text-[10px] text-[#6E7484]">@{props.user.username || props.user.user_id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTrustOpen(false)}
                    className="grid h-10 w-10 place-items-center rounded-full border border-white/[.08] bg-white/[.04] text-lg text-[#A6ABB8]"
                  >
                    ×
                  </button>
                </div>

                <StaffTrustManager staff={props.user} actor={props.adminProfile} />
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

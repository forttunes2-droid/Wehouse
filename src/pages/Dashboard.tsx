import type { Profile } from '@/types';

interface DashboardProps {
  profile: Profile;
  onLogout: () => void;
}

export default function Dashboard({ profile, onLogout }: DashboardProps) {
  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      {/* Header */}
      <header className="bg-[#0F1724] text-white px-5 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8A45A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold">{profile.username || 'User'}</div>
              <div className="text-[10px] text-white/50">{profile.email}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-white/50 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-lg mx-auto px-5 py-6 space-y-4">
        {/* Profile Card */}
        <div className="bg-white rounded-2xl p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-[#0F1724] flex items-center justify-center text-[#C8A45A] text-xl font-bold">
              {(profile.username || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-base font-semibold text-[#0F1724]">
                @{profile.username || '...'}
              </div>
              <div className="text-xs text-[#8B8680]">{profile.email}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#f0eeea]">
            <div className="text-center">
              <div className="text-xs text-[#8B8680]">User ID</div>
              <div className="text-sm font-semibold text-[#0F1724]">{profile.user_id}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-[#8B8680]">Role</div>
              <div className="text-sm font-semibold text-[#0F1724] capitalize">{profile.role.replace('_', ' ')}</div>
            </div>
          </div>
        </div>

        {/* Stats / Coming Soon */}
        <div className="bg-white rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Your Activity</h3>
          <div className="text-xs text-[#8B8680] py-8 text-center">
            More features coming soon...
          </div>
        </div>
      </main>
    </div>
  );
}

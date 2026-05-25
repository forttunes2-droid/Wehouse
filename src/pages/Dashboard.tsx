import type { Profile } from '@/types';

interface DashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: () => void;
  onGoToProfileEdit?: () => void;
}

export default function Dashboard({ profile, onLogout, onNavigate, onGoToChat, onGoToProfileEdit }: DashboardProps) {
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

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          {onGoToChat && (
            <button onClick={onGoToChat} className="bg-white rounded-2xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-[#0F1724] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8A45A" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-[#0F1724]">Messages</div>
                <div className="text-[10px] text-[#8B8680]">Chat with users</div>
              </div>
            </button>
          )}
          {onGoToProfileEdit && (
            <button onClick={onGoToProfileEdit} className="bg-white rounded-2xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-[#0F1724] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8A45A" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-[#0F1724]">Edit Profile</div>
                <div className="text-[10px] text-[#8B8680]">Update your info</div>
              </div>
            </button>
          )}
        </div>

        {/* Trust Badges */}
        <div className="bg-white rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-[#0F1724] mb-3">Trust & Verification</h3>
          <div className="flex flex-wrap gap-2">
            {profile.email_verified && (
              <span className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                Email Verified
              </span>
            )}
            {profile.phone_verified && (
              <span className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                Phone Verified
              </span>
            )}
            {profile.id_verified && (
              <span className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                ID Verified
              </span>
            )}
            {!profile.email_verified && !profile.phone_verified && !profile.id_verified && (
              <span className="text-[10px] text-[#8B8680]">No verifications yet</span>
            )}
          </div>
        </div>

        {/* Bio & Details */}
        {(profile.bio || profile.occupation || profile.school || profile.preferred_location) && (
          <div className="bg-white rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-[#0F1724] mb-3">About</h3>
            {profile.bio && <p className="text-xs text-[#8B8680] mb-2">{profile.bio}</p>}
            <div className="space-y-2">
              {profile.occupation && <div className="text-xs"><span className="text-[#8B8680]">Occupation:</span> <span className="text-[#0F1724] font-medium">{profile.occupation}</span></div>}
              {profile.is_student && profile.school && <div className="text-xs"><span className="text-[#8B8680]">School:</span> <span className="text-[#0F1724] font-medium">{profile.school}</span></div>}
              {profile.preferred_location && <div className="text-xs"><span className="text-[#8B8680]">Location:</span> <span className="text-[#0F1724] font-medium">{profile.preferred_location}</span></div>}
              {profile.budget_max > 0 && <div className="text-xs"><span className="text-[#8B8680]">Budget:</span> <span className="text-[#0F1724] font-medium">₦{profile.budget_min.toLocaleString()} - ₦{profile.budget_max.toLocaleString()}</span></div>}
            </div>
          </div>
        )}

        {/* Creator Dashboard Link */}
        {profile.role === 'creator_admin' && onNavigate && (
          <button
            onClick={() => onNavigate('creator')}
            className="w-full bg-[#C8A45A] text-[#0F1724] rounded-2xl p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0F1724] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8A45A" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold">Creator Dashboard</div>
                <div className="text-[10px] opacity-70">Manage listings, users, analytics</div>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        )}

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

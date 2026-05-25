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
    <div className="min-h-screen bg-[#0A0A0F] pb-24">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-6">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-bold text-white">Profile</h1>
            <button onClick={onLogout} className="text-xs text-[#5C5E72] hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10">
              Logout
            </button>
          </div>

          {/* Profile Card */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xl font-bold flex-shrink-0 glow-blue-sm">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full rounded-2xl object-cover" />
                ) : (
                  (profile.username || profile.email[0]).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white truncate">@{profile.username || '...'}</h2>
                  {profile.role === 'creator_admin' && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30">CREATOR</span>
                  )}
                </div>
                <p className="text-xs text-[#5C5E72] truncate">{profile.email}</p>
                <p className="text-[10px] text-[#5C5E72] mt-0.5">ID: {profile.user_id}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          {onGoToChat && (
            <button onClick={onGoToChat} className="glass rounded-2xl p-4 flex items-center gap-3 card-hover text-left group">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center group-hover:bg-[#3B82F6]/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Messages</div>
                <div className="text-[10px] text-[#5C5E72]">Chat with users</div>
              </div>
            </button>
          )}
          {onGoToProfileEdit && (
            <button onClick={onGoToProfileEdit} className="glass rounded-2xl p-4 flex items-center gap-3 card-hover text-left group">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center group-hover:bg-[#3B82F6]/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Edit Profile</div>
                <div className="text-[10px] text-[#5C5E72]">Update your info</div>
              </div>
            </button>
          )}
        </div>

        {/* Trust Badges */}
        <div className="glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Trust & Verification</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Email Verified', active: profile.email_verified, color: 'bg-green-500/10 text-green-400 border-green-500/20' },
              { label: 'Phone Verified', active: profile.phone_verified, color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
              { label: 'ID Verified', active: profile.id_verified, color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
            ].map(badge => (
              <span key={badge.label} className={`text-[10px] font-medium px-3 py-1.5 rounded-full border ${badge.active ? badge.color : 'bg-white/[0.02] text-[#5C5E72] border-white/5'}`}>
                {badge.active && (
                  <svg className="inline w-2.5 h-2.5 mr-1 -mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                )}
                {badge.label}
              </span>
            ))}
          </div>
        </div>

        {/* About */}
        {(profile.bio || profile.occupation || profile.school || profile.preferred_location || profile.gender) && (
          <div className="glass rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">About</h3>
            {profile.bio && <p className="text-xs text-[#8B8DA0] mb-3 leading-relaxed">{profile.bio}</p>}
            <div className="space-y-2.5">
              {profile.gender && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Gender</span>
                  <span className="text-white capitalize">{profile.gender}</span>
                </div>
              )}
              {profile.occupation && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Occupation</span>
                  <span className="text-white">{profile.occupation}</span>
                </div>
              )}
              {profile.is_student && profile.school && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">School</span>
                  <span className="text-white">{profile.school}</span>
                </div>
              )}
              {profile.preferred_location && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Location</span>
                  <span className="text-white">{profile.preferred_location}</span>
                </div>
              )}
              {profile.budget_max > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Budget</span>
                  <span className="text-white">{profile.budget_min > 0 ? `₦${profile.budget_min.toLocaleString()} - ` : ''}₦{profile.budget_max.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Creator Link */}
        {profile.role === 'creator_admin' && onNavigate && (
          <button onClick={() => onNavigate('creator')} className="w-full glass rounded-2xl p-4 flex items-center justify-between card-hover group">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center glow-blue-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-white">Creator Dashboard</div>
                <div className="text-[10px] text-[#5C5E72]">Manage users, listings, analytics</div>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" className="group-hover:translate-x-0.5 transition-transform"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        )}

        {/* Account Info */}
        <div className="glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Account</h3>
          <div className="space-y-2.5">
            {[
              { label: 'User ID', value: profile.user_id },
              { label: 'Email', value: profile.email },
              { label: 'Role', value: profile.role === 'creator_admin' ? 'Creator Admin' : profile.role },
              { label: 'Joined', value: new Date(profile.created_at).toLocaleDateString() },
            ].map(item => (
              <div key={item.label} className="flex justify-between text-xs">
                <span className="text-[#5C5E72]">{item.label}</span>
                <span className="text-[#8B8DA0]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

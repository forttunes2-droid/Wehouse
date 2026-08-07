import type { Profile } from '@/types';

interface AccountCenterProps {
  profile: Profile;
  onBack: () => void;
  onGoToPrivacy: () => void;
  onGoToSecurity: () => void;
  onGoToProfileEdit: () => void;
}

export default function AccountCenter({ profile, onBack, onGoToPrivacy, onGoToSecurity, onGoToProfileEdit }: AccountCenterProps) {
  const initials = (profile.full_name || profile.username || profile.email || 'U')[0].toUpperCase();
  const roleLabel = profile.role === 'property_partner'
    ? 'Property Partner'
    : profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const isInternal = profile.role === 'staff' || profile.role === 'admin' || profile.role === 'creator';

  const items = [
    { title: 'Profile', description: 'Photo, name, phone, bio and personal location', action: onGoToProfileEdit },
    { title: 'Privacy', description: 'Profile, search, activity and contact visibility', action: onGoToPrivacy },
    { title: 'Security', description: 'Password, sessions and account protection', action: onGoToSecurity },
    { title: 'Help & Support', description: 'Contact the WeHouse support team', action: () => window.dispatchEvent(new CustomEvent('openSupportChat')) },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="text-[#8A8B9C] hover:text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-base font-semibold">Account</h1>
      </header>

      <main className="max-w-lg mx-auto px-5 py-5 space-y-5">
        <section className="glass rounded-2xl p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] overflow-hidden flex items-center justify-center text-white text-xl font-bold">
            {profile.avatar_url ? <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-white truncate">{profile.full_name || `@${profile.username}`}</h2>
            <p className="text-xs text-[#8A8B9C] truncate">@{profile.username || 'not-set'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-[10px] rounded-full px-2 py-1 bg-[#3B82F6]/10 text-[#60A5FA] border border-[#3B82F6]/20">{roleLabel}</span>
              <span className="text-[10px] rounded-full px-2 py-1 bg-white/[0.04] text-[#8A8B9C]">{profile.user_id}</span>
            </div>
          </div>
        </section>

        {isInternal && (
          <section className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4">
            <p className="text-xs font-semibold text-amber-300">Personal profile and operational authority are separate</p>
            <p className="text-[11px] text-[#8A8B9C] mt-1">You can update personal information here. Role, permissions and assigned State/LGA are controlled through authorized management workflows.</p>
            {(profile.assigned_state || profile.assigned_lga) && (
              <p className="text-[11px] text-[#C4A76B] mt-2">Operational assignment: {[profile.assigned_state, profile.assigned_lga].filter(Boolean).join(' / ')}</p>
            )}
          </section>
        )}

        <section className="glass rounded-2xl divide-y divide-white/[0.05] overflow-hidden">
          {items.map((item) => (
            <button key={item.title} onClick={item.action} className="w-full px-4 py-4 flex items-center gap-3 text-left hover:bg-white/[0.025]">
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-white">{item.title}</p><p className="text-[11px] text-[#5C5E72] mt-0.5">{item.description}</p></div>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ))}
        </section>

        <section className="glass rounded-2xl p-4 space-y-3">
          <Info label="Email" value={profile.email} />
          <Info label="Email status" value={profile.email_verified ? 'Verified' : 'Not verified'} />
          <Info label="Personal location" value={[profile.state, profile.local_government || profile.city, profile.area].filter(Boolean).join(' / ') || 'Not set'} />
          <Info label="Member since" value={new Date(profile.created_at).toLocaleDateString()} />
        </section>
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 text-xs"><span className="text-[#5C5E72]">{label}</span><span className="text-[#A8AABC] text-right break-all">{value}</span></div>;
}

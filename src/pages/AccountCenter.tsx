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
  const roleLabel = profile.role === 'property_partner' ? 'Property Partner' : profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const isInternal = profile.role === 'staff' || profile.role === 'admin' || profile.role === 'creator';
  const canEditProfile = profile.role !== 'staff';
  const hasGlobalSupportChat = profile.role === 'user';

  const items = [
    ...(canEditProfile ? [{ title: 'Profile', description: 'Photo, name, phone, bio and personal location', action: onGoToProfileEdit }] : []),
    { title: 'Privacy', description: 'Profile, search, activity and contact visibility', action: onGoToPrivacy },
    { title: 'Security', description: 'Password, sessions and account protection', action: onGoToSecurity },
    ...(hasGlobalSupportChat ? [{ title: 'Help & Support', description: 'Contact the WeHouse support team', action: () => window.dispatchEvent(new CustomEvent('openSupportChat')) }] : []),
  ];

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <header className="border-b border-white/[0.06] bg-[#12121A] px-4 py-4 text-white sm:px-5">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button onClick={onBack} aria-label="Back" className="text-[#8A8B9C] hover:text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-base font-semibold">Account settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-5">
        <section className="glass rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] text-xl font-bold text-white">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="Profile" className="h-full w-full object-cover" /> : initials}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-semibold text-white">{profile.full_name || `@${profile.username}`}</h2>
              <p className="break-all text-xs text-[#8A8B9C]">@{profile.username || 'not-set'}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-[#3B82F6]/20 bg-[#3B82F6]/10 px-2 py-1 text-[10px] text-[#60A5FA]">{roleLabel}</span>
                <span className="max-w-full break-all rounded-full bg-white/[0.04] px-2 py-1 text-[10px] text-[#8A8B9C]">{profile.user_id}</span>
              </div>
            </div>
          </div>
        </section>

        {isInternal && (
          <section className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4">
            <p className="text-xs font-semibold text-amber-300">Personal account and operational authority are separate</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#8A8B9C]">Role, permissions and assigned State/LGA are controlled through authorized management workflows, not account settings.</p>
            {(profile.assigned_state || profile.assigned_lga) && <p className="mt-2 text-[11px] text-[#C4A76B]">Operational assignment: {[profile.assigned_state, profile.assigned_lga].filter(Boolean).join(' / ')}</p>}
            {!canEditProfile && <p className="mt-2 text-[11px] text-[#C4A76B]">Staff profile changes must be requested through your Admin or Creator.</p>}
          </section>
        )}

        <section className="glass overflow-hidden rounded-2xl divide-y divide-white/[0.05]">
          {items.map(item => <button key={item.title} onClick={item.action} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-white/[0.025]"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-white">{item.title}</p><p className="mt-0.5 text-[11px] leading-relaxed text-[#5C5E72]">{item.description}</p></div><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg></button>)}
        </section>

        <section className="glass grid gap-3 rounded-2xl p-4 sm:grid-cols-2">
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
  return <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-[9px] uppercase tracking-wide text-[#5C5E72]">{label}</p><p className="mt-1 break-all text-xs text-[#A8AABC]">{value}</p></div>;
}

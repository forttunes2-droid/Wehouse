import { Toaster } from 'sonner';
import type { Profile } from '@/types';

interface AccountCenterProps {
  profile: Profile;
  onBack: () => void;
  onGoToPrivacy: () => void;
  onGoToSecurity: () => void;
  onGoToProfileEdit: () => void;
}

export default function AccountCenter({ profile, onBack, onGoToPrivacy, onGoToSecurity, onGoToProfileEdit }: AccountCenterProps) {
  const initials = (profile.username || profile.email[0]).toUpperCase();
  const displayName = profile.username || profile.email.split('@')[0];

  const isStaff = profile.role === 'staff';

  type SectionItem = {
    label: string;
    desc: string;
    icon: React.ReactNode;
    action?: () => void;
    value?: string;
    valueColor?: string;
  };

  const personalItems: SectionItem[] = [
    // Staff cannot edit profile — location is assigned by admin
    ...(!isStaff ? [{
      label: 'Edit Profile',
      desc: 'Photo, bio, occupation, location',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
      action: onGoToProfileEdit,
    }] : []),
    {
      label: 'Username',
      desc: `@${profile.username || 'not set'}`,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M16 12l-4-4M16 12l-4 4" />
          <path d="M8 12h8" />
        </svg>
      ),
      action: isStaff ? undefined : onGoToProfileEdit,
      value: `@${profile.username || 'not set'}`,
    },
    {
      label: 'Email',
      desc: profile.email,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      ),
      value: profile.email_verified ? 'Verified' : 'Unverified',
      valueColor: profile.email_verified ? 'text-green-400' : 'text-amber-400',
    },
    {
      label: 'Member Since',
      desc: new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
    },
  ];

  const privacyItems: SectionItem[] = [
    {
      label: 'Privacy Settings',
      desc: 'Profile visibility, search, activity',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      action: onGoToPrivacy,
    },
  ];

  const securityItems: SectionItem[] = [
    {
      label: 'Security Center',
      desc: 'Sessions, login history, password',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      action: onGoToSecurity,
    },
  ];

  const supportItems: SectionItem[] = [
    {
      label: 'Help & Support',
      desc: isStaff ? 'Contact WeHouse support team' : 'Chat with our AI assistant for help',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      action: () => {
        if (isStaff) {
          window.location.href = 'mailto:support@wehouse.com.ng';
        } else {
          window.dispatchEvent(new CustomEvent('openSupportChat'));
        }
      },
    },
    {
      label: 'Support Email',
      desc: 'support@wehouse.com.ng',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      ),
      action: () => {
        window.location.href = 'mailto:support@wehouse.com.ng';
      },
      value: 'support@wehouse.com.ng',
      valueColor: 'text-[#3B82F6]',
    },
  ];

  const sections = [
    { title: 'Personal Information', items: personalItems },
    // Staff don't have Privacy Settings — they're internal, not public
    ...(!isStaff ? [{ title: 'Privacy' as const, items: privacyItems }] : []),
    { title: 'Security', items: securityItems },
    { title: 'Support', items: supportItems },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">Account Center</h1>
      </header>

      <div className="max-w-lg mx-auto px-5 py-5 space-y-6">
        {/* Profile Summary Card */}
        <div className="glass rounded-2xl p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold flex-shrink-0 glow-blue-sm">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-full h-full rounded-2xl object-cover" />
            ) : (
              initials[0]
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">@{displayName}</h2>
            <p className="text-xs text-[#5C5E72] truncate">{profile.email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] text-[#5C5E72]">{profile.user_id}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20">
                {profile.role === 'user' ? 'Member' : profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Staff notice — profile managed by admin */}
        {isStaff && (
          <div className="rounded-2xl p-4 bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="text-xs font-medium text-amber-400">Staff Profile Managed by Admin</p>
              <p className="text-[10px] text-[#8A8B9C] mt-0.5">Your profile details and location are set by the administrator. Contact them if you need changes.</p>
            </div>
          </div>
        )}

        {/* Sections */}
        {sections.map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3 px-1">
              {section.title}
            </h3>
            <div className="glass rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
              {section.items.map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors group"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#1A1A24] flex items-center justify-center flex-shrink-0">
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{item.label}</div>
                    <div className="text-[11px] text-[#5C5E72] truncate">{item.desc}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.value && (
                      <span className={`text-[10px] ${item.valueColor || 'text-[#5C5E72]'}`}>{item.value}</span>
                    )}
                    {item.action && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#5C5E72"
                        strokeWidth="2"
                        className="group-hover:translate-x-0.5 transition-transform"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Account Info */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3 px-1">Account Details</h3>
          <div className="glass rounded-2xl p-4 space-y-3">
            {[
              { label: 'User ID', value: profile.user_id },
              { label: 'Role', value: profile.role === 'user' ? 'Member' : profile.role.charAt(0).toUpperCase() + profile.role.slice(1) },
              {
                label: 'Joined',
                value: new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                }),
              },
              {
                label: 'Last Updated',
                value: new Date(profile.updated_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                }),
              },
            ].map((item) => (
              <div key={item.label} className="flex justify-between text-xs">
                <span className="text-[#5C5E72]">{item.label}</span>
                <span className="text-[#8B8DA0] font-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

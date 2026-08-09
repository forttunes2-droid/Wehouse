import type { Profile } from '@/types';

interface DashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: () => void;
  onGoToProfileEdit?: () => void;
  onGoToAccount?: () => void;
  isAdmin?: boolean;
  onGoToNewListing?: () => void;
}

type Shortcut = {
  title: string;
  description: string;
  page?: string;
  action?: () => void;
  tone: 'blue' | 'violet' | 'emerald' | 'amber';
};

export default function Dashboard({ profile, onLogout, onNavigate, onGoToChat, onGoToProfileEdit, onGoToAccount }: DashboardProps) {
  const initials = (profile.full_name || profile.username || profile.email || 'U')[0].toUpperCase();
  const roleLabel = profile.role === 'property_partner'
    ? 'Property Partner'
    : profile.role.charAt(0).toUpperCase() + profile.role.slice(1);

  const shortcuts = getShortcuts(profile.role, onNavigate, onGoToChat);

  return (
    <div className="min-h-[100dvh] bg-[#09090D] px-4 py-5 pb-24 text-white lg:px-8 lg:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.1] via-[#14151F] to-[#101018] p-5 lg:p-7">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-bold shadow-xl shadow-blue-950/30">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
            </div>
            <div className="min-w-0 flex-1">
              <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-blue-300">{roleLabel}</span>
              <h1 className="mt-3 truncate text-2xl font-bold">{profile.full_name || profile.username || 'WeHouse account'}</h1>
              <p className="mt-1 truncate text-xs text-[#7A7C8F]">@{profile.username || 'not-set'} · {profile.email}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={onGoToProfileEdit} className="rounded-xl bg-blue-500 px-4 py-3 text-xs font-semibold hover:bg-blue-400">Edit profile</button>
              <button onClick={onGoToAccount} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-[#C4C5D0]">Account center</button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Info label="User ID" value={profile.user_id} />
          <Info label="Personal location" value={[profile.state, profile.local_government || profile.city].filter(Boolean).join(' / ') || 'Not set'} />
          <Info label="Email status" value={profile.email_verified ? 'Verified' : 'Not verified'} />
        </section>

        <section>
          <div className="mb-3"><h2 className="text-sm font-semibold">Your WeHouse tools</h2><p className="mt-1 text-[10px] text-[#66687B]">Only actions related to your role are shown here.</p></div>
          <div className="grid gap-3 md:grid-cols-2">
            {shortcuts.map(item => (
              <button key={item.title} onClick={() => item.action ? item.action() : item.page && onNavigate?.(item.page)} className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${tone(item.tone)}`}>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-[10px] leading-relaxed opacity-75">{item.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111119]">
          <button onClick={() => onNavigate?.('privacy')} className="flex w-full items-center justify-between p-4 text-left hover:bg-white/[0.025]"><div><p className="text-sm font-medium">Privacy</p><p className="mt-1 text-[10px] text-[#66687B]">Control profile and contact visibility</p></div><span className="text-[#55576A]">›</span></button>
          <button onClick={() => onNavigate?.('security')} className="flex w-full items-center justify-between p-4 text-left hover:bg-white/[0.025]"><div><p className="text-sm font-medium">Security</p><p className="mt-1 text-[10px] text-[#66687B]">Password, sessions and account protection</p></div><span className="text-[#55576A]">›</span></button>
          <button onClick={onLogout} className="flex w-full items-center justify-between p-4 text-left text-red-300 hover:bg-red-500/[0.05]"><div><p className="text-sm font-medium">Log out</p><p className="mt-1 text-[10px] text-red-300/60">Sign out of this device</p></div><span>›</span></button>
        </section>
      </div>
    </div>
  );
}

function getShortcuts(role: string, onNavigate?: (page: string) => void, onGoToChat?: () => void): Shortcut[] {
  if (role === 'worker') {
    return [
      { title: 'Worker dashboard', description: 'Jobs, schedule, availability, verification and earnings.', page: 'worker_dashboard', tone: 'blue' },
      { title: 'Wallet', description: 'Released earnings, withdrawals and transaction history.', page: 'wallet', tone: 'emerald' },
      { title: 'Messages', description: 'Booking conversations and customer messages.', action: onGoToChat, tone: 'violet' },
      { title: 'My bookings', description: 'Services you booked as a customer.', page: 'my_bookings', tone: 'amber' },
    ];
  }
  if (role === 'property_partner') {
    return [
      { title: 'Property Partner dashboard', description: 'Property requests, WeHouse listings and verified earnings.', page: 'property_partner', tone: 'violet' },
      { title: 'Wallet', description: 'Pending, available and withdrawn property earnings.', page: 'wallet', tone: 'emerald' },
      { title: 'Messages', description: 'Communication with WeHouse about properties and payments.', page: 'property_partner', tone: 'blue' },
      { title: 'Support', description: 'Request help from WeHouse through the partner dashboard.', page: 'property_partner', tone: 'amber' },
    ];
  }
  if (role === 'staff') {
    return [
      { title: 'Staff hub', description: 'Open assigned operational tools and tasks.', page: 'staff_dashboard', tone: 'amber' },
      { title: 'Management', description: 'Open only the modules allowed by your permissions.', page: 'management', tone: 'blue' },
      { title: 'Messages', description: 'Operational and support conversations.', page: 'messages', tone: 'violet' },
      { title: 'Account', description: 'Review your personal account and assigned branch.', page: 'account', tone: 'emerald' },
    ];
  }
  if (role === 'admin') {
    return [
      { title: 'Admin dashboard', description: 'Manage your assigned operational area.', page: 'admin', tone: 'blue' },
      { title: 'Management', description: 'Users, staff, listings and approvals within your authority.', page: 'management', tone: 'violet' },
      { title: 'Analytics', description: 'Platform and branch performance information.', page: 'analytics', tone: 'emerald' },
      { title: 'Messages', description: 'Operational and support conversations.', page: 'messages', tone: 'amber' },
    ];
  }
  if (role === 'creator') {
    return [
      { title: 'Creator dashboard', description: 'Platform-wide oversight and protected Creator controls.', page: 'creator', tone: 'violet' },
      { title: 'Management', description: 'Users, roles, listings, finance and platform operations.', page: 'management', tone: 'blue' },
      { title: 'Analytics', description: 'Platform-wide performance and reports.', page: 'analytics', tone: 'emerald' },
      { title: 'Account', description: 'Personal account and security settings.', page: 'account', tone: 'amber' },
    ];
  }
  return [
    { title: 'Explore homes', description: 'Browse available apartments and hotels.', page: 'explore', tone: 'blue' },
    { title: 'Saved listings', description: 'Return to homes you saved.', page: 'saved', tone: 'violet' },
    { title: 'My bookings', description: 'Track worker services you booked.', page: 'my_bookings', tone: 'emerald' },
    { title: 'My reservations', description: 'Track apartment and hotel reservations.', page: 'my_reservations', tone: 'amber' },
  ];
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#606274]">{label}</p><p className="mt-2 break-words text-xs font-medium text-[#D3D4DC]">{value}</p></div>;
}

function tone(value: Shortcut['tone']) {
  const styles = {
    blue: 'border-blue-500/15 bg-blue-500/[0.05] text-blue-200 hover:border-blue-500/30',
    violet: 'border-violet-500/15 bg-violet-500/[0.05] text-violet-200 hover:border-violet-500/30',
    emerald: 'border-emerald-500/15 bg-emerald-500/[0.05] text-emerald-200 hover:border-emerald-500/30',
    amber: 'border-amber-500/15 bg-amber-500/[0.05] text-amber-200 hover:border-amber-500/30',
  };
  return styles[value];
}

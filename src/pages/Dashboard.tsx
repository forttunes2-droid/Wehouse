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

export default function Dashboard({ profile, onLogout, onNavigate, onGoToProfileEdit, onGoToAccount }: DashboardProps) {
  const initials = (profile.full_name || profile.username || profile.email || 'U')[0].toUpperCase();
  const roleLabel = profile.role === 'property_partner'
    ? 'Property Partner'
    : profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const location = [profile.state, profile.local_government || profile.city].filter(Boolean).join(' / ') || 'Not set';

  return (
    <div className="min-h-[100dvh] bg-[#09090D] px-4 py-5 pb-24 text-white lg:px-8 lg:py-8">
      <div className="mx-auto max-w-4xl space-y-5">
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
            <div className="flex flex-wrap gap-2">
              <button onClick={onGoToProfileEdit} className="rounded-xl bg-blue-500 px-4 py-3 text-xs font-semibold hover:bg-blue-400">Edit profile</button>
              <button onClick={onGoToAccount} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-[#C4C5D0]">Account center</button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <Info label="WeHouse user ID" value={profile.user_id} />
          <Info label="Personal location" value={location} />
          <Info label="Email status" value={profile.email_verified ? 'Verified' : 'Not verified'} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#111119]">
          <Row title="Profile" text="Update your personal information and profile photo" onClick={onGoToProfileEdit} />
          <Row title="Account center" text="Open your complete account settings" onClick={onGoToAccount} />
          <Row title="Privacy" text="Control profile and contact visibility" onClick={() => onNavigate?.('privacy')} />
          <Row title="Security" text="Password, sessions and account protection" onClick={() => onNavigate?.('security')} />
          <button onClick={onLogout} className="flex w-full items-center justify-between border-t border-white/[0.05] p-4 text-left text-red-300 hover:bg-red-500/[0.05]">
            <div><p className="text-sm font-medium">Log out</p><p className="mt-1 text-[10px] text-red-300/60">Sign out of this device</p></div><span>›</span>
          </button>
        </section>

        <section className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4">
          <p className="text-[10px] leading-relaxed text-[#6E7082]">Operational tools belong inside your role dashboard. This Account page contains only personal profile, privacy and security controls.</p>
        </section>
      </div>
    </div>
  );
}

function Row({ title, text, onClick }: { title: string; text: string; onClick?: () => void }) {
  return <button onClick={onClick} disabled={!onClick} className="flex w-full items-center justify-between border-b border-white/[0.05] p-4 text-left last:border-b-0 hover:bg-white/[0.025] disabled:cursor-default disabled:opacity-50"><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-[10px] text-[#66687B]">{text}</p></div><span className="text-[#55576A]">›</span></button>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#606274]">{label}</p><p className="mt-2 break-words text-xs font-medium text-[#D3D4DC]">{value}</p></div>;
}

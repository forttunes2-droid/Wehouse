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

export default function Dashboard({ profile, onLogout, onGoToProfileEdit, onGoToAccount }: DashboardProps) {
  const initials = (profile.full_name || profile.username || profile.email || 'U')[0].toUpperCase();
  const roleLabel = profile.role === 'property_partner' ? 'Property Partner' : profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  const location = [profile.state, profile.local_government || profile.city].filter(Boolean).join(' / ') || 'Not set';
  const canEditProfile = profile.role !== 'staff';
  const operationalRole = profile.role !== 'user';

  return (
    <div className={`${operationalRole ? 'role-workspace ' : ''}min-h-[100dvh] bg-[#09090D] px-4 py-5 pb-24 text-white sm:px-5 lg:px-8 lg:py-8`}>
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.1] via-[#14151F] to-[#101018] p-5 sm:p-6 lg:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-bold shadow-xl shadow-blue-950/30">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
            </div>
            <div className="min-w-0 flex-1">
              <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-blue-300">{roleLabel}</span>
              <h1 className="mt-3 break-words text-2xl font-bold">{profile.full_name || profile.username || 'WeHouse account'}</h1>
              <p className="mt-1 break-all text-xs text-[#7A7C8F]">@{profile.username || 'not-set'} · {profile.email}</p>
            </div>
            <div className={`grid w-full gap-2 sm:w-auto ${canEditProfile ? 'sm:min-w-[170px]' : ''}`}>
              {canEditProfile && <button onClick={onGoToProfileEdit} className="rounded-xl bg-blue-500 px-4 py-3 text-xs font-semibold hover:bg-blue-400">Edit profile</button>}
              <button onClick={onGoToAccount} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-[#C4C5D0]">Account settings</button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="WeHouse user ID" value={profile.user_id} />
          <Info label="Personal location" value={location} />
          <Info label="Email status" value={profile.email_verified ? 'Verified' : 'Not verified'} />
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Account</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#6E7082]">Account settings contains privacy, security and supported personal controls. Operational tools stay inside your role workspace.</p>
          <div className={`mt-4 grid gap-2 ${canEditProfile ? 'sm:grid-cols-2' : ''}`}>
            {canEditProfile && <Action title="Edit profile" text="Photo and personal information" onClick={onGoToProfileEdit} />}
            <Action title="Account settings" text="Privacy, security and supported account controls" onClick={onGoToAccount} />
          </div>
          {!canEditProfile && <p className="mt-3 text-[10px] text-amber-300/80">Staff profile changes are managed through Admin/Creator assignment workflows.</p>}
        </section>

        <button onClick={onLogout} className="w-full rounded-2xl border border-red-500/15 bg-red-500/[0.05] p-4 text-left text-red-300 hover:bg-red-500/[0.08]">
          <p className="text-sm font-medium">Log out</p><p className="mt-1 text-[10px] text-red-300/60">Sign out of this device</p>
        </button>
      </div>
    </div>
  );
}

function Action({ title, text, onClick }: { title: string; text: string; onClick?: () => void }) {
  return <button onClick={onClick} disabled={!onClick} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 text-left hover:bg-white/[0.045] disabled:cursor-default disabled:opacity-50"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-[10px] text-[#66687B]">{text}</p></button>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.06] bg-[#111119] p-4"><p className="text-[9px] uppercase tracking-wide text-[#606274]">{label}</p><p className="mt-2 break-words text-xs font-medium text-[#D3D4DC]">{value}</p></div>;
}

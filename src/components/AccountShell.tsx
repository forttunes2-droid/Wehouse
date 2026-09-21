import type { Profile } from '@/types';
import BackButton from '@/components/BackButton';
import { workspaceLabel, type WorkspaceName } from '@/lib/workspacePresentation';

type Props = {
  profile: Profile;
  title: string;
  description?: string;
  onBack?: () => void;
  onWorkspaceSwitch?: () => void;
  children: React.ReactNode;
  workspace?: WorkspaceName;
};

export default function AccountShell({ profile, title, description, onBack, onWorkspaceSwitch, children, workspace }: Props) {
  const role = String(profile.role || 'user');
  const roleLabel = workspace ? workspaceLabel(workspace).toUpperCase() : role === 'property_partner'
    ? 'PROPERTY PARTNER'
    : role === 'staff'
      ? 'TEAM'
    : role.replace(/_/g, ' ').toUpperCase();

  return (
    <div className="role-workspace min-h-[100dvh] bg-[#0A0A0F] pb-[calc(5.25rem+env(safe-area-inset-bottom))] text-white sm:pb-10">
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0A0A0F]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-5 lg:px-8">
          <div className="flex items-start gap-3">
            {onBack && <BackButton onClick={onBack} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE · {roleLabel}</p>
              <h1 className="mt-1 truncate text-lg font-semibold">{title}</h1>
              {description ? <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#74798B]">{description}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-white/[.08] bg-violet-500/[.10] text-[11px] font-bold text-violet-200" aria-label="Your profile">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span>{String(profile.full_name || profile.username || "W").trim().charAt(0).toUpperCase()}</span>
                )}
              </div>
              {onWorkspaceSwitch ? (
                <button
                  type="button"
                  onClick={onWorkspaceSwitch}
                  className="min-h-10 shrink-0 px-1 text-[10px] font-semibold text-violet-300"
                >
                  Workspaces
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main key={title} className="wh-panel-enter mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 lg:px-8 lg:py-7">
        {children}
      </main>
    </div>
  );
}

export function AccountSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title ? <p className="mb-2 px-1 text-[9px] font-bold uppercase tracking-[.16em] text-[#656C7C]">{title}</p> : null}
      <div className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#11141C]">{children}</div>
    </section>
  );
}

export function AccountRow({
  title,
  detail,
  onClick,
  disabled = false,
  icon,
  trailing,
}: {
  title: string;
  detail?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      className="flex min-h-[3.75rem] w-full items-center gap-3 border-b border-white/[.05] px-4 py-3 text-left last:border-b-0 transition hover:bg-white/[.025] disabled:cursor-not-allowed disabled:opacity-45 sm:px-5"
    >
      {icon ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-violet-300">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#E6E8EE]">{title}</span>
        {detail ? <span className="mt-0.5 block text-xs leading-relaxed text-[#989EAE]">{detail}</span> : null}
      </span>
      {trailing ?? (onClick ? <span className="text-[#565D6D]">›</span> : null)}
    </Wrapper>
  );
}

export function AccountInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[.06] bg-[#11141C] p-4">
      <p className="text-[8px] font-bold uppercase tracking-[.13em] text-[#5F6676]">{label}</p>
      <p className="mt-1.5 break-words text-[11px] font-semibold text-[#DDE0E7]">{value}</p>
    </div>
  );
}

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
  narrow?: boolean;
};

export default function AccountShell({ profile, title, description, onBack, onWorkspaceSwitch, children, workspace, narrow = false }: Props) {
  const role = String(profile.role || 'user');
  const roleLabel = workspace ? workspaceLabel(workspace).toUpperCase() : role === 'property_partner'
    ? 'PROPERTY PARTNER'
    : role === 'staff'
      ? 'TEAM'
    : role.replace(/_/g, ' ').toUpperCase();

  return (
    <div className="role-workspace min-h-[100dvh] bg-[var(--wh-bg)] pb-[calc(5.25rem+env(safe-area-inset-bottom))] text-[var(--wh-text)] sm:pb-10">
      <header className="sticky top-0 z-30 border-b border-[var(--wh-border)] bg-[var(--wh-bg)]">
        <div className={`mx-auto ${narrow ? "max-w-2xl" : "max-w-5xl"} px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-5 lg:px-8`}>
          <div className="flex items-start gap-3">
            {onBack && <BackButton onClick={onBack} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold uppercase tracking-[.22em] wh-accent-text">WEHOUSE · {roleLabel}</p>
              <h1 className="mt-1 truncate text-lg font-semibold">{title}</h1>
              {description ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--wh-text-secondary)]">{description}</p> : null}
            </div>
            {onWorkspaceSwitch ? (
              <button
                type="button"
                onClick={onWorkspaceSwitch}
                className="min-h-11 shrink-0 px-1 text-xs font-semibold wh-accent-text"
              >
                Workspaces
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main key={title} className={`wh-panel-enter mx-auto ${narrow ? "max-w-2xl" : "max-w-5xl"} space-y-4 px-4 py-5 sm:px-5 lg:px-8 lg:py-7`}>
        {children}
      </main>
    </div>
  );
}

export function AccountSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title ? <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[.16em] text-[var(--wh-text-secondary)]">{title}</p> : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)]">{children}</div>
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
      className="wh-interactive flex min-h-[4.25rem] w-full items-center gap-3 border-b border-[var(--wh-border)] px-4 py-3 text-left last:border-b-0 transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-45 sm:px-5"
    >
      {icon ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wh-accent-surface)] wh-accent-text">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--wh-text)]">{title}</span>
        {detail ? <span className="mt-0.5 block text-[13px] leading-5 text-[var(--wh-text-secondary)]">{detail}</span> : null}
      </span>
      {trailing ?? (onClick ? <span aria-hidden="true" className="text-[var(--wh-text-muted)]">›</span> : null)}
    </Wrapper>
  );
}

export function AccountInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4">
      <p className="text-xs font-bold uppercase tracking-[.13em] text-[var(--wh-text-secondary)]">{label}</p>
      <p className="mt-1.5 break-words text-sm font-semibold text-[var(--wh-text)]">{value}</p>
    </div>
  );
}

import type { Profile } from '@/types';
import BackButton from '@/components/BackButton';

type Props = {
  profile: Profile;
  title: string;
  description?: string;
  onBack?: () => void;
  children: React.ReactNode;
};

export default function AccountShell({ profile, title, description, onBack, children }: Props) {
  const role = String(profile.role || 'user');
  const roleLabel = role === 'property_partner'
    ? 'PROPERTY PARTNER'
    : role.replace(/_/g, ' ').toUpperCase();

  return (
    <div className="role-workspace min-h-[100dvh] bg-[#0A0A0F] pb-[calc(5.25rem+env(safe-area-inset-bottom))] text-white sm:pb-10">
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0A0A0F]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-5 lg:px-8">
          <div className="flex items-start gap-3">
            {onBack && <BackButton onClick={onBack} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] font-bold uppercase tracking-[.22em] text-violet-400">WEHOUSE · {roleLabel}</p>
              <h1 className="mt-1 truncate text-xl font-bold">{title}</h1>
              {description ? <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#74798B]">{description}</p> : null}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 lg:px-8 lg:py-7">
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
  icon,
  trailing,
}: {
  title: string;
  detail?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="flex min-h-[4.25rem] w-full items-center gap-3 border-b border-white/[.05] px-4 py-3.5 text-left last:border-b-0 transition hover:bg-white/[.025] sm:px-5"
    >
      {icon ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/[.08] text-violet-300">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-[#E6E8EE]">{title}</span>
        {detail ? <span className="mt-0.5 block text-[9px] leading-relaxed text-[#6F7585]">{detail}</span> : null}
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

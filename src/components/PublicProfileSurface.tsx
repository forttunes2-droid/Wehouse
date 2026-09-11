import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BackButton from "@/components/BackButton";
import MediaViewer from "@/components/MediaViewer";

type Props = {
  name: string;
  username?: string | null;
  avatar?: string | null;
  subtitle?: string | null;
  location?: string | null;
  presence?: string | null;
  about?: string | null;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  bottomAction?: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  maxWidth?: "xl" | "4xl";
};

export default function PublicProfileSurface({
  name,
  username,
  avatar,
  subtitle,
  location,
  presence,
  about,
  badges,
  actions,
  children,
  bottomAction,
  onClose,
  ariaLabel,
  maxWidth = "xl",
}: Props) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const width = maxWidth === "4xl" ? "max-w-4xl" : "max-w-xl";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", { detail: { open: true } }),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-[100100] isolate overflow-y-auto bg-[#090B10] text-white ${bottomAction ? "pb-24" : "pb-8"}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || `${name} profile`}
    >
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#090B10]/95 px-3 py-2.5 backdrop-blur-xl">
        <div className={`mx-auto flex ${width} items-center gap-2.5`}>
          <BackButton onClick={onClose} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            {[presence, subtitle].filter(Boolean).length ? (
              <p className="mt-0.5 truncate text-[9px] text-[#777D8D]">
                {[presence, subtitle].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className={`mx-auto ${width} px-5 pb-10 pt-6`}>
        <section className="relative overflow-hidden border-b border-white/[.07] pb-6">
          <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-violet-600/10 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <button
              type="button"
              disabled={!avatar}
              onClick={() => avatar && setAvatarOpen(true)}
              aria-label={avatar ? `Preview ${name}'s profile photo` : "No profile photo"}
              className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[28px] border border-white/[.09] bg-violet-500/15 text-3xl font-bold text-violet-100 disabled:cursor-default"
            >
              {avatar ? (
                <img src={avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                name[0]?.toUpperCase() || "W"
              )}
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-bold">{name}</h1>
              {username ? (
                <p className="mt-1 truncate text-[10px] text-[#767C8C]">
                  @{username.replace(/^@/, "")}
                </p>
              ) : null}
              {subtitle ? <p className="mt-2 text-xs text-[#A5ABB8]">{subtitle}</p> : null}
              {location ? <p className="mt-1 text-[10px] leading-5 text-[#7D8494]">{location}</p> : null}
              {badges ? <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div> : null}
            </div>
          </div>
          <div className="relative mt-5 border-t border-white/[.06] pt-4">
            <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#6F7585]">About</p>
            <p className="mt-2 whitespace-pre-line text-[12px] leading-6 text-[#A9AEBA]">
              {about || "No introduction added yet."}
            </p>
          </div>
          {actions ? <div className="relative mt-4 flex gap-5 border-t border-white/[.06] pt-4">{actions}</div> : null}
        </section>
        {children ? <div className="space-y-5">{children}</div> : null}
      </main>

      {bottomAction ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.08] bg-[#090B10]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className={`mx-auto ${width}`}>{bottomAction}</div>
        </div>
      ) : null}

      {avatarOpen && avatar ? (
        <MediaViewer
          src={avatar}
          kind="image"
          title={name}
          subtitle={subtitle || undefined}
          avatarUrl={avatar}
          onClose={() => setAvatarOpen(false)}
        />
      ) : null}
    </div>,
    document.body,
  );
}

export function PublicProfileAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-14 flex-col items-center gap-2 text-[10px] font-medium text-[#B9BDC8]"
    >
      <span className="grid h-14 w-14 place-items-center rounded-full border border-white/[.06] bg-white/[.055] text-[#D8DAE1]">
        {children}
      </span>
      {label}
    </button>
  );
}

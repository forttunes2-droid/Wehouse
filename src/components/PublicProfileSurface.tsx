import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BackButton from "@/components/BackButton";
import { isolateDialog, isTopDialog } from "@/lib/dialogIsolation";
import MediaViewer from "@/components/MediaViewer";
import { bindProfileScreenHistory, isTopProfileScreen } from "@/lib/profileScreenHistory";

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
  conversation?: boolean;
  suspended?: boolean;
};


export default function PublicProfileSurface({
  name, username, avatar, subtitle, location, presence, about, badges, actions,
  children, bottomAction, onClose, ariaLabel, maxWidth = "xl", conversation = false, suspended = false,
}: Props) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const width = maxWidth === "4xl" ? "max-w-4xl" : "max-w-xl";
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const returnFocus = useRef<HTMLElement | null>(null);
  const controller = useRef<ReturnType<typeof bindProfileScreenHistory> | null>(null);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const dismiss = useCallback(() => controller.current?.dismiss(), []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const release = isolateDialog(element);
    // StrictMode replays this effect after the dialog has already taken focus.
    // Capture the real opener once, not the dialog from the second effect run.
    if (!returnFocus.current && document.activeElement instanceof HTMLElement) {
      returnFocus.current = document.activeElement;
    }
    window.dispatchEvent(new CustomEvent("wehouse:nested-screen", { detail: { open: true } }));
    const history = bindProfileScreenHistory(window, id, () => close.current());
    controller.current = history;
    const keydown = (event: KeyboardEvent) => {
      if (!isTopProfileScreen(id) || !isTopDialog(element)) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); history.dismiss(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(root.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ) || []).filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); root.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
        event.preventDefault(); first.focus();
      }
    };
    element.addEventListener("keydown", keydown);
    element?.focus({ preventScroll: true });
    return () => {
      history.dispose();
      if (controller.current === history) controller.current = null;
      element?.removeEventListener("keydown", keydown);
      release();
      window.dispatchEvent(new CustomEvent("wehouse:nested-screen", { detail: { open: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')) } }));
      queueMicrotask(() => {
        const opener = returnFocus.current;
        if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
      });
    };
  }, [id]);

  useEffect(() => { if (root.current) root.current.inert = suspended; }, [suspended]);

  return createPortal(
    <div ref={root} tabIndex={-1}
      className={`fixed inset-0 z-[100100] isolate overflow-y-auto bg-[#090B10] text-white outline-none ${bottomAction ? "pb-24" : "pb-8"}`}
      role="dialog" aria-modal={suspended ? undefined : true} aria-hidden={suspended || undefined}
      aria-label={ariaLabel || `${name} profile`}>
      {/* Navigation and identity share one masthead. The name is not repeated in a detached bar. */}
      <header className={`mx-auto ${width} px-5 pb-5 pt-[max(.75rem,env(safe-area-inset-top))]`}>
        <div className="mb-4 flex min-h-11 items-center gap-2.5">
          <BackButton onClick={dismiss} ariaLabel={conversation ? "Back to conversation" : "Back"} />
          <p className="text-xs font-medium text-[#9298A7]">{conversation ? "Conversation info" : "Profile"}</p>
        </div>
        <div className={`flex items-center ${conversation ? "flex-col gap-3 text-center" : "gap-4"}`}>
          <button type="button" disabled={!avatar} onClick={() => avatar && setAvatarOpen(true)}
            aria-label={avatar ? `Preview ${name}'s profile photo` : "No profile photo"}
            className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-white/[.09] bg-violet-500/15 text-3xl font-bold text-violet-100 disabled:cursor-default">
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : name[0]?.toUpperCase() || "W"}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold">{name}</h1>
            {username ? <p className="mt-1 break-words text-xs text-[#858C9C]">@{username.replace(/^@/, "")}</p> : null}
            {subtitle ? <p className="mt-2 text-xs text-[#A5ABB8]">{subtitle}</p> : null}
            {presence ? <p className="mt-1 text-xs text-[#A5ABB8]">{presence}</p> : null}
            {location ? <p className="mt-1 text-xs leading-5 text-[#858C9C]">{location}</p> : null}
            {badges ? <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div> : null}
          </div>
        </div>
        {actions ? <div className="mt-5 flex justify-center gap-5">{actions}</div> : null}
      </header>
      <main className={`mx-auto ${width} px-5 pb-8`}>
        {about ? <section className="border-t border-white/[.07] py-5">
          <h2 className="text-xs font-bold uppercase tracking-[.14em] text-[#858C9C]">About</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#B5BAC6]">{about}</p>
        </section> : null}
        {children ? <div className="space-y-5">{children}</div> : null}
      </main>
      {bottomAction ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.08] bg-[#090B10]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className={`mx-auto ${width}`}>{bottomAction}</div>
      </div> : null}
      {avatarOpen && avatar ? <ProfilePhoto src={avatar} name={name} subtitle={subtitle} onClose={() => setAvatarOpen(false)} /> : null}
    </div>, document.body,
  );
}

function ProfilePhoto({ src, name, subtitle, onClose }: {
  src: string; name: string; subtitle?: string | null; onClose: () => void;
}) {
  const id = useId();
  const close = useRef(onClose);
  const controller = useRef<ReturnType<typeof bindProfileScreenHistory> | null>(null);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const history = bindProfileScreenHistory(window, id, () => close.current());
    controller.current = history;
    return () => { history.dispose(); controller.current = null; };
  }, [id]);
  return <MediaViewer src={src} kind="image" title={name} subtitle={subtitle || undefined} avatarUrl={src}
    onClose={() => controller.current?.dismiss()} />;
}

export function PublicProfileAction({ label, onClick, children }: {
  label: string; onClick: () => void; children: ReactNode;
}) {
  return <button type="button" onClick={onClick} className="flex min-w-14 flex-col items-center gap-2 text-xs font-medium text-[#B9BDC8]">
    <span className="grid h-11 w-11 place-items-center rounded-full border border-white/[.06] bg-white/[.055] text-[#D8DAE1]">{children}</span>
    {label}
  </button>;
}

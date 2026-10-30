import { createPortal } from 'react-dom';
import { useDialogInteraction } from '@/hooks/useDialogInteraction';
import { WorkspaceIcon } from "@/components/WorkspaceMark";
import { workspaceLabel } from "@/lib/workspacePresentation";
import type { WorkspaceAccess, WorkspaceChoice } from "@/pages/AccountCenter";

export default function WorkspaceSwitchSheet({
  open,
  access,
  active,
  onClose,
  onSwitch,
  identityName,
  identityAvatar,
}: {
  open: boolean;
  access?: WorkspaceAccess | null;
  active?: WorkspaceChoice;
  onClose: () => void;
  onSwitch: (workspace: WorkspaceChoice) => void;
  identityName?: string | null;
  identityAvatar?: string | null;
}) {
  const dialog = useDialogInteraction(onClose,open);
  if (!open) return null;

  const allowed: WorkspaceChoice[] = [];
  if (access?.personal_workspace) allowed.push("personal");
  for (const workspace of access?.privileged_workspaces || []) {
    if (!allowed.includes(workspace.role)) allowed.push(workspace.role);
  }

  return createPortal(
    <div
      ref={dialog}
      className="fixed inset-0 z-[100060] flex items-end bg-black/75 backdrop-blur-[3px] sm:items-center sm:justify-center sm:p-5"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="wh-panel-enter w-full rounded-t-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-w-md sm:rounded-[24px] sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Switch workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--wh-border)] sm:hidden" />
        <div className="flex items-start justify-between gap-3 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--wh-border-subtle)] bg-violet-500/[.10] text-sm font-bold text-[var(--wh-accent-text)]">
              {identityAvatar ? (
                <img src={identityAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{String(identityName || "W").trim().charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--wh-accent-text)]">
                WEHOUSE
              </p>
              <h2 className="mt-1 truncate text-base font-semibold">{identityName || "Your workspaces"}</h2>
              <p className="mt-1 max-w-xs text-xs leading-5 text-[var(--wh-text-muted)]">
                Choose a workspace. Your account stays the same.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"
            aria-label="Close workspace switcher"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          {allowed.map((workspace) => {
            const current = workspace === active;
            const granted = (access?.privileged_workspaces || []).find(
              (item) => item.role === workspace,
            );
            const detail =
              workspace === "personal"
                ? "Explore, Bookings, Inbox and your personal Account"
                : granted?.lga
                  ? `${granted.lga}${granted.state ? `, ${granted.state}` : ""} · One LGA`
                  : granted?.state
                    ? `${granted.state} · Whole State`
                    : workspace === "worker"
                      ? "Your services, Experiences, bookings and earnings"
                      : workspace === "property_partner"
                        ? "Properties, guests, earnings and partner work"
                        : workspace === "hosting"
                          ? "Assigned homes, guest operations and co-host work"
                          : workspace === "hotel"
                          ? "Your assigned hotel operations"
                          : "Your assigned WeHouse work";

            return (
              <button
                key={workspace}
                type="button"
                disabled={current}
                onClick={() => {
                  onClose();
                  onSwitch(workspace);
                }}
                className={`flex min-h-[68px] w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-[background-color,border-color,transform] duration-200 ease-out active:scale-[.99] ${current
                  ? "border-violet-500/30 bg-violet-500/[.09]"
                  : "border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] active:bg-[var(--wh-interactive)]"
                } disabled:cursor-default`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[14px] ${current
                  ? "bg-violet-500/16 text-[var(--wh-accent-text)]"
                  : "bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"
                }`}>
                  <WorkspaceIcon workspace={workspace} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <strong className="truncate text-sm text-[var(--wh-text)]">
                      {workspaceLabel(workspace)}
                    </strong>
                    {current ? (
                      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-[var(--wh-accent-text)]">
                        CURRENT
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs leading-4 text-[var(--wh-text-muted)]">
                    {detail}
                  </span>
                </span>
                {!current ? <span className="text-lg text-[var(--wh-text-muted)]">›</span> : null}
              </button>
            );
          })}
        </div>

      </section>
    </div>,document.body
  );
}

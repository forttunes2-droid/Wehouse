import {
  BriefcaseBusiness,
  Building2,
  Crown,
  Hotel,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { workspaceLabel } from "@/lib/workspacePresentation";
import type { WorkspaceAccess, WorkspaceChoice } from "@/pages/AccountCenter";

function WorkspaceIcon({ workspace }: { workspace: WorkspaceChoice }) {
  const common = { size: 18, strokeWidth: 1.8 };
  if (workspace === "personal") return <UserRound {...common} />;
  if (workspace === "worker") return <Wrench {...common} />;
  if (workspace === "property_partner" || workspace === "hosting") return <Building2 {...common} />;
  if (workspace === "hotel") return <Hotel {...common} />;
  if (workspace === "creator") return <Crown {...common} />;
  if (workspace === "admin") return <ShieldCheck {...common} />;
  return <BriefcaseBusiness {...common} />;
}

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
  if (!open) return null;

  const allowed: WorkspaceChoice[] = [];
  if (access?.personal_workspace) allowed.push("personal");
  for (const workspace of access?.privileged_workspaces || []) {
    if (!allowed.includes(workspace.role)) allowed.push(workspace.role);
  }

  return (
    <div
      className="fixed inset-0 z-[100060] flex items-end bg-black/75 backdrop-blur-[3px] sm:items-center sm:justify-center sm:p-5"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="wh-panel-enter w-full rounded-t-[28px] border border-white/[.08] bg-[#0F1219] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-w-md sm:rounded-[24px] sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Switch workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
        <div className="flex items-start justify-between gap-3 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-white/[.08] bg-violet-500/[.10] text-sm font-bold text-violet-200">
              {identityAvatar ? (
                <img src={identityAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{String(identityName || "W").trim().charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
                WEHOUSE
              </p>
              <h2 className="mt-1 truncate text-base font-semibold">{identityName || "Your workspaces"}</h2>
              <p className="mt-1 max-w-xs text-[10px] leading-5 text-[#777E8E]">
                One identity. Switch context deliberately; your profile and permissions stay unchanged.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[.045] text-[#9399A7]"
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
                      ? "Your services, jobs and professional profile"
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
                  : "border-white/[.06] bg-white/[.018] active:bg-white/[.05]"
                } disabled:cursor-default`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[14px] ${current
                  ? "bg-violet-500/16 text-violet-200"
                  : "bg-white/[.045] text-[#9AA0AE]"
                }`}>
                  <WorkspaceIcon workspace={workspace} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <strong className="truncate text-[12px] text-[#EAEBF0]">
                      {workspaceLabel(workspace)}
                    </strong>
                    {current ? (
                      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[8px] font-semibold text-violet-200">
                        CURRENT
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-[9px] leading-4 text-[#747B8B]">
                    {detail}
                  </span>
                </span>
                {!current ? <span className="text-lg text-[#596071]">›</span> : null}
              </button>
            );
          })}
        </div>

        <p className="px-1 pt-4 text-[9px] leading-4 text-[#626979]">
          Switching workspace changes what you are working on. It does not promote your account, widen coverage or combine Personal and work records.
        </p>
      </section>
    </div>
  );
}

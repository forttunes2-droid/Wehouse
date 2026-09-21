import { workspaceLabel } from "@/lib/workspacePresentation";
import type { WorkspaceAccess, WorkspaceChoice } from "@/pages/AccountCenter";

export default function WorkspaceSwitchSheet({
  open,
  access,
  active,
  onClose,
  onSwitch,
}: {
  open: boolean;
  access?: WorkspaceAccess | null;
  active?: WorkspaceChoice;
  onClose: () => void;
  onSwitch: (workspace: WorkspaceChoice) => void;
}) {
  if (!open) return null;

  const allowed: WorkspaceChoice[] = [];
  if (access?.personal_workspace) allowed.push("personal");
  for (const workspace of access?.privileged_workspaces || []) {
    if (!allowed.includes(workspace.role)) allowed.push(workspace.role);
  }

  return (
    <div
      className="fixed inset-0 z-[100060] flex items-end bg-black/70 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-5"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="w-full rounded-t-[26px] border border-white/[.08] bg-[#11131A] p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-[22px] sm:pb-3"
        role="dialog"
        aria-modal="true"
        aria-label="Switch workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">
              WEHOUSE
            </p>
            <h2 className="mt-0.5 text-sm font-semibold">Switch workspace</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/[.045] text-[#8B91A0]"
            aria-label="Close workspace switcher"
          >
            ×
          </button>
        </div>

        <div className="divide-y divide-white/[.055]">
          {allowed.map((workspace) => {
            const current = workspace === active;
            const granted = (access?.privileged_workspaces || []).find(
              (item) => item.role === workspace,
            );
            const detail =
              workspace === "personal"
                ? "Explore, bookings, Inbox and Account"
                : granted?.lga
                  ? \`\${granted.lga}\${granted.state ? \`, \${granted.state}\` : ""}\`
                  : workspace === "worker"
                    ? "Your services and Worker activity"
                    : workspace === "property_partner"
                      ? "Your properties and partner activity"
                      : "Your assigned WeHouse access";
            return (
              <button
                key={workspace}
                type="button"
                disabled={current}
                onClick={() => {
                  onClose();
                  onSwitch(workspace);
                }}
                className="flex min-h-14 w-full items-center gap-3 px-1 py-2.5 text-left disabled:cursor-default"
              >
                <span className={\`grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-[11px] font-bold \${
                  current
                    ? "border-violet-500/30 bg-violet-500/15 text-violet-200"
                    : "border-white/[.06] bg-white/[.025] text-[#858C9B]"
                }\`}>
                  {workspaceLabel(workspace).slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-[#E4E7ED]">
                    {workspaceLabel(workspace)}
                  </span>
                  <span className="mt-0.5 block truncate text-[9px] text-[#686F7F]">
                    {detail}
                  </span>
                </span>
                <span className={current ? "text-[9px] font-semibold text-violet-300" : "text-[#555C6D]"}>
                  {current ? "Current" : "›"}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

type SecurityCase = {
  operational_case_id: string;
  case_number: number;
  reason_code: string;
  reason_label?: string;
  subject_type: string;
  subject_id: string;
  subject_name?: string;
  target_user_id?: string | null;
  status: string;
  priority: string;
  assigned_name?: string | null;
  service_level_due_at?: string | null;
  last_note?: string | null;
  updated_at: string;
};

type Decision = "suspend" | "no_action";

export default function AdminSecurityCases({
  onViewAccount,
  initialCaseId,
}: {
  onViewAccount?: (profile: Profile) => void;
  initialCaseId?: string;
}) {
  const [rows, setRows] = useState<SecurityCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(initialCaseId || null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: requestError } = await supabase.rpc("get_my_admin_security_cases");
    const payload = (data || {}) as { cases?: SecurityCase[] };
    setRows(payload.cases || []);
    setError(requestError?.message || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (initialCaseId) setExpanded(initialCaseId);
  }, [initialCaseId]);

  const openRows = useMemo(
    () => rows.filter((row) => !["resolved", "closed"].includes(row.status)),
    [rows],
  );
  const decisionReady = openRows.filter((row) => row.status === "decision_ready").length;

  async function viewAccount(row: SecurityCase) {
    if (!row.target_user_id || !onViewAccount) return;
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", row.target_user_id)
      .maybeSingle();
    if (profileError || !data)
      return toast.error(profileError?.message || "Account could not be loaded");
    onViewAccount(data as Profile);
  }

  async function confirmDecision(row: SecurityCase) {
    if (!decision || !note.trim()) return;
    if (decision === "suspend" && !row.target_user_id)
      return toast.error("This security case is not attached to an account");

    setActing(true);
    const { error: actionError } = await supabase.rpc("admin_security_case_decision", {
      p_case_id: row.operational_case_id,
      p_decision: decision,
      p_note: note.trim(),
    });
    setActing(false);
    if (actionError) return toast.error(actionError.message);
    toast.success(
      decision === "suspend"
        ? "Account suspended and security case resolved"
        : "Security case resolved without an account restriction",
    );
    setDecision(null);
    setNote("");
    setExpanded(null);
    await load();
  }

  return (
    <div className="space-y-5">
      <section className="border-b border-white/[.07] pb-4">
        <p className="text-[9px] font-bold uppercase tracking-[.16em] text-red-300">
          Security decisions
        </p>
        <h2 className="mt-2 text-xl font-bold">Security Operations escalations</h2>
        <p className="mt-2 max-w-2xl text-[10px] leading-5 text-[#777E8F]">
          Security Operations investigates and records the case. Admin can
          review the account, temporarily restrict access when necessary, or resolve
          the case without an account restriction. Every decision requires a reason.
        </p>
        {decisionReady > 0 ? (
          <span className="mt-3 inline-flex rounded-full bg-red-500/10 px-2.5 py-1 text-[9px] font-semibold text-red-300">
            {decisionReady} waiting for Admin decision
          </span>
        ) : null}
      </section>

      {loading ? (
        <Empty text="Loading security cases…" />
      ) : error ? (
        <Empty text={`Security cases could not load: ${error}`} />
      ) : openRows.length === 0 ? (
        <Empty text="No open Security Operations cases need Admin attention." />
      ) : (
        <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
          {openRows.map((row) => {
            const isExpanded = expanded === row.operational_case_id;
            const waiting = row.status === "decision_ready";
            return (
              <article key={row.operational_case_id} className="py-4">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(isExpanded ? null : row.operational_case_id);
                    setDecision(null);
                    setNote("");
                  }}
                  className="flex w-full items-start gap-3 text-left"
                >
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[9px] font-bold ${waiting ? "bg-red-500/10 text-red-300" : "bg-white/[.04] text-[#868D9E]"}`}>
                    #{row.case_number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {row.reason_label || row.reason_code}
                    </span>
                    <span className="mt-1 block truncate text-[9px] text-[#707788]">
                      {row.subject_name || row.subject_id} · {statusText(row.status)}
                    </span>
                    {row.last_note ? (
                      <span className="mt-2 block line-clamp-2 text-[9px] leading-4 text-[#606777]">
                        {row.last_note}
                      </span>
                    ) : null}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold uppercase ${waiting ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}>
                    {waiting ? "Decision needed" : statusText(row.priority)}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="mt-4 rounded-2xl border border-white/[.06] bg-white/[.018] p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Fact label="Subject" value={statusText(row.subject_type)} />
                      <Fact label="Priority" value={statusText(row.priority)} />
                      <Fact label="Investigator" value={row.assigned_name || "Unassigned"} />
                      <Fact
                        label="SLA"
                        value={row.service_level_due_at ? shortTime(row.service_level_due_at) : "Not set"}
                      />
                    </div>

                    {row.target_user_id && onViewAccount ? (
                      <button
                        type="button"
                        onClick={() => void viewAccount(row)}
                        className="mt-3 text-[9px] font-semibold text-violet-300"
                      >
                        View account record ›
                      </button>
                    ) : null}

                    {waiting ? (
                      <>
                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <DecisionButton
                            active={decision === "no_action"}
                            label="Resolve without restriction"
                            note="Close the security case without changing account access"
                            onClick={() => setDecision("no_action")}
                          />
                          {row.target_user_id ? (
                            <DecisionButton
                              active={decision === "suspend"}
                              label="Temporarily suspend account"
                              note="Restrict access until an Admin later reactivates the account"
                              onClick={() => setDecision("suspend")}
                            />
                          ) : null}
                        </div>

                        {decision ? (
                          <div className="mt-3 rounded-2xl border border-white/[.07] bg-[#0B0E14] p-3">
                            <p className="text-[9px] font-semibold">
                              {decision === "suspend"
                                ? "Confirm temporary account suspension"
                                : "Confirm no-restriction resolution"}
                            </p>
                            <textarea
                              value={note}
                              onChange={(event) => setNote(event.target.value)}
                              placeholder="Required decision reason…"
                              className="mt-2 min-h-24 w-full resize-none rounded-xl border border-white/[.08] bg-[#080B10] px-3 py-2 text-[10px] outline-none placeholder:text-[#555C6C] focus:border-violet-400/40"
                            />
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => {
                                  setDecision(null);
                                  setNote("");
                                }}
                                className="h-10 rounded-xl border border-white/[.08] text-[9px] font-semibold disabled:opacity-40"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={acting || !note.trim()}
                                onClick={() => void confirmDecision(row)}
                                className={`h-10 rounded-xl text-[9px] font-semibold text-white disabled:opacity-40 ${decision === "suspend" ? "bg-amber-500" : "bg-violet-500"}`}
                              >
                                {acting ? "Saving decision…" : "Confirm decision"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-4 rounded-xl border border-white/[.06] p-3 text-[9px] leading-4 text-[#777E8F]">
                        Security Operations is still investigating this case. Account
                        controls appear after it is escalated for an Admin decision.
                      </p>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DecisionButton({
  active,
  label,
  note,
  onClick,
}: {
  active: boolean;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-3 text-left ${active ? "border-violet-400/40 bg-violet-500/[.08]" : "border-white/[.07] bg-white/[.02]"}`}
    >
      <span className="block text-[10px] font-semibold text-white">{label}</span>
      <span className="mt-1 block text-[8px] leading-4 text-[#666D7E]">{note}</span>
    </button>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[.025] p-3">
      <p className="text-[8px] uppercase text-[#62697A]">{label}</p>
      <p className="mt-1 truncate text-[9px] font-semibold capitalize">{value}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666D7E]">
      {text}
    </div>
  );
}
function statusText(value: string) {
  return String(value || "").replace(/_/g, " ");
}
function shortTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not set"
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";
import {withTimeout} from '@/lib/withTimeout';

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
  const generation=useRef(0),actionBusy=useRef(false);

  const load = useCallback(async () => {
    const current=++generation.current;
    setLoading(true);
    setError('');setDecision(null);setNote('');
    try{
    const { data, error: requestError } = await withTimeout(supabase.rpc("get_my_admin_security_cases"),15000,'Security cases took too long.');
    const payload = (data || {}) as { cases?: SecurityCase[] };
    if(requestError||!Array.isArray(payload.cases)||payload.cases.some(c=>typeof c.operational_case_id!=='string'||typeof c.status!=='string'||typeof c.updated_at!=='string'))throw Error('Security cases could not be confirmed');
    if(current!==generation.current)return;
    setRows(payload.cases || []);
    }catch{if(current===generation.current){setRows([]);setError('Security cases could not be loaded. Refresh to confirm the current queue.');}}
    finally{if(current===generation.current)setLoading(false);}
  }, []);

  useEffect(() => {
    void load();
    return()=>{generation.current++;};
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
    try{const { data, error: profileError } = await withTimeout(supabase
      .from("profiles")
      .select("*")
      .eq("user_id", row.target_user_id)
      .maybeSingle(),15000,'Account record took too long.');
    if (profileError || !data)
      return toast.error(profileError?.message || "Account could not be loaded");
    onViewAccount(data as Profile);
    }catch{toast.error('Account record could not be loaded. Try again.');}
  }

  async function confirmDecision(row: SecurityCase) {
    if (!decision || !note.trim() || actionBusy.current) return;
    if (decision === "suspend" && !row.target_user_id)
      return toast.error("This security case is not attached to an account");

    const chosen=decision,current=generation.current;actionBusy.current=true;setActing(true);
    try{
    const { data,error: actionError } = await withTimeout(supabase.rpc("admin_security_case_decision_v2", {
      p_case_id: row.operational_case_id,
      p_decision: chosen,
      p_note: note.trim(),
      p_expected_updated_at:row.updated_at,
    }),20000,'Decision result is unknown. Refresh the case before retrying.');
    if(actionError||data?.success!==true||data.case_id!==row.operational_case_id||data.decision!==chosen||data.status!=='resolved')throw Error('Decision could not be confirmed');
    if(current!==generation.current)return;
    toast.success(
      chosen === "suspend"
        ? "Account suspended and security case resolved"
        : "Security case resolved without an account restriction",
    );
    setDecision(null);
    setNote("");
    setExpanded(null);
    await load();
    }catch{if(current===generation.current)setError('The decision could not be confirmed. Refresh cases and check the saved status before retrying.');}
    finally{actionBusy.current=false;setActing(false);}
  }

  return (
    <div className="space-y-5">
      <section className="border-b border-[var(--wh-border-subtle)] pb-4">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-red-700 dark:text-red-300">
          Security decisions
        </p>
        <h2 className="mt-2 text-xl font-bold">Security Operations escalations</h2>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--wh-text-muted)]">
          Security Operations investigates and records the case. Admin can
          review the account, temporarily restrict access when necessary, or resolve
          the case without an account restriction. Every decision requires a reason.
        </p>
        {decisionReady > 0 ? (
          <span className="mt-3 inline-flex rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300">
            {decisionReady} waiting for Admin decision
          </span>
        ) : null}
      </section>

      {loading ? (
        <Empty text="Loading security cases…" />
      ) : error ? (
        <div role="alert"><Empty text={error}/><button type="button" disabled={acting} onClick={()=>void load()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold">Refresh security cases</button></div>
      ) : openRows.length === 0 ? (
        <Empty text="No open Security Operations cases need Admin attention." />
      ) : (
        <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
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
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-bold ${waiting ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"}`}>
                    #{row.case_number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {row.reason_label || row.reason_code}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[var(--wh-text-muted)]">
                      {row.subject_name || row.subject_id} · {statusText(row.status)}
                    </span>
                    {row.last_note ? (
                      <span className="mt-2 block line-clamp-2 text-xs leading-4 text-[var(--wh-text-muted)]">
                        {row.last_note}
                      </span>
                    ) : null}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold uppercase ${waiting ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
                    {waiting ? "Decision needed" : statusText(row.priority)}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="mt-4 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-3">
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
                        className="mt-3 text-xs font-semibold text-violet-700 dark:text-violet-300"
                      >
                        View account record ›
                      </button>
                    ) : null}

                    {waiting ? (
                      <>
                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <DecisionButton
                            disabled={acting}
                            active={decision === "no_action"}
                            label="Resolve without restriction"
                            note="Close the security case without changing account access"
                            onClick={() => setDecision("no_action")}
                          />
                          {row.target_user_id ? (
                            <DecisionButton
                              disabled={acting}
                              active={decision === "suspend"}
                              label="Temporarily suspend account"
                              note="Restrict this person across WeHouse until an authorized account review restores access"
                              onClick={() => setDecision("suspend")}
                            />
                          ) : null}
                        </div>

                        {decision ? (
                          <div className="mt-3 rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3">
                            <p className="text-xs font-semibold">
                              {decision === "suspend"
                                ? "Confirm temporary account suspension"
                                : "Confirm no-restriction resolution"}
                            </p>
                            <textarea
                              maxLength={2000}
                              disabled={acting}
                              value={note}
                              onChange={(event) => setNote(event.target.value)}
                              placeholder="Required decision reason…"
                              className="mt-2 min-h-24 w-full resize-none rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] px-3 py-2 text-xs outline-none placeholder:text-[var(--wh-text-muted)] focus:border-violet-400/40"
                            />
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => {
                                  setDecision(null);
                                  setNote("");
                                }}
                                className="h-10 rounded-xl border border-[var(--wh-border-subtle)] text-xs font-semibold disabled:opacity-40"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={acting || !note.trim()}
                                onClick={() => void confirmDecision(row)}
                                className={`min-h-11 rounded-xl text-sm font-semibold disabled:opacity-40 ${decision === "suspend" ? "bg-amber-400 text-amber-950" : "bg-violet-600 text-white"}`}
                              >
                                {acting ? "Saving decision…" : "Confirm decision"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-4 rounded-xl border border-[var(--wh-border-subtle)] p-3 text-xs leading-4 text-[var(--wh-text-muted)]">
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
  disabled,
  active,
  label,
  note,
  onClick,
}: {
  disabled: boolean;
  active: boolean;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 disabled:opacity-50 rounded-2xl border p-3 text-left ${active ? "border-violet-400/40 bg-violet-500/[.08]" : "border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)]"}`}
    >
      <span className="block text-sm font-semibold text-[var(--wh-text)]">{label}</span>
      <span className="mt-1 block text-xs leading-4 text-[var(--wh-text-muted)]">{note}</span>
    </button>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--wh-interactive)] p-3">
      <p className="text-xs uppercase text-[var(--wh-text-muted)]">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold capitalize">{value}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--wh-border-subtle)] px-5 py-12 text-center text-xs text-[var(--wh-text-muted)]">
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

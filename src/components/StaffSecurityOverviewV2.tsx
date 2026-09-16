import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type SecurityAlert = {
  kind?: string;
  severity?: string;
  target_user_id?: string;
  title?: string;
  detail?: string;
};
type Monitor = {
  stats?: Record<string, number>;
  alerts?: SecurityAlert[];
  auth_audit_available?: boolean;
};
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
  assigned_user_id?: string | null;
  assigned_name?: string | null;
  service_level_due_at?: string | null;
  last_note?: string | null;
  last_event_at?: string | null;
  updated_at: string;
};

export default function StaffSecurityOverviewV2({
  onOpenCases,
}: {
  onOpenCases: () => void;
}) {
  const [data, setData] = useState<Monitor>({});
  const [cases, setCases] = useState<SecurityCase[]>([]);
  const [actorUserId, setActorUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [monitorResult, caseResult] = await Promise.all([
      supabase.rpc("get_my_staff_security_monitor"),
      supabase.rpc("get_my_staff_security_cases"),
    ]);
    const failure = monitorResult.error?.message || caseResult.error?.message || "";
    setData((monitorResult.data || {}) as Monitor);
    const casePayload = (caseResult.data || {}) as {
      actor_user_id?: string;
      cases?: SecurityCase[];
    };
    setActorUserId(String(casePayload.actor_user_id || ""));
    setCases(casePayload.cases || []);
    setError(failure);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => {
    let live = true;
    void load().then(() => {
      if (!live) return;
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function openSignal(alert: SecurityAlert) {
    if (!alert.target_user_id) return toast.error("This signal is missing its account reference");
    const key = `signal:${alert.kind || alert.target_user_id}`;
    setActing(key);
    const { data: caseId, error: requestError } = await supabase.rpc(
      "staff_security_open_signal_case",
      {
        p_target_user_id: alert.target_user_id,
        p_signal_type: alert.kind || "recorded_signal",
        p_summary: alert.detail || alert.title || "Recorded Security Operations signal",
      },
    );
    setActing("");
    if (requestError) return toast.error(requestError.message);
    toast.success("Security review opened");
    await load(true);
    if (caseId) setExpanded(String(caseId));
  }

  async function caseAction(
    row: SecurityCase,
    action: "claim" | "note" | "escalate" | "resolve",
  ) {
    const trimmed = note.trim();
    if (["note", "escalate", "resolve"].includes(action) && !trimmed) {
      return toast.error(
        action === "escalate"
          ? "Explain why Admin or Creator action is required"
          : "Add a short security review note",
      );
    }
    setActing(`${row.operational_case_id}:${action}`);
    const { error: actionError } = await supabase.rpc("staff_security_case_action", {
      p_case_id: row.operational_case_id,
      p_action: action,
      p_note: trimmed || null,
    });
    setActing("");
    if (actionError) return toast.error(actionError.message);
    setNote("");
    if (action === "escalate") toast.success("Escalated to Admin and Creator");
    else if (action === "resolve") toast.success("Security review resolved");
    else if (action === "claim") toast.success("Security case assigned to you");
    else toast.success("Internal note saved");
    await load(true);
  }

  const stats = data.stats || {};
  const alerts = data.alerts || [];
  const openCases = useMemo(
    () => cases.filter((row) => !["resolved", "closed"].includes(row.status)),
    [cases],
  );
  const recentClosed = useMemo(
    () => cases.filter((row) => ["resolved", "closed"].includes(row.status)).slice(0, 5),
    [cases],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-red-500/15 bg-gradient-to-br from-red-500/[.08] via-[#15131A] to-[#0D1118] p-5 sm:p-6 lg:p-8">
        <p className="text-[9px] font-bold uppercase tracking-[.18em] text-red-300">
          SECURITY OPERATIONS
        </p>
        <h2 className="mt-3 text-2xl font-bold">Investigate, record and escalate branch security issues.</h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#8990A1]">
          Security Operations can review signals, claim a case, keep internal notes,
          resolve a review or escalate it for an Admin/Creator decision. Security
          Operations cannot suspend or ban accounts.
        </p>
        <button
          onClick={onOpenCases}
          className="mt-5 rounded-xl border border-white/[.08] bg-white/[.04] px-4 py-3 text-xs font-semibold"
        >
          Open security trail
        </button>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Open cases" value={openCases.length} />
        <Metric label="Active sessions" value={stats.active_sessions || 0} />
        <Metric label="Multiple-location" value={stats.multi_ip_accounts || 0} />
        <Metric label="Login bursts" value={stats.login_bursts || 0} />
        <Metric label="Restricted accounts" value={stats.restricted_accounts || 0} />
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-base font-bold">Security case queue</h3>
          <p className="mt-1 text-[10px] text-[#666D7E]">
            One accountable case owns each investigation. Claim it before adding notes,
            escalating or resolving it.
          </p>
        </div>
        {loading ? (
          <Empty text="Loading Security Operations…" />
        ) : error && !openCases.length ? (
          <Empty text={`Security case queue could not load: ${error}`} />
        ) : openCases.length === 0 ? (
          <Empty text="No open Security Operations cases in this branch." />
        ) : (
          <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
            {openCases.map((row) => {
              const mine = row.assigned_user_id === actorUserId;
              const unassigned = !row.assigned_user_id;
              const isExpanded = expanded === row.operational_case_id;
              return (
                <article key={row.operational_case_id} className="py-4">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(isExpanded ? null : row.operational_case_id);
                      setNote("");
                    }}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[9px] font-bold ${row.priority === "urgent" || row.priority === "high" ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}>
                      #{row.case_number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {row.reason_label || row.reason_code}
                      </span>
                      <span className="mt-1 block truncate text-[9px] text-[#777E8F]">
                        {row.subject_name || row.subject_id} · {statusText(row.status)}
                      </span>
                      {row.last_note ? (
                        <span className="mt-2 block line-clamp-2 text-[9px] leading-4 text-[#646B7B]">
                          {row.last_note}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-[8px] font-semibold uppercase ${mine ? "text-emerald-300" : unassigned ? "text-violet-300" : "text-[#717888]"}`}>
                        {mine ? "Assigned to you" : unassigned ? "Unassigned" : row.assigned_name || "Assigned"}
                      </span>
                      <span className="mt-1 block text-[#62697A]">{isExpanded ? "⌃" : "⌄"}</span>
                    </span>
                  </button>

                  {isExpanded ? (
                    <div className="mt-4 rounded-2xl border border-white/[.06] bg-white/[.018] p-3">
                      <div className="grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-3">
                        <Fact label="Subject" value={statusText(row.subject_type)} />
                        <Fact label="Priority" value={statusText(row.priority)} />
                        <Fact
                          label="SLA"
                          value={row.service_level_due_at ? shortTime(row.service_level_due_at) : "Not set"}
                        />
                      </div>

                      {unassigned ? (
                        <button
                          type="button"
                          disabled={Boolean(acting)}
                          onClick={() => void caseAction(row, "claim")}
                          className="mt-3 h-10 w-full rounded-xl bg-violet-500 text-[9px] font-semibold disabled:opacity-40"
                        >
                          {acting ? "Working…" : "Claim investigation"}
                        </button>
                      ) : mine ? (
                        <>
                          <textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="Internal investigation note or decision context…"
                            className="mt-3 min-h-24 w-full resize-none rounded-xl border border-white/[.08] bg-[#0B0E14] px-3 py-2 text-[10px] outline-none placeholder:text-[#555C6C] focus:border-violet-400/40"
                          />
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <Action
                              label="Save note"
                              disabled={Boolean(acting) || !note.trim()}
                              onClick={() => void caseAction(row, "note")}
                            />
                            <Action
                              label="Escalate decision"
                              disabled={Boolean(acting) || !note.trim()}
                              onClick={() => void caseAction(row, "escalate")}
                              emphasis="danger"
                            />
                            <Action
                              label="Resolve review"
                              disabled={Boolean(acting) || !note.trim()}
                              onClick={() => void caseAction(row, "resolve")}
                              emphasis="good"
                            />
                          </div>
                          <p className="mt-3 text-[8px] leading-4 text-[#5F6676]">
                            Escalation sends the case to the branch Admin and Creator Inbox.
                            Only Admin/Creator authority can restrict the account.
                          </p>
                        </>
                      ) : (
                        <p className="mt-3 rounded-xl border border-white/[.06] p-3 text-[9px] leading-4 text-[#777E8F]">
                          This investigation is owned by {row.assigned_name || "another Security Operations member"}.
                        </p>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-base font-bold">Recorded signals</h3>
          <p className="mt-1 text-[10px] text-[#666D7E]">
            A signal is not a punishment. Open an investigation before any escalation.
          </p>
        </div>
        {loading ? (
          <Empty text="Loading recorded activity…" />
        ) : error ? (
          <Empty text={`Security data could not load: ${error}`} />
        ) : alerts.length === 0 ? (
          <Empty text="No current monitoring rule is triggered in this branch." />
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 8).map((item, index) => {
              const key = `signal:${item.kind || item.target_user_id}`;
              return (
                <article
                  key={`${item.kind}-${item.target_user_id || index}`}
                  className={`rounded-2xl border p-4 ${item.severity === "high" ? "border-red-500/20 bg-red-500/[.04]" : "border-amber-500/20 bg-amber-500/[.04]"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold">{item.title || "Activity signal"}</p>
                    <span className={`rounded-full px-2 py-1 text-[8px] font-semibold uppercase ${item.severity === "high" ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}>
                      {item.severity || "review"}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#818797]">{item.detail}</p>
                  {item.target_user_id ? (
                    <button
                      type="button"
                      disabled={Boolean(acting)}
                      onClick={() => void openSignal(item)}
                      className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.05] px-3 py-2 text-[9px] font-semibold text-red-200 disabled:opacity-40"
                    >
                      {acting === key ? "Opening…" : "Start security review"}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {recentClosed.length ? (
        <section>
          <h3 className="mb-3 text-sm font-bold">Recently resolved</h3>
          <div className="divide-y divide-white/[.055] border-y border-white/[.055]">
            {recentClosed.map((row) => (
              <div key={row.operational_case_id} className="flex items-center gap-3 py-3">
                <span className="text-[9px] font-semibold text-[#6D7485]">#{row.case_number}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-[#A3A8B5]">
                  {row.subject_name || row.subject_id}
                </span>
                <span className="text-[8px] uppercase text-emerald-300">{statusText(row.status)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!data.auth_audit_available ? (
        <p className="rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-[9px] leading-relaxed text-[#666D7E]">
          Detailed authentication events are not connected yet. WeHouse does not invent failed-login or password alerts when no source event exists.
        </p>
      ) : null}
    </div>
  );
}

function Action({
  label,
  disabled,
  onClick,
  emphasis = "neutral",
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  emphasis?: "neutral" | "danger" | "good";
}) {
  const className =
    emphasis === "danger"
      ? "border-red-500/20 bg-red-500/[.05] text-red-200"
      : emphasis === "good"
        ? "border-emerald-500/20 bg-emerald-500/[.05] text-emerald-200"
        : "border-white/[.08] bg-white/[.025] text-[#C1C5CF]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-10 rounded-xl border px-3 text-[9px] font-semibold disabled:opacity-40 ${className}`}
    >
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/[.06] bg-[#10141C] p-4">
      <p className="text-xl font-bold">{value}</p>
      <p className="mt-1 text-[9px] text-[#697080]">{label}</p>
    </div>
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
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-10 text-center text-[10px] text-[#666D7E]">
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
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";
import WeHouseLoadingState from "@/components/WeHouseLoadingState";

type Controls = { new_account_cooldown_hours: string; daily_max_count: string; daily_max_amount: string; require_recent_login_minutes: string };

const FIELDS: { key: keyof Controls; label: string; hint: string }[] = [
  { key: "new_account_cooldown_hours", label: "Hours before a new payout account can receive money", hint: "0 = no wait" },
  { key: "daily_max_count", label: "Withdrawals per wallet per day", hint: "0 = no limit" },
  { key: "daily_max_amount", label: "Total withdrawn per wallet per day (platform currency)", hint: "0 = no limit" },
  { key: "require_recent_login_minutes", label: "Minutes a sign-in stays fresh for withdrawing", hint: "Default 10. 0 = never ask the user to sign in again" },
];

export default function CreatorWithdrawalControls() {
  const { requestElevation } = useCreatorAuth();
  const [values, setValues] = useState<Controls | null>(null);
  const [saved, setSaved] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const { data, error: rpcError } = await supabase.rpc("creator_get_withdrawal_controls");
    if (rpcError || !data) return setError("Withdrawal controls could not be loaded.");
    const row = data as Record<string, number>;
    const next: Controls = {
      new_account_cooldown_hours: String(row.new_account_cooldown_hours ?? 0),
      daily_max_count: String(row.daily_max_count ?? 0),
      daily_max_amount: String(row.daily_max_amount ?? 0),
      require_recent_login_minutes: String(row.require_recent_login_minutes ?? 10),
    };
    setValues(next);
    setSaved(JSON.stringify(next));
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function publish(elevationId: string) {
    if (!values) return;
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("creator_publish_policy", {
      p_creator_elevation_id: elevationId,
      p_policy_key: "withdrawal_controls",
      p_scope_type: "global",
      p_scope_key: "*",
      p_value: {
        new_account_cooldown_hours: Number(values.new_account_cooldown_hours) || 0,
        daily_max_count: Number(values.daily_max_count) || 0,
        daily_max_amount: Number(values.daily_max_amount) || 0,
        require_recent_login_minutes: values.require_recent_login_minutes.trim() === "" ? 10 : Number(values.require_recent_login_minutes) || 0,
      },
      p_value_schema: { type: "withdrawal_controls" },
      p_effective_from: new Date().toISOString(),
      p_public_disclosure: false,
      p_disclosure_text: null,
      p_legal_review_state: "not_required",
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) return toast.error(rpcError.message);
    toast.success("Withdrawal controls updated");
    setReason("");
    await load();
  }

  if (error) return <p role="alert" className="text-sm text-[var(--wh-text-secondary)]">{error}</p>;
  if (!values) return <WeHouseLoadingState compact label="Loading" />;
  const dirty = JSON.stringify(values) !== saved;

  return (
    <section className="rounded-xl border border-[var(--wh-border-subtle)] p-4">
      <h3 className="text-sm font-semibold">Withdrawal safety</h3>
      <p className="mt-1 text-sm text-[var(--wh-text-secondary)]">
        Applies to Service Workers and Property Partners. Only one withdrawal can be open per wallet at any time, whatever you set here.
      </p>
      <div className="mt-3 space-y-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--wh-border-subtle)] p-3 text-sm">
            <span className="min-w-0 flex-1">
              {f.label} <span className="text-[var(--wh-text-muted)]">({f.hint})</span>
            </span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              className="min-h-11 w-32 rounded-lg border border-[var(--wh-border-subtle)] bg-transparent px-2"
            />
          </label>
        ))}
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for this change"
        className="mt-3 min-h-11 w-full rounded-lg border border-[var(--wh-border-subtle)] bg-transparent px-3 text-sm"
      />
      <button
        type="button"
        disabled={busy || !dirty || reason.trim().length < 5}
        onClick={() => requestElevation("policy_publish", (id) => void publish(id))}
        className="mt-3 min-h-11 rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save withdrawal controls"}
      </button>
    </section>
  );
}

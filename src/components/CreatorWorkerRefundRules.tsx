import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";
import WeHouseLoadingState from "@/components/WeHouseLoadingState";

type Controls = { before_start_refund_percent: string; review_max_refund_percent: string };

const FIELDS: { key: keyof Controls; label: string; hint: string }[] = [
  { key: "before_start_refund_percent", label: "Refund when the customer cancels before work starts (%)", hint: "100 = full refund" },
  { key: "review_max_refund_percent", label: "Most a WeHouse review can refund after work starts (%)", hint: "100 = up to everything paid" },
];

export default function CreatorWorkerRefundRules() {
  const { requestElevation } = useCreatorAuth();
  const [values, setValues] = useState<Controls | null>(null);
  const [saved, setSaved] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const { data, error: rpcError } = await supabase.rpc("creator_get_worker_refund_rules");
    if (rpcError || !data) return setError("Refund rules could not be loaded.");
    const row = data as Record<string, number>;
    const next: Controls = {
      before_start_refund_percent: String(row.before_start_refund_percent ?? 100),
      review_max_refund_percent: String(row.review_max_refund_percent ?? 100),
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
      p_policy_key: "worker_refund_rules",
      p_scope_type: "global",
      p_scope_key: "*",
      p_value: {
        before_start_refund_percent: Math.min(100, Math.max(0, Number(values.before_start_refund_percent) || 0)),
        review_max_refund_percent: Math.min(100, Math.max(0, Number(values.review_max_refund_percent) || 0)),
      },
      p_value_schema: { type: "worker_refund_rules" },
      p_effective_from: new Date().toISOString(),
      p_public_disclosure: false,
      p_disclosure_text: null,
      p_legal_review_state: "not_required",
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) return toast.error(rpcError.message);
    toast.success("Refund rules updated");
    setReason("");
    await load();
  }

  if (error) return <p role="alert" className="text-sm text-[var(--wh-text-secondary)]">{error}</p>;
  if (!values) return <WeHouseLoadingState compact label="Loading" />;
  const dirty = JSON.stringify(values) !== saved;

  return (
    <section className="rounded-xl border border-[var(--wh-border-subtle)] p-4">
      <h3 className="text-sm font-semibold">Service Worker refunds</h3>
      <p className="mt-1 text-sm text-[var(--wh-text-secondary)]">
        Refunds always follow the amount actually paid. After work starts, the money stays protected until WeHouse decides.
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
              max={100}
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
        {busy ? "Saving…" : "Save refund rules"}
      </button>
    </section>
  );
}

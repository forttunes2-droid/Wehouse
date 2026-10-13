import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";
import WeHouseLoadingState from "@/components/WeHouseLoadingState";

const PRODUCTS = [
  { key: "worker", label: "Service Worker" },
  { key: "hotel", label: "Hotel" },
  { key: "short_let", label: "Short Let" },
  { key: "long_let", label: "Long Let" },
] as const;

type FeeState = Record<string, { enabled: boolean; amount: string }>;

export default function CreatorFixedFees() {
  const { requestElevation } = useCreatorAuth();
  const [fees, setFees] = useState<FeeState | null>(null);
  const [saved, setSaved] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const { data, error: rpcError } = await supabase.rpc("creator_get_fixed_fees");
    if (rpcError || !data) {
      setError("Fixed fees could not be loaded.");
      return;
    }
    const next: FeeState = {};
    for (const p of PRODUCTS) {
      const row = (data as Record<string, { enabled?: boolean; amount?: number }>)[p.key];
      next[p.key] = { enabled: !!row?.enabled, amount: String(row?.amount ?? 0) };
    }
    setFees(next);
    setSaved(JSON.stringify(next));
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function publish(elevationId: string) {
    if (!fees) return;
    const previous: FeeState = JSON.parse(saved);
    setBusy(true);
    try {
      for (const p of PRODUCTS) {
        if (JSON.stringify(previous[p.key]) === JSON.stringify(fees[p.key])) continue;
        const { error: rpcError } = await supabase.rpc("creator_publish_policy", {
          p_creator_elevation_id: elevationId,
          p_policy_key: `fixed_fee_${p.key}`,
          p_scope_type: "global",
          p_scope_key: "*",
          p_value: { enabled: fees[p.key].enabled, amount: Number(fees[p.key].amount) || 0 },
          p_value_schema: { type: "fixed_fee" },
          p_effective_from: new Date().toISOString(),
          p_public_disclosure: true,
          p_disclosure_text: "Fixed WeHouse service fee added to the percentage commission.",
          p_legal_review_state: "not_required",
          p_reason: reason.trim(),
        });
        if (rpcError) throw rpcError;
      }
      toast.success("Fixed fees updated for new bookings");
      setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fixed fees could not be saved");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p role="alert" className="text-sm text-[var(--wh-text-secondary)]">{error}</p>;
  if (!fees) return <WeHouseLoadingState compact label="Loading" />;
  const dirty = JSON.stringify(fees) !== saved;

  return (
    <section className="rounded-xl border border-[var(--wh-border-subtle)] p-4">
      <h3 className="text-sm font-semibold">Fixed WeHouse fee</h3>
      <p className="mt-1 text-sm text-[var(--wh-text-secondary)]">
        An optional flat amount added to the percentage commission, taken from the partner's share. It is off until you switch it on. Existing bookings keep the fee they were made with.
      </p>
      <div className="mt-3 space-y-2">
        {PRODUCTS.map((p) => (
          <div key={p.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--wh-border-subtle)] p-3">
            <label className="flex min-h-11 flex-1 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={fees[p.key].enabled}
                onChange={(e) => setFees({ ...fees, [p.key]: { ...fees[p.key], enabled: e.target.checked } })}
              />
              {p.label}
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--wh-text-secondary)]">
              ₦
              <input
                type="number"
                min={0}
                inputMode="numeric"
                disabled={!fees[p.key].enabled}
                value={fees[p.key].amount}
                onChange={(e) => setFees({ ...fees, [p.key]: { ...fees[p.key], amount: e.target.value } })}
                className="min-h-11 w-28 rounded-lg border border-[var(--wh-border-subtle)] bg-transparent px-2 disabled:opacity-50"
                aria-label={`${p.label} fixed fee in naira`}
              />
            </label>
          </div>
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
        {busy ? "Saving…" : "Save fixed fees"}
      </button>
    </section>
  );
}

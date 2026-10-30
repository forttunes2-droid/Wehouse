import { useEffect, useRef, useState } from "react";
import { withTimeout } from '@/lib/withTimeout';
import { toast } from "sonner";
import { setWorkerAvailability } from "@/lib/supabase";
import type { Profile } from "@/types";

export default function WorkerAvailabilityControl({ profile }: { profile: Profile }) {
  const [available, setAvailable] = useState(profile.available === true);
  const [saving, setSaving] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setAvailable(profile.available === true); return () => { generation.current++; }; },[profile.user_id,profile.available]);

  async function toggle() {
    if (active.current) return;
    active.current = true;
    const current = generation.current;
    const next = !available;
    setSaving(true);
    try {
      const { profile: saved, error } = await withTimeout(setWorkerAvailability(profile.user_id, next),15000,'Availability confirmation timed out. Refresh your workspace before retrying.');
      if (error) throw error;
      if (!saved || saved.user_id !== profile.user_id || saved.available !== next) throw new Error('Availability was not confirmed. Refresh your workspace before retrying.');
      if (current !== generation.current) return;
      setAvailable(saved.available);
      toast.success(next ? 'Availability saved: accepting new booking requests.' : 'Availability saved: not accepting new booking requests.');
    } catch (error) {
      if (current === generation.current) toast.error(error instanceof Error ? error.message : (error as {message?:string})?.message || 'Availability could not be confirmed. Refresh before retrying.');
    } finally { active.current = false; setSaving(false); }
  }

  return (
    <section className={`rounded-2xl border p-4 ${available ? "border-emerald-500/15 bg-emerald-500/[.04]" : "border-[var(--wh-border-subtle)] bg-[var(--wh-surface)]"}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-xs font-bold uppercase tracking-[.16em] ${available ? "text-emerald-700 dark:text-emerald-300" : "text-[var(--wh-text-muted)]"}`}>
            {available ? "AVAILABLE" : "NOT AVAILABLE"}
          </p>
          <h2 className="mt-1 text-sm font-semibold">Accept new booking requests</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">
            {available
              ? "You are available for new requests. Discovery also requires current review, credentials and platform eligibility."
              : "You are not accepting new requests. Existing jobs and conversations continue normally."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={available}
          aria-label="Accept new booking requests"
          disabled={saving}
          onClick={() => void toggle()}
          className={`wh-motion-control relative h-11 w-14 shrink-0 rounded-full border border-[var(--wh-border)] disabled:opacity-45 ${available ? "bg-emerald-600" : "bg-[var(--wh-interactive)]"}`}
        >
          <span className={`wh-motion-thumb absolute left-1 top-2 h-6 w-6 rounded-full bg-white shadow-sm ${available ? "translate-x-6" : "translate-x-0"}`} />
        </button>
      </div>
    </section>
  );
}

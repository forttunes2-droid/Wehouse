import { useState } from "react";
import { toast } from "sonner";
import { setWorkerAvailability } from "@/lib/supabase";
import type { Profile } from "@/types";

export default function WorkerAvailabilityControl({ profile }: { profile: Profile }) {
  const [available, setAvailable] = useState(profile.available !== false);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (saving) return;
    const next = !available;
    setSaving(true);
    const { error } = await setWorkerAvailability(profile.user_id, next);
    setSaving(false);
    if (error) return toast.error(error.message);
    setAvailable(next);
    toast.success(next ? "You are visible in Discovery" : "You are hidden from Discovery");
  }

  return (
    <section className={`rounded-2xl border p-4 ${available ? "border-emerald-500/15 bg-emerald-500/[.04]" : "border-white/[.07] bg-[#10131B]"}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-[9px] font-bold uppercase tracking-[.16em] ${available ? "text-emerald-300" : "text-[#777E8E]"}`}>
            {available ? "AVAILABLE" : "NOT AVAILABLE"}
          </p>
          <h2 className="mt-1 text-sm font-semibold">Accept new booking requests</h2>
          <p className="mt-1 text-[9px] leading-4 text-[#707687]">
            {available
              ? "Customers can find you in Discovery."
              : "You are hidden from Discovery. Existing jobs and conversations continue normally."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={available}
          aria-label="Accept new booking requests"
          disabled={saving}
          onClick={() => void toggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-45 ${available ? "bg-emerald-500" : "bg-[#2A2E38]"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${available ? "left-6" : "left-1"}`} />
        </button>
      </div>
    </section>
  );
}

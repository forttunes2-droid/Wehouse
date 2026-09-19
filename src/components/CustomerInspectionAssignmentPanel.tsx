import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Candidate = {
  user_id: string;
  name: string;
  username?: string | null;
  active_assignments?: number;
};
type Assignment = {
  inspection_id?: string | null;
  inspection_status?: string | null;
  conversation_id?: string | null;
  assigned_property_operations_id?: string | null;
  assigned_field_officer_id?: string | null;
  assigned_field_officer_name?: string | null;
  candidates?: Candidate[];
};

export default function CustomerInspectionAssignmentPanel({
  reservationId,
}: {
  reservationId: string;
}) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc(
      "get_customer_inspection_assignment",
      { p_reservation_id: reservationId },
    );
    setLoading(false);
    if (error) {
      toast.error(error.message || "Inspection assignment could not be loaded");
      return;
    }
    const next = (data || null) as Assignment | null;
    setAssignment(next);
    setSelected(next?.assigned_field_officer_id || "");
  }, [reservationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign() {
    if (!assignment?.inspection_id || !selected) return;
    setBusy(true);
    const { error } = await supabase.rpc("staff_assign_customer_inspection", {
      p_inspection_id: assignment.inspection_id,
      p_field_officer_id: selected,
      p_scheduled_date: null,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "Field Operations could not be assigned");
    toast.success("Field Operations joined the existing property conversation");
    await load();
  }

  if (loading)
    return (
      <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
        <p className="text-[10px] text-[#7A8191]">Loading inspection assignment…</p>
      </section>
    );

  if (!assignment?.inspection_id) return null;

  const candidates = assignment.candidates || [];
  const assigned = Boolean(assignment.assigned_field_officer_id);
  return (
    <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-violet-300">
        Property Operations · inspection
      </p>
      <h4 className="mt-1 text-sm font-semibold">Assign Field Operations</h4>
      <p className="mt-1 text-[10px] leading-5 text-[#858B9A]">
        This customer inspection stays owned by Property Operations. Choose the Field Operations officer for this property branch; they join the same reservation conversation instead of creating another customer chat.
      </p>

      {assigned ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[.04] p-3">
          <div>
            <p className="text-[9px] text-[#757D8D]">Assigned to this inspection</p>
            <p className="mt-1 text-xs font-semibold text-emerald-300">
              {assignment.assigned_field_officer_name || assignment.assigned_field_officer_id}
            </p>
          </div>
          <span className="text-[8px] font-semibold text-emerald-300">IN SAME CHAT</span>
        </div>
      ) : candidates.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="h-11 rounded-xl border border-white/[.08] bg-[#151923] px-3 text-xs outline-none focus:border-violet-500/40"
            aria-label="Field Operations officer for inspection"
          >
            <option value="">Choose Field Operations</option>
            {candidates.map((officer) => (
              <option key={officer.user_id} value={officer.user_id}>
                {officer.name}
                {officer.username ? ` · @${officer.username}` : ""}
                {Number(officer.active_assignments || 0) > 0
                  ? ` · ${officer.active_assignments} active`
                  : " · available"}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => void assign()}
            className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40"
          >
            {busy ? "Assigning…" : "Assign to conversation"}
          </button>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-amber-500/[.06] p-3 text-[9px] leading-5 text-amber-200">
          No active Field Operations officer is configured for this property branch. Keep the request with Property Operations until one is available.
        </p>
      )}
    </section>
  );
}

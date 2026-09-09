import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ListingMediaImage } from "@/components/ListingCandidateMedia";

type Invitation = {
  id: string;
  hotel_id: number;
  hotel_name: string;
  hotel_image?: string | null;
  hotel_role: "manager" | "staff";
  inviter_name: string;
  created_at: string;
};

export default function HotelTeamInvitations() {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_hotel_team_invitations");
    if (error) return;
    setRows(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(row: Invitation, accept: boolean) {
    setBusy(row.id);
    const { error } = await supabase.rpc("respond_to_hotel_team_invitation", {
      p_membership_id: row.id,
      p_accept: accept,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    setRows((current) => current.filter((item) => item.id !== row.id));
    toast.success(accept ? `${row.hotel_name} access accepted` : "Invitation declined");
    if (accept) window.setTimeout(() => window.location.reload(), 700);
  }

  if (!rows.length) return null;
  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-violet-500/15 bg-[#11141C]">
      <header className="border-b border-white/[.06] px-4 py-3">
        <h2 className="text-xs font-semibold">Hotel invitations</h2>
      </header>
      <div className="divide-y divide-white/[.06]">
        {rows.map((row) => (
          <article key={row.id} className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/[.035]">
                {row.hotel_image ? (
                  <ListingMediaImage reference={row.hotel_image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-sm font-bold text-violet-300">H</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{row.hotel_name}</p>
                <p className="mt-1 text-[9px] text-[#777D8D]">
                  {row.inviter_name} invited you as {row.hotel_role === "manager" ? "Manager" : "Front desk"}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy === row.id} onClick={() => void respond(row, false)} className="h-10 rounded-xl border border-white/[.08] text-[10px] font-semibold text-[#AEB4C1] disabled:opacity-40">Decline</button>
              <button type="button" disabled={busy === row.id} onClick={() => void respond(row, true)} className="h-10 rounded-xl bg-violet-500 text-[10px] font-semibold disabled:opacity-40">{busy === row.id ? "Updating…" : "Accept"}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

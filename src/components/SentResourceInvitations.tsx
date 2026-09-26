import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Invitation = {
  invitation_id: string;
  role_key: "property_cohost" | "hotel_manager" | "hotel_front_desk";
  permission_profile: string;
  delivery: "direct" | "link";
  recipient_name?: string | null;
  expires_at: string;
  created_at: string;
};

function label(row: Invitation) {
  if (row.role_key === "property_cohost")
    return row.permission_profile === "full_hosting" ? "Co-host · Full hosting" : "Co-host · Operations";
  return row.role_key === "hotel_manager" ? "Hotel Manager" : "Front desk";
}

export default function SentResourceInvitations({
  resourceType,
  resourceId,
}: {
  resourceType: "property" | "hotel";
  resourceId: string;
}) {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_sent_resource_invitations", {
      p_resource_type: resourceType,
      p_resource_id: resourceId,
    });
    setLoading(false);
    if (error) {
      setRows([]);
      return;
    }
    setRows(Array.isArray(data) ? data as Invitation[] : []);
  }, [resourceId, resourceType]);

  useEffect(() => { void load(); }, [load]);

  async function revoke(id: string) {
    setBusy(id);
    const { error } = await supabase.rpc("revoke_my_resource_invitation", {
      p_invitation_id: id,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Invitation withdrawn");
    await load();
  }

  if (loading || rows.length === 0) return null;

  return <section className="mt-4 border-t border-border pt-4">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold text-foreground">Pending invitations</h4>
      <span className="text-[10px] text-muted-foreground">{rows.length}</span>
    </div>
    <div className="mt-2 divide-y divide-border">
      {rows.map(row => <div key={row.invitation_id} className="flex items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{label(row)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {row.delivery === "direct" ? row.recipient_name || "WeHouse account" : "Share link"}
            {" · "}expires {new Date(row.expires_at).toLocaleDateString()}
          </p>
        </div>
        <button
          type="button"
          disabled={busy === row.invitation_id}
          onClick={() => void revoke(row.invitation_id)}
          className="min-h-10 px-2 text-[10px] font-semibold text-destructive disabled:opacity-40"
        >
          {busy === row.invitation_id ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>)}
    </div>
  </section>;
}

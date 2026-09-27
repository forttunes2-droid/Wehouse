import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { InvitationPreview } from "@/lib/resourceInvitation";

function roleLabel(row: InvitationPreview) {
  if (row.role_key === "property_cohost") return "Co-host";
  if (row.role_key === "hotel_manager") return "Hotel Manager";
  return "Front desk";
}

function permissionLabel(row: InvitationPreview) {
  if (row.role_key === "property_cohost")
    return row.permission_profile === "full_hosting"
      ? "Full hosting · guest operations, future pricing and availability"
      : "Operations · guest messages, arrivals and handovers";
  return row.role_key === "hotel_manager"
    ? "Manager access · hotel operations allowed by the owner"
    : "Front desk · reservations, guest messages and check-in/out";
}

export function PublicInvitationPreview({
  token,
  onSignIn,
  onClose,
}: {
  token: string;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [row, setRow] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase.rpc("preview_resource_invitation", { p_token: token }).then(({ data, error }) => {
      if (!active) return;
      setLoading(false);
      if (error || !data?.valid) { setRow(null); return; }
      setRow(data as InvitationPreview);
    });
    return () => { active = false; };
  }, [token]);

  return <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground">
    <div className="mx-auto max-w-md">
      <button type="button" onClick={onClose} className="min-h-11 text-sm font-semibold text-muted-foreground">← Explore WeHouse</button>
      <section className="mt-4 overflow-hidden rounded-3xl border border-border bg-card p-5">
        {loading ? <p className="py-8 text-sm text-muted-foreground">Opening invitation…</p> : !row ? <>
          <h1 className="text-lg font-semibold">Invitation unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">This invitation may have expired, been revoked or already been used.</p>
        </> : <>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">WEHOUSE INVITATION</p>
          <h1 className="mt-3 text-xl font-semibold">{row.resource_title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{row.inviter_name} invited you as {roleLabel(row)}.</p>
          <div className="mt-5 border-y border-border py-4">
            <p className="text-xs font-semibold">{roleLabel(row)}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{permissionLabel(row)}</p>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">Opening this link does not grant access. Sign in or create your Personal WeHouse account, then review and accept it.</p>
          <button type="button" onClick={onSignIn} className="mt-5 h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Sign in to continue</button>
        </>}
      </section>
    </div>
  </main>;
}

export default function ResourceInvitationAction({
  invitationId,
  token,
  onClose,
  onResolved,
}: {
  invitationId?: string;
  token?: string;
  onClose: () => void;
  onResolved?: (resourceType: "property" | "hotel", accepted: boolean) => void;
}) {
  const [row, setRow] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = token
      ? await supabase.rpc("preview_resource_invitation", { p_token: token })
      : await supabase.rpc("get_my_resource_invitation", { p_invitation_id: invitationId });
    setLoading(false);
    if (result.error || !result.data || (token && !result.data.valid)) {
      setRow(null);
      return;
    }
    setRow(result.data as InvitationPreview);
  }, [invitationId, token]);

  useEffect(() => { void load(); }, [load]);

  async function respond(accept: boolean) {
    if (!row || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("respond_to_resource_invitation", {
      p_invitation_id: row.invitation_id,
      p_accept: accept,
      p_token: token || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(accept ? "Invitation accepted" : "Invitation declined");
    window.dispatchEvent(new Event("wehouse:workspace-access-changed"));
    onResolved?.(row.resource_type, accept);
    onClose();
  }

  return <div className="fixed inset-0 z-[100090] flex items-end bg-black/70 sm:items-center sm:justify-center sm:p-5" role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="Invitation" onClick={event=>event.stopPropagation()} className="w-full rounded-t-[28px] border border-border bg-card p-5 text-foreground sm:max-w-md sm:rounded-3xl">
      <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-primary">INVITATION</p><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">×</button></div>
      {loading ? <p className="py-8 text-sm text-muted-foreground">Loading invitation…</p> : !row ? <div className="py-6"><h2 className="text-lg font-semibold">Invitation unavailable</h2><p className="mt-2 text-sm text-muted-foreground">It may have expired, been revoked or already been answered.</p></div> : <>
        <h2 className="mt-4 text-xl font-semibold">{row.resource_title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{row.inviter_name} invited you as {roleLabel(row)}.</p>
        <div className="mt-5 border-y border-border py-4"><p className="text-xs font-semibold">{roleLabel(row)}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{permissionLabel(row)}</p></div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Accepting grants only the access shown here. It does not transfer ownership or payout authority.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={()=>void respond(false)} className="h-12 rounded-xl border border-border text-sm font-semibold disabled:opacity-40">Decline</button>
          <button type="button" disabled={busy} onClick={()=>void respond(true)} className="h-12 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Updating…" : "Accept"}</button>
        </div>
      </>}
    </section>
  </div>;
}

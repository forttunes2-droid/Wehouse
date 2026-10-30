import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/withTimeout";

type Invitation = {
  invitation_id: string;
  status: string;
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

type Props = {
  resourceType: "property" | "hotel";
  resourceId: string;
};
export default function SentResourceInvitations(props: Props) {
  return <SentInvitationsForResource key={`${props.resourceType}:${props.resourceId}`} {...props} />;
}
function SentInvitationsForResource({ resourceType, resourceId }: Props) {
  const generation=useRef(0),mutation=useRef(false),mounted=useRef(true);
  const [loadError,setLoadError]=useState(false);
  const [rows, setRows] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const request=++generation.current;
    setLoading(true);setLoadError(false);setRows([]);
    try {
      const {data,error}=await withTimeout(supabase.rpc("get_my_resource_invitations", {p_resource_type:resourceType,p_resource_id:resourceId}),10000,"Sent invitations took too long to load");
      if(error||!Array.isArray(data)||data.some(row=>!row||typeof row.invitation_id!=="string"||typeof row.status!=="string"||!["property_cohost","hotel_manager","hotel_front_desk"].includes(row.role_key)||!["direct","link"].includes(row.delivery)||!Number.isFinite(Date.parse(row.expires_at))))throw new Error("Invalid invitation details");
      if(mounted.current&&request===generation.current)setRows(data.filter((row:Invitation)=>row.status==='pending'));
    } catch {if(mounted.current&&request===generation.current)setLoadError(true);}
    finally {if(mounted.current&&request===generation.current)setLoading(false);}
  }, [resourceId, resourceType]);
  useEffect(() => {
    mounted.current=true;void load();
    const refresh=()=>void load();window.addEventListener("wehouse:resource-invitations-changed",refresh);
    return()=>{mounted.current=false;generation.current++;window.removeEventListener("wehouse:resource-invitations-changed",refresh);};
  },[load]);
  async function revoke(id:string){
    if(mutation.current)return;mutation.current=true;setBusy(id);
    try {
      const {data,error}=await supabase.rpc("revoke_resource_invitation",{p_invitation_id:id});
      if(!mounted.current)return;
      if(error||data!==true)throw new Error("Withdrawal could not be confirmed. Reload sent invitations before trying again.");
      toast.success("Invitation withdrawn");await load();
    }catch(error){if(mounted.current)toast.error(error instanceof Error?error.message:"Invitation could not be withdrawn. Reload sent invitations.");}
    finally{mutation.current=false;if(mounted.current)setBusy(null);}
  }
  if(loading)return <p role="status" className="mt-4 text-xs text-muted-foreground">Loading sent invitations...</p>;
  if(loadError)return <section role="alert" className="mt-4 rounded-xl border border-border p-4 text-sm text-foreground"><p>Sent invitations could not be loaded.</p><button type="button" onClick={()=>void load()} className="mt-2 min-h-11 rounded-xl border border-border px-4 font-semibold">Reload sent invitations</button></section>;
  if(rows.length===0)return null;

  return <section className="mt-4 border-t border-border pt-4">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold text-foreground">Pending invitations</h4>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{rows.length}</span><button type="button" aria-label="Reload sent invitations" disabled={busy !== null} onClick={()=>void load()} className="min-h-11 rounded-xl border border-border px-3 text-xs font-semibold text-foreground disabled:opacity-40">Refresh</button></div>
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
          disabled={busy !== null}
          onClick={() => void revoke(row.invitation_id)}
          className="min-h-10 px-2 text-[10px] font-semibold text-destructive disabled:opacity-40"
        >
          {busy === row.invitation_id ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>)}
    </div>
  </section>;
}

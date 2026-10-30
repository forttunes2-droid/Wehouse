import WorkspaceRestrictionControls from '@/components/WorkspaceRestrictionControls';
import WorkerCredentials from '@/components/WorkerCredentials';
import ExperienceActivityReviewQueue from '@/components/ExperienceActivityReviewQueue';
import WeHouseLoadingState from "@/components/WeHouseLoadingState";
import WorkerPublicationControls from "@/components/WorkerPublicationControls";
import WorkerPublicProfile from "@/components/WorkerPublicProfile";
import type { Profile } from "@/types";
import { withTimeout } from "@/lib/withTimeout";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getWorkers, supabase } from "@/lib/supabase";
import InlineFilterChips from "@/components/InlineFilterChips";
import { canonicalStatusOptions } from "@/lib/status";
import { workerOccupation } from "@/lib/workerTaxonomy";
import MediaViewer from "@/components/MediaViewer";
import { useRpcRead } from "@/hooks/useRpcRead";
import { useCreatorAuth } from "@/hooks/useCreatorAuth";

type Worker = {
  user_id: string;
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
  worker_occupation?: string | null;
  worker_status?: string | null;
  worker_verified?: boolean;
  available?: boolean;
  suspended?: boolean;
  state?: string | null;
  local_government?: string | null;
  city?: string | null;
  rating?: number | null;
  review_count?: number | null;
};
type Checks = {
  profile_ready?: boolean;
  identity_captured?: boolean;
  identity_passed?: boolean;
  readiness_passed?: boolean;
  readiness_percent?: number | null;
  evidence_saved?: boolean;
  certificate_path?: string | null;
  verification_video_url?: string | null;
  submitted?: boolean;
  review_status?: string | null;
};

export default function CreatorWorkerOversight({ userId,initialExperienceId }: { userId: string;initialExperienceId?:string }) {
  const { requestElevation } = useCreatorAuth();
  const selection = useRef(0);
  const reviewBusy = useRef(false);
  const accessBusy = useRef(false);
  const [credentialWorker,setCredentialWorker]=useState<string|null>(null);
  const [credentialsReady,setCredentialsReady]=useState(false);
  const [accessError,setAccessError]=useState('');
  const [accessReason,setAccessReason]=useState('');
  useEffect(() => () => { selection.current += 1; }, [userId]);
  const [selected, setSelected] = useState<Worker | null>(null),
    [checks, setChecks] = useState<Checks | null>(null),
    [loadingChecks, setLoadingChecks] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [reason, setReason] = useState(""),
    [acting, setActing] = useState(false),
    [previewWorkers, setPreviewWorkers] = useState<Worker[] | null>(null),
    [previewWorker, setPreviewWorker] = useState<Worker | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [previewError, setPreviewError] = useState(false);

  async function refreshCustomerPreview() {
    setPreviewBusy(true); setPreviewError(false);
    try {
      const { workers, error } = await withTimeout(getWorkers(), 15000, "Worker preview took too long.");
      if (error) throw error;
      setPreviewWorkers(workers);
    } catch {
      setPreviewWorkers(null); setPreviewError(true);
    } finally { setPreviewBusy(false); }
  }

  const { data, loading, error: listError, refresh: load } = useRpcRead<Worker[]>("creator_get_people", userId, { p_workspace: "worker" });
  const rows = useMemo(() => data || [], [data]);
  async function open(worker: Worker) {
    setAccessError('');setAccessReason('');
    setCredentialWorker(null);setCredentialsReady(false);
    const current = ++selection.current;
    setSelected(worker); setReason(""); setChecks(null); setLoadingChecks(true);
    try {
      const {data,error} = await withTimeout(supabase.rpc("admin_get_worker_review_trust_status",{p_worker_id:worker.user_id}),15000,"Review checks took too long.");
      if (current !== selection.current) return;
      if (error) throw error;
      setChecks((data || null) as Checks | null);
    } catch { if (current === selection.current) toast.error("Review checks could not be loaded. Reopen the Worker to retry."); }
    finally { if (current === selection.current) setLoadingChecks(false); }
  }

  async function applyAccessChange(elevationId: string) {
    if (!selected || accessBusy.current || accessError || !accessReason.trim()) return;
    const target=selected,current=selection.current;
    accessBusy.current=true;
    setActing(true);
    try {
    const { error } = await withTimeout(supabase.rpc("creator_set_account_suspension", {
      p_target_user_id: target.user_id,
      p_suspended: !target.suspended,
      p_reason: accessReason.trim(),
      p_creator_elevation_id: elevationId,
    }),20000,"Account access result is unknown. Reopen this account before retrying.");
    if(error)throw error;
    const saved=await withTimeout(supabase.from('profiles').select('user_id,suspended').eq('user_id',target.user_id).maybeSingle(),15000,'Account access confirmation took too long.');
    if(saved.error||saved.data?.user_id!==target.user_id||saved.data.suspended!==!target.suspended)throw Error('Saved account access could not be confirmed.');
    if(current!==selection.current)return;
    toast.success(
      target.suspended
        ? "Account access restored"
        : "Account access suspended across WeHouse",
    );
    setSelected(null);
    setReason("");
    setAccessReason('');
    await load();
    }catch{if(current===selection.current)setAccessError('Account access could not be confirmed. Refresh the saved status before retrying.');}
    finally{accessBusy.current=false;setActing(false);}
  }

  async function refreshAccountAccess(){
    if(!selected||accessBusy.current)return;const target=selected,current=selection.current;accessBusy.current=true;setActing(true);
    try{const r=await withTimeout(supabase.from('profiles').select('user_id,suspended').eq('user_id',target.user_id).maybeSingle(),15000,'Account access took too long.');
      if(r.error||r.data?.user_id!==target.user_id||typeof r.data.suspended!=='boolean')throw Error('Saved access unavailable');
      const suspended=r.data.suspended;
      if(current===selection.current){setSelected(previous=>previous?.user_id===target.user_id?{...previous,suspended}:previous);setAccessError('');setAccessReason('');}
    }catch{if(current===selection.current)setAccessError('Saved account access could not be loaded. Try refreshing again before making a change.');}
    finally{accessBusy.current=false;setActing(false);}
  }

  function changeAccess() {
    if (!selected || acting || accessError || !accessReason.trim()) return;
    const current=selection.current;
    requestElevation("all_sensitive", (elevationId) =>
      {if(current===selection.current)void applyAccessChange(elevationId);},
    );
  }

  async function applyReview(
    decision: "approve" | "reject",
    elevationId: string,
  ) {
    if (!selected || reviewBusy.current) return;
    reviewBusy.current = true;
    const request = selection.current;
    setActing(true);
    try {
    const { error } = await withTimeout(supabase.rpc("creator_review_worker", {
      p_worker_id: selected.user_id,
      p_decision: decision,
      p_reason: decision === "reject" ? reason.trim() : null,
      p_creator_elevation_id: elevationId,
    }), 15000, 'Review confirmation timed out. Reload the review before retrying.');
    if (error) throw error;
    if (request !== selection.current) return;
    toast.success(
      decision === "approve"
        ? "Service Worker approved"
        : "Service Worker rejected",
    );
    setSelected(null);
    setReason("");
    await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (error as {message?:string})?.message || 'The review could not be confirmed. Reload before retrying.');
    } finally {
      reviewBusy.current = false;
      setActing(false);
    }
  }

  function review(decision: "approve" | "reject") {
    if (!selected) return;
    if (decision === "reject" && !reason.trim()) {
      toast.error("Enter a rejection reason");
      return;
    }
    requestElevation("private_evidence", (elevationId) =>
      void applyReview(decision, elevationId),
    );
  }

  const statusOptions = useMemo(
    () =>
      canonicalStatusOptions(
        rows.map((worker) =>
          worker.suspended ? "suspended" : worker.worker_status || "pending",
        ),
      ),
    [rows],
  );

  useEffect(() => {
    if (!statusOptions.some((option) => option.value === filter))
      setFilter("all");
  }, [filter, statusOptions]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((worker) => {
      const status = worker.suspended
        ? "suspended"
        : worker.worker_status || "pending";
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      return [
        worker.full_name,
        worker.username,
        worker.email,
        workerOccupation(worker),
        worker.worker_occupation,
        status,
        worker.state,
        worker.local_government,
        worker.city,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, filter]);

  if (listError) return <section role="alert" className="rounded-xl border border-amber-500/20 p-4"><p className="text-sm text-amber-800 dark:text-amber-100">Service Workers could not be loaded.</p><button type="button" onClick={() => void load()} className="min-h-11 text-violet-700 dark:text-violet-300">Try again</button></section>;
  if (selected)
    return (
      <div className="space-y-4">
        <button type="button" className="min-h-11 rounded-xl border border-[var(--wh-border)] px-4 text-sm font-semibold text-[var(--wh-accent-text)]" onClick={()=>requestElevation("private_evidence",()=>setCredentialWorker(selected.user_id))}>Review service credentials</button>
        {credentialWorker===selected.user_id&&<WorkerCredentials workerId={selected.user_id} operator onReadyChange={setCredentialsReady}/>}
        <button
          onClick={() => { selection.current += 1; setSelected(null); }}
          className="text-sm font-semibold text-violet-700 dark:text-violet-400"
        >
          ← Service Worker oversight
        </button>
        <section className="rounded-3xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-5">
          <div className="flex items-start gap-3">
            <Avatar worker={selected} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold uppercase tracking-[.16em] text-violet-700 dark:text-violet-300">
                WEHOUSE SERVICE WORKER
              </p>
              <h2 className="mt-1 truncate text-lg font-bold">
                {selected.full_name || selected.username || "Service Worker"}
              </h2>
              <p className="mt-1 truncate text-sm text-[var(--wh-text-muted)]">
                {workerOccupation(selected)} ·{" "}
                {[selected.local_government || selected.city, selected.state]
                  .filter(Boolean)
                  .join(", ") || "Location not set"}
              </p>
            </div>
            <Status
              value={
                selected.suspended
                  ? "suspended"
                  : selected.worker_status || "pending"
              }
            />
          </div>
          {loadingChecks ? (
            <Loading />
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Check
                label="Identity"
                value={
                  checks?.identity_passed
                    ? "Current"
                    : checks?.identity_captured
                      ? "Captured"
                      : "Incomplete"
                }
                good={!!checks?.identity_passed}
              />
              <Check
                label="Profile"
                value={checks?.profile_ready ? "Complete" : "Incomplete"}
                good={!!checks?.profile_ready}
              />
              <Check
                label="Readiness"
                value={
                  checks?.readiness_passed
                    ? `Ready · ${checks.readiness_percent || 100}%`
                    : "Incomplete"
                }
                good={!!checks?.readiness_passed}
              />
              <Check
                label="Work evidence"
                value={checks?.evidence_saved ? "Submitted" : "Missing"}
                good={!!checks?.evidence_saved}
              />
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">

            <Info
              label="Rating"
              value={
                Number(selected.rating || 0)
                  ? Number(selected.rating).toFixed(1)
                  : "New"
              }
            />
            <Info label="Reviews" value={Number(selected.review_count || 0)} />
          </div>
          <section className="mt-4 border-y border-[var(--wh-border-subtle)] py-4">
            <h3 className="text-xs font-semibold">Professional evidence</h3>
            <p className="mt-1 text-sm leading-5 text-[var(--wh-text-muted)]">
              Review the identity result, readiness and work evidence before
              making the account decision. Identity confirmation is not proof of
              skill, licensing or ownership.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <EvidenceLink
                key={checks?.certificate_path || "no-certificate"}
                label="Certificate · optional"
                path={checks?.certificate_path}
                bucket="worker-certificates"
              />
              <EvidenceLink
                key={checks?.verification_video_url || "no-video"}
                label="Skill/work video · required"
                path={checks?.verification_video_url}
                bucket="worker-verification-videos"
              />
            </div>
          </section>
        </section>
        <WorkerPublicationControls userId={userId} workerId={selected.user_id} />
        <WorkspaceRestrictionControls key={selected.user_id} userId={selected.user_id}/>
        {selected.worker_status === "profile_under_review" && (
          <section className="border-y border-[var(--wh-border-subtle)] py-4">
            <h3 className="text-sm font-semibold">Service Worker profile review</h3>
            <p className="mt-1 text-sm leading-5 text-[var(--wh-text-muted)]">
              Creator approval requires fresh security confirmation. The server
              still blocks approval when required identity or professional
              evidence is incomplete. This reviews the work profile; it does not suspend the person’s Personal or Property Partner access.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Reason required only when rejecting"
              className="mt-3 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-black/20 p-3 text-xs outline-none"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => review("reject")}
                disabled={acting || !reason.trim()}
                className="h-11 rounded-xl border border-red-500/20 text-xs font-semibold text-red-300 disabled:opacity-35"
              >
                Reject
              </button>
              <button
                onClick={() => review("approve")}
                disabled={acting||!credentialsReady}
                className="h-11 rounded-xl bg-emerald-500 text-xs font-semibold text-[#04120A] disabled:opacity-35"
              >
                Approve Service Worker
              </button>
            </div>
          </section>
        )}
        <section className="border-y border-[var(--wh-border-subtle)] py-4">
          <h3 className="text-sm font-semibold">Account access</h3>
          <p className="mt-1 text-sm leading-5 text-[var(--wh-text-muted)]">
            This suspends the person’s access across all WeHouse workspaces,
            including Personal, Property Partner and Services. Existing bookings
            and financial records remain. Valid professional approval and uploaded evidence are preserved. Changing access requires a reason,
            fresh Creator confirmation and an audit record.
          </p>
          {accessError&&<div role="alert" className="mt-3 space-y-2 text-sm text-red-700 dark:text-red-300"><p>{accessError}</p><button type="button" disabled={acting} onClick={()=>void refreshAccountAccess()} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-3 font-semibold">Refresh account access</button></div>}
          {(
            <textarea
              value={accessReason}
              onChange={(e) => setAccessReason(e.target.value)}
              rows={2}
              placeholder="Reason for changing account access"
              aria-label="Reason for changing account access"
              disabled={acting}
              maxLength={2000}
              className="mt-3 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-3 text-xs outline-none"
            />
          )}
          <button
            onClick={changeAccess}
            disabled={acting || Boolean(accessError) || !accessReason.trim()}
            className={`mt-3 h-11 w-full rounded-xl text-xs font-semibold disabled:opacity-35 ${selected.suspended ? "bg-emerald-500 text-[#04120A]" : "bg-red-500/15 text-red-700 dark:text-red-300"}`}
          >
            {acting
              ? "Updating access…"
              : selected.suspended
                ? "Restore account access"
                : "Suspend account across WeHouse"}
          </button>
        </section>
      </div>
    );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Service Worker oversight</h2>
        <p className="mt-1 text-sm text-[var(--wh-text-muted)]">
          Onboarding, marketplace access, professional review and account
          exceptions for WeHouse Services.
        </p>
      </div>
      <ExperienceActivityReviewQueue initialApplicationId={initialExperienceId} />
      <WorkerPublicationControls userId={userId} />
      <section className="rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 sm:p-5" aria-label="Customer Worker discovery preview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Customer discovery preview</h3>
            <p className="mt-1 text-sm leading-5 text-[var(--wh-text-secondary)]">Creator only. See the eligible Worker profiles returned by the customer discovery rules while the public marketplace is paused.</p>
          </div>
          <button type="button" onClick={() => void refreshCustomerPreview()} disabled={previewBusy} className="min-h-11 rounded-xl border border-violet-400/30 px-4 text-sm font-semibold text-violet-200 disabled:opacity-50">{previewBusy ? "Loading…" : previewWorkers ? "Refresh preview" : "Preview Workers"}</button>
        </div>
        {previewError && <p role="alert" className="mt-3 text-sm text-amber-200">The Worker preview could not be loaded. Try again.</p>}
        {previewWorkers && <div className="mt-4 divide-y divide-[var(--wh-border-subtle)] border-t border-[var(--wh-border-subtle)]">
          {previewWorkers.length === 0 ? <p className="py-4 text-sm text-[var(--wh-text-secondary)]">No Worker currently meets the individual publication and availability checks.</p> : previewWorkers.map(worker => <button type="button" key={worker.user_id} onClick={() => setPreviewWorker(worker)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300" aria-label={`Preview ${worker.full_name || worker.username || "Service Worker"}'s customer profile`}>
            <Avatar worker={worker} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{worker.full_name || worker.username || "Service Worker"}</span><span className="mt-1 block text-sm text-[var(--wh-text-secondary)]">{workerOccupation(worker)} · {[worker.city || worker.local_government, worker.state].filter(Boolean).join(", ") || "Location not set"}</span></span><span aria-hidden="true" className="text-violet-200">›</span>
          </button>)}
        </div>}
      </section>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search Service Worker, occupation, service or location"
        className="h-11 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-xs outline-none"
      />
      <InlineFilterChips
        value={filter}
        options={statusOptions}
        onChange={setFilter}
        ariaLabel="Show Service Workers by lifecycle"
      />
      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty />
      ) : (
        <div className="divide-y divide-[var(--wh-border-subtle)] border-y border-[var(--wh-border-subtle)]">
          {shown.map((worker) => (
            <button
              key={worker.user_id}
              onClick={() => void open(worker)}
              className="flex w-full items-center gap-3 py-4 text-left"
            >
              <Avatar worker={worker} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {worker.full_name || worker.username || "Service Worker"}
                </p>
                <p className="mt-1 truncate text-sm text-[var(--wh-text-muted)]">
                  {workerOccupation(worker)} ·{" "}
                  {[worker.local_government || worker.city, worker.state]
                    .filter(Boolean)
                    .join(", ") || "Location not set"}
                </p>
              </div>
              <Status
                value={
                  worker.suspended
                    ? "suspended"
                    : worker.worker_status || "pending"
                }
              />
              <span className="text-[var(--wh-text-muted)]">›</span>
            </button>
          ))}
        </div>
      )}
      {previewWorker && <WorkerPublicProfile worker={previewWorker as Profile} onBack={() => setPreviewWorker(null)} onBook={() => {}} previewMode />}
    </div>
  );
}

function Avatar({ worker }: { worker: Worker }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500/12 text-sm font-bold text-violet-700 dark:text-violet-300">
      {String(worker.full_name || worker.username || "S")[0].toUpperCase()}
    </div>
  );
}
function Check({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${good ? "border-emerald-500/12 bg-emerald-500/[.035]" : "border-[var(--wh-border-subtle)] bg-black/10"}`}
    >
      <p className="text-sm uppercase text-[var(--wh-text-muted)]">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold ${good ? "text-emerald-300" : "text-[var(--wh-text-secondary)]"}`}
      >
        {value}
      </p>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--wh-border-subtle)] bg-black/10 p-3">
      <p className="text-sm uppercase text-[var(--wh-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--wh-text-secondary)]">{value}</p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const good = value === "verified",
    bad = ["rejected", "suspended"].includes(value);
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-1 text-sm font-semibold capitalize ${good ? "bg-emerald-500/10 text-emerald-300" : bad ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
function Loading() {
  return <WeHouseLoadingState compact label="Loading" />;
}
function Empty() {
  return (
    <div className="border-y border-dashed border-[var(--wh-border-subtle)] px-5 py-12 text-center text-sm text-[var(--wh-text-muted)]">
      No Service Workers match this view.
    </div>
  );
}
function EvidenceLink({
  label,
  path,
  bucket,
}: {
  label: string;
  path?: string | null;
  bucket: string;
}) {
  const directUrl = path?.startsWith("http") ? path : "";
  const [url, setUrl] = useState(directUrl),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    if (!path || directUrl) return;
    if (path.startsWith("http")) return;
    void supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!active) return;
        setUrl(data?.signedUrl || "");
        if (error) toast.error(`Unable to open ${label.toLowerCase()}`);
      });
    return () => {
      active = false;
    };
  }, [path, bucket, label, directUrl]);
  const loading = !!path && !url,
    kind = bucket === "worker-verification-videos" ? "video" : "image";
  return (
    <div className="rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-3">
      <p className="text-sm font-semibold">{label}</p>
      {loading ? (
        <p className="mt-2 text-sm text-[var(--wh-text-muted)]">
          Preparing secure link…
        </p>
      ) : url ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-violet-500/10 px-3 text-sm font-semibold text-violet-700 dark:text-violet-300"
        >
          View evidence
        </button>
      ) : (
        <p className="mt-2 text-sm text-[var(--wh-text-muted)]">Not supplied</p>
      )}
      {open && url ? (
        <MediaViewer
          src={url}
          kind={kind}
          title={label}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

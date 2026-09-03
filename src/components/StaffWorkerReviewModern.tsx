import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Worker = {
  user_id: string;
  full_name?: string | null;
  username?: string | null;
  worker_occupation?: string | null;
  worker_experience?: string | number | null;
  worker_status?: string | null;
  worker_cert_url?: string | null;
  worker_video_url?: string | null;
  state?: string | null;
  local_government?: string | null;
  city?: string | null;
};
type ReviewHistory = {
  id: string;
  action?: string | null;
  created_at: string;
  rejection_reason?: string | null;
  notes?: string | null;
};
type Evidence = {
  certificate_path?: string | null;
  verification_video_url?: string | null;
  years_of_experience?: number | null;
  status?: string | null;
};
type Identity = {
  status?: string | null;
  face_match_score?: number | null;
  liveness_score?: number | null;
  anti_spoof_score?: number | null;
  captured_at?: string | null;
  attempt_count?: number | null;
};

export default function StaffWorkerReviewModern() {
  const [rows, setRows] = useState<Worker[]>([]),
    [selected, setSelected] = useState<Worker | null>(null),
    [evidence, setEvidence] = useState<Evidence | null>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [history, setHistory] = useState<ReviewHistory[]>([]),
    [search, setSearch] = useState(""),
    [reason, setReason] = useState(""),
    [notes, setNotes] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_staff_worker_reviews", {
      p_status: "profile_under_review",
    });
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const shown = useMemo(
    () =>
      rows.filter(
        (worker) =>
          !search.trim() ||
          [
            worker.full_name,
            worker.username,
            worker.worker_occupation,
            worker.state,
            worker.local_government,
            worker.city,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function open(worker: Worker) {
    setSelected(worker);
    setReason("");
    setNotes("");
    const [evidenceResult, identityResult, historyResult] = await Promise.all([
      supabase
        .from("worker_verifications")
        .select(
          "certificate_path,verification_video_url,years_of_experience,status",
        )
        .eq("worker_id", worker.user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("get_staff_worker_identity_check", {
        p_worker_id: worker.user_id,
      }),
      supabase
        .from("worker_verification_reviews")
        .select("*")
        .eq("worker_id", worker.user_id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    if (identityResult.error) toast.error(identityResult.error.message);
    setEvidence(evidenceResult.data || null);
    setIdentity((identityResult.data || null) as Identity | null);
    setHistory(historyResult.data || []);
  }
  async function act(status: "verified" | "rejected") {
    if (!selected) return;
    if (status === "verified" && identity?.status !== "passed")
      return toast.error("The current private face check must pass first");
    if (
      status === "verified" &&
      !evidence?.verification_video_url &&
      !selected.worker_video_url
    )
      return toast.error("A real skill/work video is required before approval");
    if (status === "rejected" && !reason.trim())
      return toast.error("Enter the rejection reason");
    setSaving(true);
    const { error } = await supabase.rpc("review_my_staff_worker_v2", {
      p_worker_id: selected.user_id,
      p_status: status,
      p_reason: status === "rejected" ? reason.trim() : null,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      status === "verified"
        ? "Worker reviewed and made live"
        : "Worker review rejected",
    );
    setSelected(null);
    setEvidence(null);
    setIdentity(null);
    setHistory([]);
    void load();
  }
  if (selected) {
    const identityPassed = identity?.status === "passed",
      professionalReady = Boolean(
        evidence?.verification_video_url || selected.worker_video_url,
      );
    return (
      <div className="space-y-4 pb-24">
        <button
          onClick={() => setSelected(null)}
          className="text-[10px] font-semibold text-violet-400"
        >
          ← Back to Worker reviews
        </button>
        <section className="rounded-3xl border border-white/[.06] bg-[#10141D] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">
                WEHOUSE SERVICE WORKER REVIEW
              </p>
              <h2 className="mt-2 text-lg font-bold">
                {selected.full_name || selected.username || "Worker"}
              </h2>
              <p className="mt-1 text-[10px] text-[#747A8B]">
                {selected.worker_occupation || "Service not set"} ·{" "}
                {[selected.local_government || selected.city, selected.state]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
            <Status value={selected.worker_status} />
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">
                    Private identity check
                  </p>
                  <p className="mt-1 text-[9px] leading-relaxed text-[#73798A]">
                    WeHouse verifies the Worker privately with liveness and face
                    continuity. Worker Operations never receive government ID.
                  </p>
                </div>
                <Badge good={identityPassed}>
                  {identityPassed ? "CURRENT" : "NOT CURRENT"}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric
                  label="Face match"
                  value={score(identity?.face_match_score)}
                />
                <Metric
                  label="Liveness"
                  value={score(identity?.liveness_score)}
                />
                <Metric
                  label="Anti-spoof"
                  value={score(identity?.anti_spoof_score)}
                />
                <Metric
                  label="Captured"
                  value={
                    identity?.captured_at
                      ? new Date(identity.captured_at).toLocaleDateString()
                      : "—"
                  }
                />
              </div>
            </section>
            <section className="rounded-2xl border border-white/[.06] bg-black/10 p-4">
              <p className="text-xs font-semibold">Professional evidence</p>
              <p className="mt-1 text-[9px] leading-relaxed text-[#73798A]">
                Review the Worker’s stated service, experience and real work
                demonstration. There is no generic written quiz.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Info
                  label="Experience"
                  value={
                    selected.worker_experience ||
                    evidence?.years_of_experience ||
                    "Not supplied"
                  }
                />
                <Info
                  label="Service"
                  value={selected.worker_occupation || "Not supplied"}
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Evidence
                  label="Certificate · optional"
                  path={evidence?.certificate_path || selected.worker_cert_url}
                  bucket="worker-certificates"
                />
                <Evidence
                  label="Work demonstration · required"
                  path={
                    evidence?.verification_video_url ||
                    selected.worker_video_url
                  }
                  bucket="worker-verification-videos"
                />
              </div>
            </section>
          </div>
          <section className="mt-4 rounded-2xl border border-white/[.06] bg-[#0D1118] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold">Final WeHouse review</p>
                <p className="mt-1 text-[9px] text-[#73798A]">
                  Approval publishes the WeHouse Service Worker. Marketplace
                  trust can grow later from real jobs and reviews.
                </p>
              </div>
              <div className="flex max-w-full flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                <Badge good={identityPassed}>Identity</Badge>
                <Badge good={professionalReady}>Work evidence</Badge>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Review notes (optional)"
              className="mt-3 w-full rounded-xl border border-white/[.08] bg-black/20 p-3 text-xs outline-none focus:border-violet-500/40"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason required only when rejecting"
              className="mt-3 h-11 w-full rounded-xl border border-white/[.08] bg-black/20 px-3 text-xs outline-none focus:border-violet-500/40"
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => void act("verified")}
                disabled={saving || !identityPassed || !professionalReady}
                className="min-h-11 rounded-xl bg-violet-500 px-4 py-2.5 text-[10px] font-semibold disabled:opacity-35"
              >
                Approve & publish
              </button>
              <button
                onClick={() => void act("rejected")}
                disabled={saving}
                className="min-h-11 rounded-xl bg-red-500/15 px-4 py-2.5 text-[10px] font-semibold text-red-300 disabled:opacity-35"
              >
                Reject with reason
              </button>
            </div>
          </section>
        </section>
        {history.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-bold">Review history</h3>
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/[.06] bg-[#10141D] p-3"
                >
                  <div className="flex justify-between gap-3">
                    <p className="text-[10px] font-semibold capitalize">
                      {String(item.action || "review").replace(/_/g, " ")}
                    </p>
                    <p className="text-[8px] text-[#555C6D]">
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                  {(item.rejection_reason || item.notes) && (
                    <p className="mt-2 text-[10px] text-[#858A99]">
                      {item.rejection_reason || item.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Worker reviews</h2>
        <p className="mt-1 text-[10px] text-[#707687]">
          Review WeHouse Service professionals after their current private
          identity check, verified payment and real work evidence are complete.
        </p>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search Worker reviews"
        className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151E] px-4 text-xs outline-none focus:border-violet-500/35"
      />
      {loading ? (
        <Empty text="Loading Worker reviews…" />
      ) : shown.length === 0 ? (
        <Empty text="No Worker review is waiting for action." />
      ) : (
        <div className="space-y-2">
          {shown.map((worker) => (
            <button
              key={worker.user_id}
              onClick={() => void open(worker)}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-[#10141D] p-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {worker.full_name || worker.username || "Worker"}
                </p>
                <p className="mt-1 truncate text-[10px] text-[#666D7E]">
                  {worker.worker_occupation || "Service not set"} ·{" "}
                  {[worker.local_government || worker.city, worker.state]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
              <Status value={worker.worker_status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Evidence({
  label,
  path,
  bucket,
}: {
  label: string;
  path?: string | null;
  bucket: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!path) {
      const timer = window.setTimeout(() => setUrl(""), 0);
      return () => window.clearTimeout(timer);
    }
    if (path.startsWith("http")) {
      const timer = window.setTimeout(() => setUrl(path), 0);
      return () => window.clearTimeout(timer);
    }
    void supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (active) setUrl(data?.signedUrl || "");
      });
    return () => {
      active = false;
    };
  }, [path, bucket]);
  return (
    <div className="rounded-xl border border-white/[.06] bg-black/10 p-3">
      <p className="text-[9px] font-semibold">{label}</p>
      {url ? (
        bucket === "worker-verification-videos" ? (
          <div className="mt-2 space-y-2">
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-xl bg-black object-contain"
            />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-semibold text-violet-400"
            >
              Open full video ↗
            </a>
          </div>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[10px] font-semibold text-violet-400"
          >
            Open evidence →
          </a>
        )
      ) : (
        <p className="mt-2 text-[10px] text-[#606778]">Not supplied</p>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[.05] bg-black/10 p-3">
      <p className="text-[8px] uppercase text-[#62697A]">{label}</p>
      <p className="mt-1 text-[10px] font-semibold text-[#A6ACB9]">{value}</p>
    </div>
  );
}
function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-white/[.06] bg-black/10 p-3">
      <p className="text-[8px] uppercase text-[#62697A]">{label}</p>
      <p className="mt-1 text-[10px] text-[#A4A9B8]">{String(value)}</p>
    </div>
  );
}
function Badge({
  good,
  children,
}: {
  good: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-semibold ${good ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}
    >
      {good ? "✓ " : ""}
      {children}
    </span>
  );
}
function Status({ value }: { value?: string | null }) {
  return (
    <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[8px] capitalize text-violet-300">
      {String(value || "pending").replace(/_/g, " ")}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-12 text-center text-[10px] text-[#666C7D]">
      {text}
    </div>
  );
}
function score(value?: number | null) {
  return value == null ? "—" : `${Math.round(Number(value) * 100)}%`;
}

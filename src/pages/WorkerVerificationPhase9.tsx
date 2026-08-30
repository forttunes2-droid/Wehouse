import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import WorkerIdentityCheck from "@/components/WorkerIdentityCheck";
import WorkerVerificationChecklist from "@/components/WorkerVerificationChecklist";
import { supabase } from "@/lib/supabase";
import { verifyPaymentWithRetry } from "@/lib/supabase/payment-verify";
import type { Profile } from "@/types";

type Props = {
  profile: Profile;
  onBack: () => void;
  onEditProfile: () => void;
};
type Activation = {
  worker_status: string;
  live: boolean;
  profile_complete: boolean;
  payment_confirmed?: boolean;
  gold_badge?: boolean;
  identity_status: string;
  identity_passed: boolean;
  identity_current?: boolean;
  identity_captured_at?: string | null;
  identity_due_at?: string | null;
  identity_recheck_days?: number;
  identity_days_remaining?: number | null;
  evidence_saved: boolean;
  submitted: boolean;
  rejection_reason: string | null;
};
type UploadState = {
  name: string;
  size: number;
  kind: "video" | "certificate";
  phase: "uploading" | "complete" | "error";
  message?: string;
} | null;
const EMPTY: Activation = {
  worker_status: "pending",
  live: false,
  profile_complete: false,
  payment_confirmed: false,
  gold_badge: false,
  identity_status: "not_started",
  identity_passed: false,
  identity_current: false,
  identity_captured_at: null,
  identity_due_at: null,
  identity_recheck_days: 14,
  identity_days_remaining: null,
  evidence_saved: false,
  submitted: false,
  rejection_reason: null,
};
const REF_KEY = "wh_worker_verification_payment_ref";

export default function WorkerVerificationPhase9({
  profile,
  onBack,
  onEditProfile,
}: Props) {
  const videoInput = useRef<HTMLInputElement>(null),
    certificateInput = useRef<HTMLInputElement>(null);
  const [a, setA] = useState<Activation>(EMPTY),
    [fee, setFee] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [videoPath, setVideoPath] = useState(""),
    [certificatePath, setCertificatePath] = useState(""),
    [preview, setPreview] = useState(""),
    [uploadState, setUploadState] = useState<UploadState>(null);
  async function refresh() {
    const [activation, setting] = await Promise.all([
      supabase.rpc("get_my_worker_activation"),
      supabase.rpc("get_setting_v2", { p_key: "worker_verification_fee" }),
    ]);
    if (activation.error) toast.error(activation.error.message);
    else setA({ ...EMPTY, ...(activation.data || {}) } as Activation);
    const raw: any = setting.data;
    setFee(
      Number(Array.isArray(raw) ? raw[0]?.value : (raw?.value ?? raw ?? 0)),
    );
    setLoading(false);
  }
  useEffect(() => {
    void refresh();
  }, [profile.user_id]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    let dead = false;
    void (async () => {
      let ref = "";
      try {
        ref = localStorage.getItem(REF_KEY) || "";
      } catch {}
      if (!ref) return;
      const result = await verifyPaymentWithRetry(ref, {
        purpose: "worker_verification",
      });
      if (dead) return;
      if (result.success) {
        try {
          localStorage.removeItem(REF_KEY);
        } catch {}
        toast.success("Worker onboarding payment confirmed");
        await refresh();
      }
    })();
    return () => {
      dead = true;
    };
  }, []);
  const paid = Boolean(a.payment_confirmed ?? a.gold_badge),
    complete = a.identity_passed && paid && a.evidence_saved,
    reviewing =
      a.worker_status === "profile_under_review" ||
      (a.submitted && a.worker_status !== "verified"),
    approvedProfile =
      a.worker_status === "verified" && profile.worker_verified === true,
    identityExpired = approvedProfile && !a.identity_current,
    live = Boolean(a.live),
    repeatDays = Number(a.identity_recheck_days || 14);
  function openProfile() {
    onEditProfile();
  }
  async function pay() {
    if (fee <= 0) return toast.error("Worker onboarding fee is not configured");
    setBusy(true);
    try {
      const boot = await supabase.rpc("create_worker_verification_payment");
      if (boot.error || !boot.data?.success)
        throw new Error(
          boot.data?.error || boot.error?.message || "Payment could not start",
        );
      const reference = String(boot.data.reference || "");
      const init = await supabase.functions.invoke(
        "worker-verification-payment-init",
        { body: { reference } },
      );
      if (init.error) throw init.error;
      if (init.data?.already_paid) {
        await refresh();
        setBusy(false);
        return;
      }
      if (!init.data?.authorization_url)
        throw new Error(init.data?.error || "Paystack could not start");
      try {
        localStorage.setItem(REF_KEY, reference);
      } catch {}
      window.location.assign(String(init.data.authorization_url));
    } catch (error: any) {
      toast.error(error?.message || "Payment could not start");
      setBusy(false);
    }
  }
  async function upload(
    file: File,
    bucket: "worker-certificates" | "worker-verification-videos",
    kind: string,
  ) {
    const ext = file.name.split(".").pop() || "bin",
      path = `${profile.user_id}/${kind}-${Date.now()}.${ext}`;
    const result = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type || undefined });
    if (result.error) throw result.error;
    return path;
  }
  async function chooseVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/"))
      return toast.error("Choose a video file");
    if (file.size > 50 * 1024 * 1024)
      return toast.error("Skill video must be under 50MB");
    setUploadState({
      name: file.name,
      size: file.size,
      kind: "video",
      phase: "uploading",
    });
    try {
      const path = await upload(
        file,
        "worker-verification-videos",
        "skill-video",
      );
      setVideoPath(path);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
      setUploadState({
        name: file.name,
        size: file.size,
        kind: "video",
        phase: "complete",
      });
      toast.success("Skill/work video added");
    } catch (error: any) {
      const message = error?.message || "Video upload failed";
      setUploadState({
        name: file.name,
        size: file.size,
        kind: "video",
        phase: "error",
        message,
      });
      toast.error(message);
    }
  }
  async function chooseCertificate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024)
      return toast.error("Certificate must be under 10MB");
    setUploadState({
      name: file.name,
      size: file.size,
      kind: "certificate",
      phase: "uploading",
    });
    try {
      setCertificatePath(
        await upload(file, "worker-certificates", "certificate"),
      );
      setUploadState({
        name: file.name,
        size: file.size,
        kind: "certificate",
        phase: "complete",
      });
      toast.success("Certificate added");
    } catch (error: any) {
      const message = error?.message || "Certificate upload failed";
      setUploadState({
        name: file.name,
        size: file.size,
        kind: "certificate",
        phase: "error",
        message,
      });
      toast.error(message);
    }
  }
  async function saveEvidence() {
    if (!videoPath) return toast.error("Add a skill/work demonstration video");
    setBusy(true);
    const result = await supabase.rpc("save_my_worker_professional_evidence", {
      p_certificate_path: certificatePath || null,
      p_video_path: videoPath,
    });
    setBusy(false);
    if (result.error) return toast.error(result.error.message);
    await refresh();
  }
  async function submit() {
    setBusy(true);
    const result = await supabase.rpc("submit_my_worker_verification");
    setBusy(false);
    if (result.error) return toast.error(result.error.message);
    toast.success("Sent to WeHouse review");
    await refresh();
  }
  if (loading)
    return (
      <Shell>
        <div className="grid min-h-[60dvh] place-items-center">
          <Spinner />
        </div>
      </Shell>
    );
  return (
    <Shell>
      <Toaster position="top-center" richColors theme="dark" />
      <header className="border-b border-white/[.06] px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <button
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07]"
          >
            ←
          </button>
          <div>
            <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">
              WEHOUSE · SERVICE WORKER
            </p>
            <h1 className="mt-1 text-lg font-bold">
              Professional verification
            </h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {uploadState && (
          <UploadActivity
            state={uploadState}
            onDismiss={() => setUploadState(null)}
          />
        )}
        <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.045] p-4">
          <p className="text-[8px] font-bold uppercase tracking-[.16em] text-violet-300">
            ACCOUNT PROTECTION
          </p>
          <h2 className="mt-1 text-sm font-semibold">
            Identity check repeats every {repeatDays} days
          </h2>
          <p className="mt-2 text-[10px] leading-5 text-[#8490A3]">
            The quick private live-face check confirms that the approved
            professional is still using this Worker account. Rechecks do not
            repeat the onboarding payment or professional work review.
          </p>
        </section>
        {identityExpired ? (
          <>
            <Card
              eyebrow="IDENTITY CHECK DUE"
              title="Confirm it is still you"
              text="Your professional profile and history are safe. Complete the quick live check to return to public discovery and new Worker activity."
            >
              <Status text="New bookings and public Worker activity are paused until this check passes" />
            </Card>
            <WorkerIdentityCheck
              profile={profile}
              status="expired"
              onSaved={refresh}
            />
          </>
        ) : live ? (
          <Card
            eyebrow="IDENTITY CURRENT"
            title="Your Worker account is protected"
            text={
              a.identity_due_at
                ? `Next identity check: ${formatDate(a.identity_due_at)}${a.identity_days_remaining != null ? ` · ${a.identity_days_remaining} day${a.identity_days_remaining === 1 ? "" : "s"} remaining` : ""}.`
                : `You will be asked to repeat the check every ${repeatDays} days.`
            }
          >
            <Status
              text="Your services are public and you can accept new work"
              good
            />
            <Button label="Back to dashboard" onClick={onBack} />
          </Card>
        ) : (
          <>
            <Progress
              profile={a.profile_complete}
              verification={complete}
              review={approvedProfile}
            />
            {a.profile_complete && !reviewing && !approvedProfile && (
              <WorkerVerificationChecklist
                identityPassed={a.identity_passed}
                paymentConfirmed={paid}
                skillVideoSaved={a.evidence_saved}
              />
            )}{" "}
            {a.rejection_reason && (
              <Card
                eyebrow="REVIEW FEEDBACK"
                title="Changes needed"
                text={a.rejection_reason}
              />
            )}{" "}
            {reviewing ? (
              <Card
                eyebrow="3 · WEHOUSE REVIEW"
                title="Review in progress"
                text="WeHouse is reviewing your real professional work evidence."
              >
                <Status text="Your profile stays private until approval" />
                <Button label="Back to dashboard" onClick={onBack} secondary />
              </Card>
            ) : !a.profile_complete ? (
              <Card
                eyebrow="1 · PROFESSIONAL PROFILE"
                title="Complete your work profile"
                text="Add your service, experience, price and work location."
              >
                <Button
                  label="Complete professional profile"
                  onClick={openProfile}
                />
              </Card>
            ) : !a.identity_passed ? (
              <WorkerIdentityCheck
                profile={profile}
                status={a.identity_status}
                onSaved={refresh}
              />
            ) : !paid ? (
              <Card
                eyebrow="2 · WORKER VERIFICATION"
                title="Complete onboarding payment"
                text="One-time Worker onboarding fee. Recurring identity checks never charge you again."
              >
                <Status text="Private face check complete" good />
                <div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/10 px-4 py-3">
                  <span className="text-[10px] text-[#717888]">
                    Onboarding fee
                  </span>
                  <strong>₦{fee.toLocaleString()}</strong>
                </div>
                <Button
                  label={busy ? "Opening Paystack…" : "Continue to Paystack"}
                  onClick={() => void pay()}
                  disabled={busy || fee <= 0}
                />
              </Card>
            ) : !a.evidence_saved ? (
              <Card
                eyebrow="2 · WORKER VERIFICATION"
                title="Show your real work"
                text="Upload one short skill or completed-work video for private WeHouse review."
              >
                <Status text="Identity and onboarding payment complete" good />
                <Upload
                  label={
                    certificatePath
                      ? "Certificate added"
                      : "Certificate · optional"
                  }
                  done={!!certificatePath}
                  onClick={() => certificateInput.current?.click()}
                />
                <input
                  ref={certificateInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={chooseCertificate}
                />
                <Upload
                  label={
                    videoPath
                      ? "Skill/work video added"
                      : "Skill/work demonstration · required"
                  }
                  done={!!videoPath}
                  onClick={() => videoInput.current?.click()}
                />
                <input
                  ref={videoInput}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={chooseVideo}
                />
                {preview && (
                  <video
                    src={preview}
                    controls
                    playsInline
                    className="max-h-64 w-full rounded-2xl bg-black object-contain"
                  />
                )}
                <Button
                  label={busy ? "Saving…" : "Save professional evidence"}
                  onClick={() => void saveEvidence()}
                  disabled={busy || !videoPath}
                />
              </Card>
            ) : (
              <Card
                eyebrow="3 · WEHOUSE REVIEW"
                title="Ready for review"
                text="Your identity, onboarding payment and professional work evidence are complete."
              >
                <Button
                  label={busy ? "Submitting…" : "Submit to WeHouse"}
                  onClick={() => void submit()}
                  disabled={busy}
                />
              </Card>
            )}
          </>
        )}
      </main>
    </Shell>
  );
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-8 text-white">
      {children}
    </div>
  );
}
function Spinner() {
  return (
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
  );
}
function Card({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-white/[.07] bg-[#11151D] p-4">
      <div>
        <p className="text-[8px] font-bold tracking-[.16em] text-violet-300">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-lg font-bold">{title}</h2>
        <p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">
          {text}
        </p>
      </div>
      {children}
    </section>
  );
}
function Button({
  label,
  onClick,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-12 w-full rounded-xl text-xs font-semibold disabled:opacity-40 ${secondary ? "border border-white/[.08]" : "bg-violet-500"}`}
    >
      {label}
    </button>
  );
}
function Status({ text, good = false }: { text: string; good?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 text-[9px] ${good ? "border-emerald-500/15 bg-emerald-500/[.05] text-emerald-300" : "border-amber-500/15 bg-amber-500/[.05] text-amber-200"}`}
    >
      {text}
    </div>
  );
}
function Upload({
  label,
  done,
  onClick,
}: {
  label: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-12 w-full items-center justify-between rounded-xl border px-4 text-xs ${done ? "border-emerald-500/20 text-emerald-300" : "border-white/[.08] text-[#A2A7B3]"}`}
    >
      <span>{label}</span>
      <span>{done ? "✓" : "+"}</span>
    </button>
  );
}
function UploadActivity({
  state,
  onDismiss,
}: {
  state: NonNullable<UploadState>;
  onDismiss: () => void;
}) {
  const uploading = state.phase === "uploading",
    failed = state.phase === "error";
  return (
    <section
      aria-live="polite"
      className={`overflow-hidden rounded-2xl border p-4 ${failed ? "border-red-500/20 bg-red-500/[.05]" : state.phase === "complete" ? "border-emerald-500/20 bg-emerald-500/[.05]" : "border-violet-500/20 bg-violet-500/[.05]"}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${failed ? "bg-red-500/10" : state.phase === "complete" ? "bg-emerald-500/10" : "bg-violet-500/10"}`}
        >
          {uploading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" />
          ) : failed ? (
            "!"
          ) : (
            "✓"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{state.name}</p>
          <p className="mt-1 text-[9px] text-[#788091]">
            {failed
              ? state.message || "Upload failed"
              : uploading
                ? `Uploading ${state.kind} securely · ${formatBytes(state.size)}`
                : `Upload complete · ${formatBytes(state.size)}`}
          </p>
        </div>
        {!uploading && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss upload status"
            className="grid h-8 w-8 place-items-center rounded-full text-[#777E8E]"
          >
            ×
          </button>
        )}
      </div>
      {uploading && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.06]">
          <div className="h-full w-2/5 animate-pulse rounded-full bg-violet-400" />
        </div>
      )}
    </section>
  );
}
function formatBytes(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}
function Progress({
  profile,
  verification,
  review,
}: {
  profile: boolean;
  verification: boolean;
  review: boolean;
}) {
  const items = [
    ["Professional profile", profile],
    ["Verification", verification],
    ["WeHouse review", review],
  ] as const;
  return (
    <section className="grid grid-cols-3 gap-2 rounded-2xl border border-white/[.06] bg-[#0F131A] p-3">
      {items.map(([label, done], index) => (
        <div
          key={label}
          className={`rounded-xl border px-2 py-3 text-center ${done ? "border-emerald-500/15 bg-emerald-500/[.05]" : "border-white/[.05]"}`}
        >
          <span
            className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${done ? "bg-emerald-500 text-[#04120A]" : "bg-white/[.05] text-[#656C7B]"}`}
          >
            {done ? "✓" : index + 1}
          </span>
          <p
            className={`mt-2 text-[8px] ${done ? "text-emerald-300" : "text-[#676E7E]"}`}
          >
            {label}
          </p>
        </div>
      ))}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useConfirm } from "@/hooks/useConfirm";
import type { Profile } from "@/types";
import { compressImageFile, uploadStorageObjectWithProgress } from "@/lib/supabase";
import VideoPlayer from "@/components/VideoPlayer";
import WorkerShowcaseGrid from "@/components/WorkerShowcaseGrid";
import { useWorkerShowcase, type ShowcasePost } from "@/hooks/useWorkerShowcase";
import { withTimeout } from "@/lib/withTimeout";
import { workerDisplayName, workerAvatarUrl } from "@/lib/workerIdentity";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { createPortal } from "react-dom";
import WorkerShowcasePostViewer from "@/components/WorkerShowcasePostViewer";

type Post = ShowcasePost;

type Job = {
  id: string;
  booking_code: string | null;
  service_type: string | null;
};

type ManagerProps = { profile: Profile; initialPostId?: string };
export default function WorkerShowcaseManager(props: ManagerProps) {
  return <WorkerShowcaseContent key={props.profile.user_id} {...props} />;
}
function WorkerShowcaseContent({
  profile,
  initialPostId,
}: {
  profile: Profile;
  initialPostId?: string;
}) {
  const { ask, dialogProps } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const showcase = useWorkerShowcase(profile.user_id, true);
  const { posts, loading, load } = showcase;
  const [visibility, setVisibility] = useState("all");
  const [jobsError, setJobsError] = useState(false), [jobsRetry, setJobsRetry] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const kind = "work_post" as const;
  const [caption, setCaption] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishStage, setPublishStage] = useState<"idle" | "preparing" | "uploading" | "saving">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewer, setViewer] = useState<Post | null>(null);

  const identity = useRef(profile.user_id); identity.current = profile.user_id;
  useEffect(() => {
    let active = true; setJobs([]); setJobsError(false); setViewer(null);
    void withTimeout(supabase.from("worker_bookings").select("id,booking_code,service_type").eq("worker_id", profile.user_id).eq("status", "approved_released").order("created_at", { ascending: false }).limit(50), 15000, "Completed jobs took too long.").then(result => {
      if (!active) return;
      if (result.error || !Array.isArray(result.data)) setJobsError(true); else setJobs(result.data as Job[]);
    }).catch(() => { if (active) setJobsError(true); });
    return () => { active = false; };
  }, [profile.user_id, jobsRetry]);
  useEffect(() => {
    if (!initialPostId) return;
    let active = true;
    // A deep-linked post may be older than the first page. Do not cancel this
    // exact-record request when background thumbnail signing updates the grid.
    void showcase.findPost(initialPostId).then(post => {
      if (!active) return;
      if (post) setViewer(post); else toast.error("This work post is no longer available.");
    }).catch(() => { if (active) toast.error("The linked post could not be loaded. Please try again."); });
    return () => { active = false; };
  }, [initialPostId, showcase.findPost]);
  async function openPost(post: Post) {
    const worker = profile.user_id; setViewer(post);
    if (post.url) return;
    try { const ready = await showcase.refreshPost(post); if (identity.current === worker) setViewer(current => current?.id === post.id ? ready : current); }
    catch { toast.error("This work post could not be opened. Please try again."); }
  }

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function chooseFile(selected: File) {
    const isVideo = selected.type.startsWith("video/");
    const isImage = selected.type.startsWith("image/");
    if (!isVideo && !isImage) return toast.error("Choose an image or video");
    if (selected.size > (isVideo ? 50 : 12) * 1024 * 1024) {
      return toast.error(
        isVideo ? "Video must be under 50MB" : "Image must be under 12MB",
      );
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  function clearComposer() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview("");
    setCaption("");
    setBookingId("");
    if (input.current) input.current.value = "";
  }

  const saving = useRef(false);
  async function publish() {
    if (saving.current) return;
    if (!file) return toast.error("Choose a photo or video first");
    if (profile.worker_status !== "verified" || !profile.worker_verified) {
      return toast.error(
        "Finish WeHouse review before publishing work",
      );
    }

    const isVideo = file.type.startsWith("video/");
    saving.current = true;
    setBusy(true);
    setPublishStage("preparing");
    setUploadProgress(0);
    let path = "";
    try {
      const preserveOriginal = isVideo || (['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 1.5 * 1024 * 1024);
      const uploadBody = preserveOriginal ? file : await compressImageFile(file, 2560, 0.86, 1.8 * 1024 * 1024);
      const ext = isVideo ? (file.name.split(".").pop() || "mp4").toLowerCase() : preserveOriginal ? ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type] || 'jpg') : 'jpg';
      path = `${profile.user_id}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      setPublishStage("uploading");
      await uploadStorageObjectWithProgress(
        "worker-showcase",
        path,
        uploadBody,
        isVideo || preserveOriginal ? file.type : "image/jpeg",
        setUploadProgress,
      );

      setPublishStage("saving");
      const { error } = await supabase.rpc("create_my_worker_showcase_post", {
        p_kind: kind,
        p_media_type: isVideo ? "video" : "image",
        p_storage_path: path,
        p_caption: caption.trim() || null,
        p_booking_id: bookingId || null,
      });
      if (error) throw error;

      toast.success(bookingId ? "Work post saved · customer confirmation requested" : "Work post saved");
      clearComposer();
      await load();
    } catch (error: unknown) {
      if (path)
        await supabase.storage
          .from("worker-showcase")
          .remove([path])
          .catch(() => {});
      toast.error(
        error instanceof Error ? error.message : "Could not publish work",
      );
    } finally {
      saving.current = false;
      setBusy(false);
      setPublishStage("idle");
      setUploadProgress(0);
    }
  }

  async function remove(post: Post) {
    if (
      !(await ask({
        title: "Delete this showcase post permanently?",
        description: "The post and its uploaded media cannot be restored.",
        confirmLabel: "Delete post",
        variant: "danger",
      }))
    )
      return;
    setBusy(true);
    const { data: path, error } = await supabase.rpc(
      "delete_my_worker_showcase_post",
      { p_post_id: post.id },
    );
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    if (path)
      await supabase.storage.from("worker-showcase").remove([String(path)]);
    setBusy(false);
    setViewer(null);
    await load();
  }

  async function setHidden(post:Post,hidden:boolean){
    setBusy(true);
    const{error}=await supabase.rpc('set_my_worker_work_post_hidden',{p_post_id:post.id,p_hidden:hidden});
    setBusy(false);if(error)return toast.error(error.message);
    toast.success(hidden?'Post hidden':'Post visibility updated');
    setViewer(null);await load();
  }

  const workPosts = posts.filter(post => visibility === "all" || (visibility === "hidden" ? Boolean(post.hidden_at) : !post.hidden_at));
  const previewIsVideo = file?.type.startsWith("video/") || false;

  return (
    <section className="space-y-5">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) chooseFile(selected);
        }}
      />

      {file && (
        <ShowcaseComposer onClose={clearComposer} busy={busy}><div className="fixed inset-0 z-[100100] flex h-[100dvh] flex-col bg-[#08090D]">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.08] px-3">
            <button
              type="button"
              onClick={clearComposer}
              disabled={busy}
              className="grid h-11 w-11 place-items-center rounded-full text-xl text-[#A8ADBA]"
              aria-label="Close preview"
            >
              ×
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">New work post</p>
              <p className="text-sm text-[#687080]">
                Preview before publishing
              </p>
            </div>
            <button
              onClick={() => void publish()}
              disabled={busy}
              className="min-h-11 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? publishStage === 'preparing' ? "Preparing…" : publishStage === 'uploading' ? `${uploadProgress}%` : "Saving…" : "Publish"}
            </button>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-[48dvh] place-items-center bg-black">
              {previewIsVideo ? (
                <VideoPlayer src={preview} className="max-h-[60dvh] w-full bg-black object-contain" />
              ) : (
                <img
                  src={preview}
                  alt="Selected work preview"
                  className="max-h-[60dvh] w-full object-contain"
                />
              )}
            </div>
            <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  disabled={busy}
                  className="rounded-full border border-white/[.1] px-4 py-2 text-sm font-semibold"
                >
                  Replace media
                </button>
                <span className="self-center truncate text-sm text-[#6D7484]">
                  {file.name}
                </span>
              </div>
              <textarea
                value={caption}
                disabled={busy}
                onChange={(event) =>
                  setCaption(event.target.value.slice(0, 300))
                }
                rows={3}
                placeholder="Describe this work"
                className="w-full resize-none border-b border-white/[.1] bg-transparent py-3 text-sm outline-none focus:border-violet-500 disabled:opacity-50"
              />
              {jobsError && <div role="alert" className="text-sm text-[#A7ADBA]">Completed jobs could not be loaded. <button type="button" onClick={() => setJobsRetry(n => n + 1)} className="min-h-11 text-violet-300">Try again</button></div>}
              <select
                aria-label="Link completed job"
                value={bookingId}
                disabled={busy}
                onChange={(event) => setBookingId(event.target.value)}
                className="h-12 w-full border-b border-white/[.1] bg-[#08090D] text-xs outline-none disabled:opacity-50"
              >
                <option value="">Not linked to a completed WeHouse job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.booking_code || "Completed job"} ·{" "}
                    {job.service_type || "Service"}
                  </option>
                ))}
              </select>
              {bookingId && <p className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-sm leading-4 text-amber-200">The customer must confirm this work before the post is marked as a WeHouse job.</p>}
              {busy && (
                <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.05] p-4" aria-live="polite">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-violet-200">
                        {publishStage === "preparing" ? "Preparing your media" : publishStage === "uploading" ? "Uploading showcase media" : "Publishing your showcase"}
                      </p>
                      <p className="mt-1 text-xs text-[#777E8E]">
                        {publishStage === "uploading" ? "Keep this screen open until the upload completes." : "Saving your post."}
                      </p>
                    </div>
                    {publishStage === "uploading" && <span className="text-xs font-bold text-violet-200">{uploadProgress}%</span>}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
                    <div
                      className={`h-full rounded-full bg-violet-500 transition-[width] ${publishStage === "uploading" ? "" : "w-1/3 animate-pulse"}`}
                      style={publishStage === "uploading" ? { width: `${uploadProgress}%` } : undefined}
                    />
                  </div>
                </section>
              )}
            </div>
          </main>
        </div></ShowcaseComposer>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Work posts</h2>
        <button type="button" onClick={() => input.current?.click()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white" aria-label="Add work">Add work</button>
      </div>
      <label className="mb-4 block"><span className="sr-only">Post visibility</span><select aria-label="Post visibility" value={visibility} onChange={event => setVisibility(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-[#151820] px-3 text-sm"><option value="all">All posts</option><option value="visible">Not hidden</option><option value="hidden">Hidden posts</option></select></label>
      <WorkerShowcaseGrid owner posts={workPosts} loading={loading} error={showcase.error} onOpen={post => void openPost(post)} onRetry={() => void load()} more={showcase.more} loadingMore={showcase.loadingMore} onMore={() => void load(true)} />

      {viewer && (
        <WorkerShowcasePostViewer
          post={viewer}
          workerName={workerDisplayName(profile)}
          workerAvatar={workerAvatarUrl(profile)}
          onClose={() => setViewer(null)}
          position={workPosts.findIndex(post => post.id === viewer.id)} total={workPosts.length}
          onPrevious={workPosts.findIndex(post => post.id === viewer.id) > 0 ? () => void openPost(workPosts[workPosts.findIndex(post => post.id === viewer.id) - 1]) : undefined}
          onNext={workPosts.findIndex(post => post.id === viewer.id) >= 0 && workPosts.findIndex(post => post.id === viewer.id) < workPosts.length - 1 ? () => void openPost(workPosts[workPosts.findIndex(post => post.id === viewer.id) + 1]) : undefined}
          onRetry={async () => { const ready = await showcase.refreshPost(viewer); setViewer(current => current?.id === ready.id ? ready : current); }}
          ownerActions={<details key={viewer.id} className="relative"><summary aria-label="Post options" className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-xl text-xl">⋯</summary><div className="absolute right-0 top-12 z-30 min-w-40 rounded-xl border border-white/10 bg-[#151820] p-2 shadow-lg"><button type="button" onClick={() => void setHidden(viewer, !viewer.hidden_at)} disabled={busy} className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-[#D7DCE6] disabled:opacity-40">{viewer.hidden_at ? "Show on profile" : "Hide from profile"}</button><button type="button" onClick={() => void remove(viewer)} disabled={busy} className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-red-300 disabled:opacity-40">Delete post</button></div></details>}
        />
      )}
      <ConfirmDialog {...dialogProps} />
    </section>
  );
}

function ShowcaseComposer({ onClose, busy, children }: { onClose: () => void; busy: boolean; children: React.ReactNode }) {
  const dismiss = useRecordScreenBack(() => { if (!busy) onClose(); });
  const ref = useDialogInteraction(dismiss);
  return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="New work post" className="fixed inset-0 z-[100210] bg-[#08090D]">{children}</div>, document.body);
}

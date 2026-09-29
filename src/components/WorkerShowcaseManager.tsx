import WeHouseChoice from "@/components/WeHouseChoice";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useConfirm } from "@/hooks/useConfirm";
import type { Profile } from "@/types";
import { compressImageFile, uploadStorageObjectWithProgress } from "@/lib/supabase";
import { preparePublicVideo, PUBLIC_VIDEO_MAX_BYTES } from "@/lib/mediaVideo";
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
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishStage, setPublishStage] = useState<"idle" | "preparing" | "uploading" | "saving">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewer, setViewer] = useState<Post | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [savingCaption, setSavingCaption] = useState(false);

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
    const worker = profile.user_id; setMediaFailed(false); setViewer(post);
    if (post.url) return;
    try { const ready = await showcase.refreshPost(post); if (identity.current === worker) setViewer(current => current?.id === post.id ? ready : current); }
    catch { if (identity.current === worker) setMediaFailed(true); }
  }

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function chooseFile(selected: File) {
    const isVideo = selected.type.startsWith("video/");
    const isImage = selected.type.startsWith("image/");
    if (!isVideo && !isImage) return toast.error("Choose an image or video");
    if (selected.size > (isVideo ? 50_000_000 : 12 * 1024 * 1024)) {
      return toast.error(
        isVideo ? "Video must be under 50MB" : "Image must be under 12MB",
      );
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview("");
    if (!isVideo) { setFile(selected); setPreview(URL.createObjectURL(selected)); return; }
    setPreparingVideo(true);
    try {
      const prepared = await preparePublicVideo(selected);
      const ready = new File([prepared.body], `${selected.name.replace(/\.[^.]+$/, "")}.${prepared.extension}`, { type: prepared.contentType });
      setFile(ready);
      setPreview(URL.createObjectURL(ready));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Video could not be prepared");
    } finally { setPreparingVideo(false); }
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
      const preserveOriginal = ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size <= 1.5 * 1024 * 1024;
      const preparedVideo = isVideo ? await preparePublicVideo(file) : null;
      const uploadBody = preparedVideo?.body || (preserveOriginal ? file : await compressImageFile(file, 2560, 0.86, 1.8 * 1024 * 1024));
      if (uploadBody.size > (isVideo ? PUBLIC_VIDEO_MAX_BYTES : 2_000_000)) throw new Error("This work post is too large. Trim the video or choose a smaller photo.");
      const ext = preparedVideo?.extension || (preserveOriginal ? ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type] || 'jpg') : 'jpg');
      path = `${profile.user_id}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      setPublishStage("uploading");
      await uploadStorageObjectWithProgress(
        "worker-showcase",
        path,
        uploadBody,
        preparedVideo?.contentType || (preserveOriginal ? file.type : "image/jpeg"),
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

  async function saveCaption() {
    if (!editingPost || savingCaption) return;
    setSavingCaption(true);
    const { data, error } = await supabase.rpc('update_my_worker_showcase_caption', {
      p_post_id: editingPost.id, p_caption: editCaption.trim(),
    });
    setSavingCaption(false);
    if (error) return toast.error('Caption could not be saved. Please try again.');
    setViewer(current => current?.id === editingPost.id ? { ...current, caption: data || null } : current);
    setEditingPost(null);
    await load();
    toast.success('Caption updated');
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
          if (selected) void chooseFile(selected);
        }}
      />

      {preparingVideo && <p role="status" className="text-sm text-violet-200">Preparing a smaller video for preview…</p>}

      {file && (
        <ShowcaseComposer onClose={clearComposer} busy={busy}><div className="fixed inset-0 z-[100100] flex h-[100dvh] flex-col bg-[var(--wh-bg)]">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-3">
            <button
              type="button"
              onClick={clearComposer}
              disabled={busy}
              className="grid h-11 w-11 place-items-center rounded-full text-xl text-[var(--wh-text-secondary)]"
              aria-label="Close preview"
            >
              ×
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">New work post</p>
              <p className="text-sm text-[var(--wh-text-muted)]">
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
                  className="rounded-full border border-[var(--wh-border-subtle)] px-4 py-2 text-sm font-semibold"
                >
                  Replace media
                </button>
                <span className="self-center truncate text-sm text-[var(--wh-text-muted)]">
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
                className="w-full resize-none border-b border-[var(--wh-border-subtle)] bg-transparent py-3 text-sm outline-none focus:border-violet-500 disabled:opacity-50"
              />
              {jobsError && <div role="alert" className="text-sm text-[var(--wh-text-secondary)]">Completed jobs could not be loaded. <button type="button" onClick={() => setJobsRetry(n => n + 1)} className="min-h-11 text-violet-300">Try again</button></div>}
              <WeHouseChoice
                aria-label="Link completed job"
                value={bookingId}
                disabled={busy}
                onChange={(event) => setBookingId(event.target.value)}
                className="h-12 w-full border-b border-[var(--wh-border-subtle)] bg-[var(--wh-bg)] text-xs outline-none disabled:opacity-50"
              >
                <option value="">Not linked to a completed WeHouse job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.booking_code || "Completed job"} ·{" "}
                    {job.service_type || "Service"}
                  </option>
                ))}
              </WeHouseChoice>
              {bookingId && <p className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-3 text-sm leading-4 text-amber-200">The customer must confirm this work before the post is marked as a WeHouse job.</p>}
              {busy && (
                <section className="rounded-2xl border border-violet-500/15 bg-violet-500/[.05] p-4" aria-live="polite">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-violet-200">
                        {publishStage === "preparing" ? "Preparing your media" : publishStage === "uploading" ? "Uploading showcase media" : "Publishing your showcase"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--wh-text-muted)]">
                        {publishStage === "uploading" ? "Keep this screen open until the upload completes." : "Saving your post."}
                      </p>
                    </div>
                    {publishStage === "uploading" && <span className="text-xs font-bold text-violet-200">{uploadProgress}%</span>}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--wh-interactive)]">
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

      {editingPost && <ShowcaseComposer onClose={() => setEditingPost(null)} busy={savingCaption} label="Edit work post caption">
        <div className="fixed inset-0 z-[100210] flex h-[100dvh] flex-col bg-[var(--wh-bg)] text-[var(--wh-text)]">
          <header className="flex min-h-16 items-center gap-3 border-b border-[var(--wh-border-subtle)] px-4 pt-[env(safe-area-inset-top)]">
            <button type="button" onClick={() => setEditingPost(null)} disabled={savingCaption} className="min-h-11 text-sm text-[var(--wh-text-secondary)]">Cancel</button>
            <h2 className="flex-1 text-center text-base font-semibold">Edit caption</h2>
            <button type="button" onClick={() => void saveCaption()} disabled={savingCaption} className="min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{savingCaption ? 'Saving…' : 'Save'}</button>
          </header>
          <div className="mx-auto w-full max-w-xl px-5 py-6">
            <p className="text-sm text-[var(--wh-text-secondary)]">Update the story behind your work. Its media, job confirmation and reactions stay with this post.</p>
            <textarea autoFocus aria-label="Work post caption" value={editCaption} maxLength={300} rows={6} onChange={event => setEditCaption(event.target.value)} className="mt-5 w-full resize-none rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 text-base outline-none focus:border-violet-500" />
            <p className="mt-2 text-right text-xs text-[var(--wh-text-secondary)]">{editCaption.length} / 300</p>
          </div>
        </div>
      </ShowcaseComposer>}

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--wh-text-secondary)]">{posts.length} {posts.length === 1 ? "post" : "posts"}</p>
        <button type="button" onClick={() => input.current?.click()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white shadow-lg shadow-violet-950/25" aria-label="Add work">Add work</button>
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Post visibility">
        {([{ value: 'all', label: 'All' }, { value: 'visible', label: 'Published' }, { value: 'hidden', label: 'Hidden' }] as const).map(option => <button key={option.value} type="button" role="tab" aria-selected={visibility === option.value} onClick={() => setVisibility(option.value)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${visibility === option.value ? 'bg-violet-500 text-white' : 'border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] text-[var(--wh-text-secondary)]'}`}>{option.label}</button>)}
      </div>
      <WorkerShowcaseGrid owner posts={workPosts} loading={loading} error={showcase.error} onOpen={post => void openPost(post)} onRetry={() => void load()} more={showcase.more} loadingMore={showcase.loadingMore} onMore={() => void load(true)} />

      {viewer && !editingPost && (
        <WorkerShowcasePostViewer
          post={viewer}
          workerName={workerDisplayName(profile)}
          workerAvatar={workerAvatarUrl(profile)}
          ownerView
          onClose={() => setViewer(null)}
          position={workPosts.findIndex(post => post.id === viewer.id)} total={workPosts.length}
          onPrevious={workPosts.findIndex(post => post.id === viewer.id) > 0 ? () => void openPost(workPosts[workPosts.findIndex(post => post.id === viewer.id) - 1]) : undefined}
          onNext={workPosts.findIndex(post => post.id === viewer.id) >= 0 && workPosts.findIndex(post => post.id === viewer.id) < workPosts.length - 1 ? () => void openPost(workPosts[workPosts.findIndex(post => post.id === viewer.id) + 1]) : undefined}
          mediaError={mediaFailed}
          onRetry={async () => { setMediaFailed(false); const ready = await showcase.refreshPost(viewer); setViewer(current => current?.id === ready.id ? ready : current); }}
          ownerActions={<details key={viewer.id} className="relative"><summary aria-label="Post options" className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-xl text-xl">⋯</summary><div className="absolute right-0 top-12 z-30 min-w-40 rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] p-2 shadow-lg"><button type="button" onClick={() => { setEditCaption(viewer.caption || ''); setEditingPost(viewer); }} disabled={busy} className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-[var(--wh-text)] disabled:opacity-40">Edit caption</button><button type="button" onClick={() => void setHidden(viewer, !viewer.hidden_at)} disabled={busy} className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-[var(--wh-text)] disabled:opacity-40">{viewer.hidden_at ? "Show on profile" : "Hide from profile"}</button><button type="button" onClick={() => void remove(viewer)} disabled={busy} className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-red-600 dark:text-red-300 disabled:opacity-40">Delete post</button></div></details>}
        />
      )}
      <ConfirmDialog {...dialogProps} />
    </section>
  );
}

function ShowcaseComposer({ onClose, busy, children, label = 'New work post' }: { onClose: () => void; busy: boolean; children: React.ReactNode; label?: string }) {
  const dismiss = useRecordScreenBack(() => { if (!busy) onClose(); });
  const ref = useDialogInteraction(dismiss);
  return createPortal(<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[100210] bg-[var(--wh-bg)]">{children}</div>, document.body);
}

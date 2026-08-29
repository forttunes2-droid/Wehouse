import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useConfirm } from "@/hooks/useConfirm";
import type { Profile } from "@/types";

type Post = {
  id: string;
  worker_id: string;
  kind: "story" | "portfolio";
  media_type: "image" | "video";
  storage_path: string;
  caption: string | null;
  booking_id: string | null;
  verified_job: boolean;
  expires_at: string | null;
  created_at: string;
  url?: string;
};

type Job = {
  id: string;
  booking_code: string | null;
  service_type: string | null;
};

export default function WorkerShowcaseManager({
  profile,
}: {
  profile: Profile;
}) {
  const { ask, dialogProps } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const kind = "portfolio" as const;
  const [caption, setCaption] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<Post | null>(null);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: completed }] = await Promise.all([
      supabase
        .from("worker_showcase_posts")
        .select(
          "id,worker_id,kind,media_type,storage_path,caption,booking_id,verified_job,expires_at,created_at",
        )
        .eq("worker_id", profile.user_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("worker_bookings")
        .select("id,booking_code,service_type")
        .eq("worker_id", profile.user_id)
        .eq("status", "approved_released")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    const enriched = await Promise.all(
      ((rows || []) as Post[]).map(async (row) => {
        const { data } = await supabase.storage
          .from("worker-showcase")
          .createSignedUrl(row.storage_path, 3600);
        return { ...row, url: data?.signedUrl || "" } as Post;
      }),
    );

    setPosts(enriched);
    setJobs((completed || []) as Job[]);
  }, [profile.user_id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function publish() {
    if (!file) return toast.error("Choose a photo or video first");
    if (profile.worker_status !== "verified" || !profile.worker_verified) {
      return toast.error(
        "Finish WeHouse professional verification before publishing work",
      );
    }

    const isVideo = file.type.startsWith("video/");
    setBusy(true);
    let path = "";
    try {
      const ext = (
        file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")
      ).toLowerCase();
      path = `${profile.user_id}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("worker-showcase")
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc("create_my_worker_showcase_post", {
        p_kind: kind,
        p_media_type: isVideo ? "video" : "image",
        p_storage_path: path,
        p_caption: caption.trim() || null,
        p_booking_id: bookingId || null,
      });
      if (error) throw error;

      toast.success("Work published");
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
      setBusy(false);
    }
  }

  async function remove(post: Post) {
    if (
      !(await ask({
        title: "Remove this work?",
        description: "It will no longer appear to customers.",
        confirmLabel: "Remove",
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

  const portfolio = posts.filter((post) => post.kind === "portfolio");
  const previewIsVideo = file?.type.startsWith("video/") || false;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">
            MY WORK
          </p>
          <h2 className="mt-1 text-xl font-bold">Your work</h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[#6C7282]">
            Publish photos or videos of your work. Posts remain until you remove
            them, and completed WeHouse jobs can be linked as verified work.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-[#6E7483]">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Public professional content</span>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-white/[.07] pb-3">
        <p className="text-xs font-semibold">Published work</p>
        <span className="text-[9px] text-[#686F80]">{portfolio.length}</span>
      </div>

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
        <div className="fixed inset-0 z-[90] flex h-[100dvh] flex-col bg-[#08090D]">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[.08] px-3">
            <button
              type="button"
              onClick={clearComposer}
              disabled={busy}
              className="grid h-10 w-10 place-items-center rounded-full text-xl text-[#A8ADBA]"
              aria-label="Close preview"
            >
              ×
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">New work post</p>
              <p className="text-[9px] text-[#687080]">
                Preview before publishing
              </p>
            </div>
            <button
              onClick={() => void publish()}
              disabled={busy}
              className="rounded-full bg-violet-500 px-4 py-2 text-[10px] font-semibold disabled:opacity-50"
            >
              {busy ? "Publishing…" : "Publish"}
            </button>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-[48dvh] place-items-center bg-black">
              {previewIsVideo ? (
                <video
                  src={preview}
                  controls
                  playsInline
                  className="max-h-[60dvh] w-full object-contain"
                />
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
                  className="rounded-full border border-white/[.1] px-4 py-2 text-[10px] font-semibold"
                >
                  Replace media
                </button>
                <span className="self-center truncate text-[9px] text-[#6D7484]">
                  {file.name}
                </span>
              </div>
              <textarea
                value={caption}
                onChange={(event) =>
                  setCaption(event.target.value.slice(0, 300))
                }
                rows={3}
                placeholder="Describe this work"
                className="w-full resize-none border-b border-white/[.1] bg-transparent py-3 text-sm outline-none focus:border-violet-500"
              />
              <select
                value={bookingId}
                onChange={(event) => setBookingId(event.target.value)}
                className="h-12 w-full border-b border-white/[.1] bg-[#08090D] text-xs outline-none"
              >
                <option value="">Not linked to a completed WeHouse job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.booking_code || "Completed job"} ·{" "}
                    {job.service_type || "Service"}
                  </option>
                ))}
              </select>
              {busy && (
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[.08]">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-violet-500" />
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-bold">Work feed</h3>
          <p className="mt-1 text-[9px] text-[#666D7E]">
            Your public professional posts
          </p>
        </div>
        {portfolio.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {portfolio.map((post) => (
              <button
                key={post.id}
                onClick={() => setViewer(post)}
                className="relative overflow-hidden rounded-2xl border border-white/[.06] bg-[#0D1118] text-left"
              >
                <Media
                  post={post}
                  className="aspect-[4/3] w-full object-cover"
                />
                {post.verified_job && (
                  <span className="absolute left-2 top-2 rounded-full bg-emerald-500 px-2 py-1 text-[7px] font-bold text-[#04100B]">
                    WEHOUSE JOB ✓
                  </span>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-[9px] text-[#A0A5B2]">
                    {post.caption || "Professional work"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyWork
            title="No work posted yet"
            text="Add a photo or video to build your professional work feed."
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-violet-500 text-3xl font-light text-white shadow-2xl shadow-violet-950/60 sm:bottom-6 sm:right-8"
        aria-label="Add work"
      >
        ＋
      </button>

      {viewer && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/90 p-4"
          onClick={() => setViewer(null)}
        >
          <div
            className="w-full max-w-md"
            onClick={(event) => event.stopPropagation()}
          >
            <Media
              post={viewer}
              className="max-h-[70dvh] w-full rounded-3xl bg-black object-contain"
              controls
            />
            <div className="mt-3 rounded-2xl bg-[#11151D] p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">
                    {viewer.kind === "story" ? "Work Status" : "Portfolio work"}
                    {viewer.verified_job
                      ? " · Completed through WeHouse ✓"
                      : ""}
                  </p>
                  {viewer.caption && (
                    <p className="mt-1 text-[10px] leading-relaxed text-[#858B9A]">
                      {viewer.caption}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void remove(viewer)}
                  className="text-[10px] font-semibold text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog {...dialogProps} />
    </section>
  );
}

function EmptyWork({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/10 text-2xl text-violet-300">
        ＋
      </div>
      <p className="mt-4 text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[10px] leading-5 text-[#686F80]">
        {text}
      </p>
    </div>
  );
}

function Media({
  post,
  className,
  controls = false,
}: {
  post: Post;
  className: string;
  controls?: boolean;
}) {
  if (post.media_type === "video")
    return (
      <video
        src={post.url}
        className={className}
        controls={controls}
        playsInline
        muted={!controls}
      />
    );
  return <img src={post.url} alt="Worker work" className={className} />;
}

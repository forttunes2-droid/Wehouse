import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import GoldTickBadge from "@/components/GoldTickBadge";
import { supabase } from "@/lib/supabase";
import { workerServiceNames } from "@/lib/workerTaxonomy";
import {
  workerAvatarUrl,
  workerDisplayName,
  workerInitial,
  workerRoleLabel,
} from "@/lib/workerIdentity";
import type { Profile } from "@/types";
import MediaViewer from "@/components/MediaViewer";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import ShowcaseMediaThumbnail from "@/components/ShowcaseMediaThumbnail";
import WorkerShowcasePostViewer from "@/components/WorkerShowcasePostViewer";

type Post = {
  id: string;
  kind: "work_post";
  media_type: "image" | "video";
  storage_path: string;
  caption: string | null;
  verified_job: boolean;
  expires_at: string | null;
  created_at: string;
  url?: string;
};
type Trust = {
  reviewed?: boolean;
  trusted?: boolean;
  trusted_enabled?: boolean;
  completed_jobs?: number;
  rating?: number;
  review_count?: number;
  worker_cancel_rate?: number;
  open_disputes?: number;
  label?: string;
};
type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name: string;
  service_name: string;
};
type PostReaction = {
  post_id: string;
  emoji: string;
  reaction_count: number;
  mine: boolean;
};
type Props = {
  worker: Profile;
  onBack: () => void;
  onBook: () => void;
  bookingActive?: boolean;
  onOpenBooking?: () => void;
  showBookingAction?: boolean;
  communicationActions?: ReactNode;
};

export default function WorkerPublicProfileV2({
  worker,
  onBack,
  onBook,
  bookingActive = false,
  onOpenBooking,
  showBookingAction = true,
  communicationActions,
}: Props) {
  const [posts, setPosts] = useState<Post[]>([]),
    [viewer, setViewer] = useState<Post | null>(null),
    [avatarOpen, setAvatarOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [trust, setTrust] = useState<Trust | null>(null),
    [reviews, setReviews] = useState<PublicReview[]>([]),
    [postReactions, setPostReactions] = useState<
      Record<string, { counts: Record<string, number>; mine: string | null }>
    >({});
  async function openPost(post: Post) {
    if (post.url) return setViewer(post);
    const { data, error } = await supabase.storage
      .from("worker-showcase")
      .createSignedUrl(post.storage_path, 3600);
    if (error || !data?.signedUrl)
      return toast.error(
        "This work post could not be opened. Please try again.",
      );
    const readyPost = { ...post, url: data.signedUrl };
    setPosts((current) =>
      current.map((item) => (item.id === post.id ? readyPost : item)),
    );
    setViewer(readyPost);
  }
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("wehouse:nested-screen", { detail: { open: true } }),
    );
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let active = true;
    void (async () => {
      const [
        { data: rows },
        { data: trustData },
        { data: reviewRows },
        { data: reactionRows },
      ] = await Promise.all([
        supabase
          .from("worker_showcase_posts")
          .select(
            "id,kind,media_type,storage_path,caption,verified_job,expires_at,created_at",
          )
          .eq("worker_id", worker.user_id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.rpc("get_worker_marketplace_trust", {
          p_worker_id: worker.user_id,
        }),
        supabase.rpc("get_public_worker_reviews", {
          p_worker_id: worker.user_id,
          p_limit: 20,
        }),
        supabase.rpc("get_worker_showcase_reactions", {
          p_worker_id: worker.user_id,
        }),
      ]);
      const sourceRows = (rows || []) as Post[];
      const signed = sourceRows.length
        ? await supabase.storage
            .from("worker-showcase")
            .createSignedUrls(sourceRows.map((row) => row.storage_path), 3600)
        : { data: [], error: null };
      const urls = new Map(
        (signed.data || []).map((item) => [item.path, item.signedUrl || ""]),
      );
      const enriched = sourceRows.map((row) => ({
        ...row,
        url: urls.get(row.storage_path) || "",
      }));
      if (active) {
        setPosts(enriched);
        setTrust((trustData || null) as Trust | null);
        setReviews((reviewRows || []) as PublicReview[]);
        const grouped: Record<
          string,
          { counts: Record<string, number>; mine: string | null }
        > = {};
        for (const reaction of (reactionRows || []) as PostReaction[]) {
          grouped[reaction.post_id] ||= { counts: {}, mine: null };
          grouped[reaction.post_id].counts[reaction.emoji] = Number(
            reaction.reaction_count || 0,
          );
          if (reaction.mine) grouped[reaction.post_id].mine = reaction.emoji;
        }
        setPostReactions(grouped);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
      window.dispatchEvent(
        new CustomEvent("wehouse:nested-screen", { detail: { open: false } }),
      );
    };
  }, [worker.user_id]);
  const skills = workerServiceNames(worker),
    occupation = workerRoleLabel(worker),
    displayName = workerDisplayName(worker),
    avatarUrl = workerAvatarUrl(worker),
    workPosts = posts.filter((post) => post.kind === "work_post"),
    rating = Number(trust?.rating ?? 0) || 0,
    reviewCount = Number(trust?.review_count ?? 0) || 0;
  return createPortal(
    <div
      className={`fixed inset-0 z-[100100] isolate overflow-y-auto bg-[#0A0A0F] text-white ${showBookingAction ? "pb-24" : "pb-8"}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} profile`}
    >
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0A0A0F]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="mt-0.5 truncate text-[9px] text-[#777D8D]">
              {occupation}
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-5">
        <section className="py-2">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => avatarUrl && setAvatarOpen(true)}
              className="shrink-0 rounded-full"
              aria-label={
                avatarUrl ? `Preview ${displayName}'s profile photo` : undefined
              }
            >
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-violet-600 text-2xl font-bold">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  workerInitial(worker)
                )}
              </div>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-xl font-bold">{displayName}</h1>
                {trust?.reviewed && (
                  <GoldTickBadge title="Gold Tick · WeHouse reviewed service worker" />
                )}
              </div>
              <p className="mt-1 text-xs text-[#A5ABB8]">{occupation}</p>
              <p className="mt-1 text-[10px] text-[#72798A]">
                {[worker.city || worker.local_government, worker.state]
                  .filter(Boolean)
                  .join(", ") || "Location not shown"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {trust?.reviewed && (
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold text-emerald-300">
                    {trust.trusted
                      ? "WeHouse Trusted · earned performance tier"
                      : "WeHouse Reviewed · Gold Tick"}
                  </span>
                )}
                {worker.worker_price && (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold text-emerald-300">
                    From ₦{Number(worker.worker_price).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-5 border-t border-white/[.06] pt-4">
            <h2 className="text-[9px] font-bold uppercase tracking-[.14em] text-[#73798A]">
              About
            </h2>
            <p className="mt-2 whitespace-pre-line text-xs leading-6 text-[#A6ABB8]">
              {worker.worker_bio
                ? cleanBio(worker.worker_bio)
                : "This professional has not added an introduction yet."}
            </p>
            {skills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-white/[.045] px-2.5 py-1.5 text-[9px] text-[#BCC0CA]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>
          {communicationActions ? (
            <div className="mt-5 flex gap-5 border-t border-white/[.06] pt-4">
              {communicationActions}
            </div>
          ) : null}
        </section>
        <section className="grid grid-cols-3 border-y border-white/[.06]">
          <ProfileFact
            label="Verification"
            value={trust?.reviewed ? "Reviewed" : "Pending"}
          />
          <ProfileFact
            label="Rating"
            value={rating > 0 ? `${rating.toFixed(1)} · ${reviewCount}` : "New"}
          />
          <ProfileFact
            label="Jobs"
            value={String(Number(trust?.completed_jobs || 0))}
          />
        </section>
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold">Showcase</h2>
          </div>
          {loading ? (
            <div
              className="min-h-24"
              role="status"
              aria-label="Loading work posts"
            />
          ) : workPosts.length === 0 ? (
            <Empty text="This worker has not published any work posts yet." />
          ) : (
            <div className="-mx-4 grid grid-cols-2 gap-0.5 bg-white/[.08] sm:mx-0 sm:grid-cols-3 sm:overflow-hidden sm:rounded-2xl">
              {workPosts.map((post) => (
                <article key={post.id} className="group relative aspect-square min-w-0 overflow-hidden bg-black [content-visibility:auto]">
                  <button
                    onClick={() => void openPost(post)}
                    className="relative block h-full w-full overflow-hidden bg-black text-left"
                    aria-label={`Open work sample${post.caption ? `: ${post.caption}` : ""}`}
                  >
                    <Media
                      post={post}
                      className="h-full w-full object-cover transition duration-300 group-active:scale-[.99]"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-2.5 pb-2.5 pt-8">
                      {post.verified_job ? <span className="mb-1 block text-[7px] font-bold uppercase tracking-wide text-emerald-300">Verified WeHouse job</span> : null}
                      <span className="line-clamp-2 block text-[9px] leading-4 text-white">{post.caption || "Work sample"}</span>
                    </span>
                  </button>
                  {reactionTotal(postReactions[post.id]?.counts) > 0 ? (
                    <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[8px] font-semibold text-white backdrop-blur">
                      ♥ {reactionTotal(postReactions[post.id]?.counts)}
                    </span>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Customer reviews</h2>
              <p className="mt-1 text-[9px] text-[#666D7E]">
                Verified reviews from completed WeHouse jobs.
              </p>
            </div>
            {reviewCount > 0 && (
              <p className="text-xs font-semibold text-amber-300">
                ★ {rating.toFixed(1)} · {reviewCount}
              </p>
            )}
          </div>
          {reviews.length ? (
            <div className="divide-y divide-white/[.06] border-y border-white/[.06]">
              {reviews.map((review) => (
                <article key={review.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">
                        {review.reviewer_name}
                      </p>
                      <p className="mt-1 text-[9px] text-[#686F80]">
                        {review.service_name} ·{" "}
                        {new Date(review.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <p className="text-[10px] font-semibold text-amber-300">
                      {"★".repeat(Number(review.rating))}
                    </p>
                  </div>
                  {review.comment && (
                    <p className="mt-3 whitespace-pre-wrap text-[11px] leading-5 text-[#A5AAB7]">
                      {review.comment}
                    </p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty text="No customer reviews yet. Reviews appear only after completed WeHouse jobs." />
          )}
        </section>
      </main>
      {showBookingAction ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.08] bg-[#090B12]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto max-w-4xl">
            <button
              onClick={bookingActive ? onOpenBooking : onBook}
              className={`h-12 w-full rounded-2xl text-xs font-semibold ${bookingActive ? "border border-amber-500/20 bg-amber-500/[.07] text-amber-300" : "bg-violet-500 text-white"}`}
            >
              {bookingActive ? "Open service booking" : "Request service"}
            </button>
          </div>
        </div>
      ) : null}
      {viewer && (
        <WorkerShowcasePostViewer
          post={viewer}
          workerName={displayName}
          workerAvatar={avatarUrl}
          liked={Boolean(postReactions[viewer.id]?.mine)}
          likeCount={reactionTotal(postReactions[viewer.id]?.counts)}
          onClose={() => setViewer(null)}
          onLike={async () => {
            const previous = postReactions[viewer.id]?.mine;
            const next = previous ? null : "♥";
            const { data, error } = await supabase.rpc(
              "set_my_worker_showcase_reaction",
              { p_post_id: viewer.id, p_emoji: next },
            );
            if (error) {
              toast.error(error.message || "Like could not be saved");
              return;
            }
            setPostReactions((current) => ({
              ...current,
              [viewer.id]: {
                counts: (data || {}) as Record<string, number>,
                mine: next,
              },
            }));
          }}
        />
      )}
      {avatarOpen && avatarUrl ? (
        <MediaViewer
          src={avatarUrl}
          kind="image"
          title={displayName}
          subtitle={occupation}
          onClose={() => setAvatarOpen(false)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
function Media({ post, className }: { post: Post; className: string }) {
  return <ShowcaseMediaThumbnail src={post.url} mediaType={post.media_type} alt="Worker work" className={className} />;
}
function reactionTotal(counts?: Record<string, number>) {
  return Object.values(counts || {}).reduce((total, value) => total + Number(value || 0), 0);
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center text-[10px] text-[#666D7E]">
      {text}
    </div>
  );
}
function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-white/[.06] px-3 py-4 text-center last:border-r-0">
      <p className="truncate text-[10px] font-semibold text-[#D5D8E0]">
        {value}
      </p>
      <p className="mt-1 text-[8px] text-[#666D7E]">{label}</p>
    </div>
  );
}
function cleanBio(value: string) {
  return String(value || "")
    .split(/\n\s*Services\s+Offered\s*:/i)[0]
    .trim();
}

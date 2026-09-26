import { useEffect, useRef, useState, type ReactNode } from "react";
import WorkerTrustBadge from "@/components/WorkerTrustBadge";
import GoldTickBadge from "@/components/GoldTickBadge";
import { supabase } from "@/lib/supabase";
import { workerServiceNames } from "@/lib/workerTaxonomy";
import {
  workerAvatarUrl,
  workerDisplayName,
  workerRoleLabel,
} from "@/lib/workerIdentity";
import type { Profile } from "@/types";
import { toast } from "sonner";
import WorkerShowcaseGrid from "@/components/WorkerShowcaseGrid";
import { useWorkerShowcase, type ShowcasePost } from "@/hooks/useWorkerShowcase";
import { withTimeout } from "@/lib/withTimeout";
import WorkerShowcasePostViewer from "@/components/WorkerShowcasePostViewer";
import PublicProfileSurface from "@/components/PublicProfileSurface";

type Post = ShowcasePost;
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
  safetyAction?: ReactNode;
};

export default function WorkerPublicProfileV2(props: Props) {
  const context = !props.showBookingAction && Boolean(props.communicationActions) ? "conversation" : "public";
  return <WorkerProfileContent key={`${props.worker.user_id}:${context}`} {...props} />;
}
function WorkerProfileContent({
  worker,
  onBack,
  onBook,
  bookingActive = false,
  onOpenBooking,
  showBookingAction = true,
  communicationActions,
  safetyAction,
}: Props) {
  const privateConversationMode = !showBookingAction && Boolean(communicationActions);
  const showcase = useWorkerShowcase(worker.user_id, false, !privateConversationMode);
  const [viewer, setViewer] = useState<Post | null>(null), [section, setSection] = useState<"work" | "reviews">("work");
  const [trust, setTrust] = useState<Trust | null>(null), [reviews, setReviews] = useState<PublicReview[]>([]);
  const [reviewLoading, setReviewLoading] = useState(true), [reviewError, setReviewError] = useState(""), [trustError, setTrustError] = useState("");
  const [attempt, setAttempt] = useState(0), [postReactions, setPostReactions] = useState<Record<string, { counts: Record<string, number>; mine: string | null }>>({});
  const activeWorker = useRef(worker.user_id); activeWorker.current = worker.user_id;
  const openSequence = useRef(0);
  async function openPost(post: Post) {
    const request = ++openSequence.current, identity = worker.user_id;
    setViewer(post);
    if (post.url) return;
    try { const ready = await showcase.refreshPost(post); if (request === openSequence.current && activeWorker.current === identity) setViewer(ready); }
    catch { if (request === openSequence.current) toast.error("This work post could not be opened. Please try again."); }
  }
  useEffect(() => { setViewer(null); setSection("work"); openSequence.current++; }, [worker.user_id, privateConversationMode]);
  useEffect(() => {
    let active = true;
    setTrust(null); setReviews([]); setPostReactions({}); setReviewError(""); setTrustError(""); setReviewLoading(!privateConversationMode);
    if (privateConversationMode) return;
    void withTimeout(supabase.rpc("get_worker_marketplace_trust", { p_worker_id: worker.user_id }), 15000, "Profile totals took too long.").then(result => {
      if (!active) return;
      if (result.error || !result.data) setTrustError("Profile totals are unavailable."); else setTrust(result.data as Trust);
    }).catch(() => { if (active) setTrustError("Profile totals are unavailable."); });
    void withTimeout(supabase.rpc("get_public_worker_reviews", { p_worker_id: worker.user_id, p_limit: 20 }), 15000, "Reviews took too long.").then(result => {
      if (!active) return;
      if (result.error || !Array.isArray(result.data)) setReviewError("Reviews could not be loaded."); else setReviews(result.data as PublicReview[]);
    }).catch(() => { if (active) setReviewError("Reviews could not be loaded."); }).finally(() => { if (active) setReviewLoading(false); });
    void withTimeout(supabase.rpc("get_worker_showcase_reactions", { p_worker_id: worker.user_id }), 15000, "Reactions took too long.").then(result => {
      if (!active || result.error) return;
      const grouped: Record<string, { counts: Record<string, number>; mine: string | null }> = {};
      for (const reaction of (result.data || []) as PostReaction[]) { grouped[reaction.post_id] ||= { counts: {}, mine: null }; grouped[reaction.post_id].counts[reaction.emoji] = Number(reaction.reaction_count || 0); if (reaction.mine) grouped[reaction.post_id].mine = reaction.emoji; }
      setPostReactions(grouped);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [worker.user_id, privateConversationMode, attempt]);

  const skills = workerServiceNames(worker),
    occupation = workerRoleLabel(worker),
    displayName = workerDisplayName(worker),
    avatarUrl = workerAvatarUrl(worker),
    workPosts = showcase.posts,
    rating = Number(trust?.rating ?? 0) || 0,
    reviewCount = Number(trust?.review_count ?? 0) || 0;

  if (privateConversationMode) {
    const verified = Boolean((worker as Profile & { worker_verified?: boolean }).worker_verified);
    return (
      <PublicProfileSurface
        conversation
        name={displayName}
        username={worker.username}
        avatar={avatarUrl}
        subtitle={occupation}
        onClose={onBack}
        actions={communicationActions}
        badges={
          <>
            {verified ? <WorkerTrustBadge /> : null}
            {worker.pro_active ? <GoldTickBadge size="sm" title="Worker PRO membership" /> : null}
          </>
        }
      >
        {safetyAction ? <section className="pt-1">{safetyAction}</section> : null}
      </PublicProfileSurface>
    );
  }

  return (
    <PublicProfileSurface
      name={displayName}
      username={worker.username}
      avatar={avatarUrl}
      subtitle={occupation}
      location={[worker.city || worker.local_government, worker.state].filter(Boolean).join(", ") || "Location not shown"}
      about={worker.worker_bio ? cleanBio(worker.worker_bio) : undefined}
      onClose={onBack}
      maxWidth="4xl"
      actions={communicationActions}
      badges={<>{trust?.reviewed ? <WorkerTrustBadge trusted={trust.trusted} /> : null}{worker.pro_active ? <GoldTickBadge size="sm" title="Worker PRO membership" /> : null}{worker.worker_price ? <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">From ₦{Number(worker.worker_price).toLocaleString()}</span> : null}</>}
      bottomAction={showBookingAction ? <button onClick={bookingActive ? onOpenBooking : onBook} className={`h-12 w-full rounded-2xl text-sm font-semibold ${bookingActive ? "border border-amber-500/20 bg-amber-500/[.07] text-amber-300" : "bg-violet-500 text-white"}`}>{bookingActive ? "Open service booking" : "Request service"}</button> : undefined}
    >
      {trust ? <section className="flex flex-wrap gap-x-6 gap-y-2 border-y border-white/10 py-4 text-sm text-[#BCC2CF]">
        {reviewCount > 0 && <span>★ {rating.toFixed(1)} · {reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span>}<span>{Number(trust.completed_jobs || 0)} completed jobs</span>
      </section> : trustError ? <p className="text-sm text-[#A7ADBA]">{trustError} <button type="button" onClick={() => setAttempt(n => n + 1)} className="min-h-11 text-violet-300">Try again</button></p> : null}
      {skills.length > 1 ? <section><h2 className="text-sm font-semibold text-[#D6DBE5]">Services</h2><p className="mt-2 text-sm leading-6 text-[#A7ADBA]">{skills.join(" · ")}</p></section> : null}
      <div role="tablist" aria-label="Worker profile content" className="flex border-b border-white/10">{([['work', 'Work posts'], ['reviews', 'Reviews']] as const).map(([key, label]) => <button key={key} type="button" role="tab" id={`worker-${key}-tab`} aria-controls={`worker-${key}-panel`} aria-selected={section === key} tabIndex={section === key ? 0 : -1} onClick={() => setSection(key)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'work' : event.key === 'End' ? 'reviews' : section === 'work' ? 'reviews' : 'work'; setSection(next); document.getElementById(`worker-${next}-tab`)?.focus(); } }} className={`min-h-12 flex-1 border-b-2 px-4 text-sm font-medium ${section === key ? "border-violet-400 text-violet-200" : "border-transparent text-[#A7ADBA]"}`}>{label}</button>)}</div>
      {section === "work" ? <section role="tabpanel" id="worker-work-panel" aria-labelledby="worker-work-tab"><WorkerShowcaseGrid posts={workPosts} loading={showcase.loading} error={showcase.error} onOpen={post => void openPost(post)} onRetry={() => void showcase.load()} more={showcase.more} loadingMore={showcase.loadingMore} onMore={() => void showcase.load(true)} /></section> : <section role="tabpanel" id="worker-reviews-panel" aria-labelledby="worker-reviews-tab">
        {reviewLoading ? <p role="status" className="py-8 text-sm text-[#A7ADBA]">Loading reviews…</p> : reviewError ? <div role="alert" className="py-6 text-sm text-[#A7ADBA]">{reviewError}<button type="button" onClick={() => setAttempt(n => n + 1)} className="ml-2 min-h-11 text-violet-300">Try again</button></div> : reviews.length ? <div className="divide-y divide-white/10">{reviews.map(review => <article key={review.id} className="py-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{review.reviewer_name}</p><p className="mt-1 text-xs text-[#A7ADBA]">{review.service_name} · {new Date(review.created_at).toLocaleDateString()}</p></div><p aria-label={`${review.rating} out of 5`} className="text-sm text-amber-300">{"★".repeat(Math.max(0, Math.min(5, Number(review.rating))))}</p></div>{review.comment && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#BCC2CF]">{review.comment}</p>}</article>)}</div> : <p className="py-10 text-center text-sm text-[#A7ADBA]">No customer reviews yet.</p>}
      </section>}
      {safetyAction ? <section className="mt-7 border-t border-white/[.07] pt-5">{safetyAction}</section> : null}
      {viewer && (
        <WorkerShowcasePostViewer
          post={viewer}
          workerName={displayName}
          workerAvatar={avatarUrl}
          liked={Boolean(postReactions[viewer.id]?.mine)}
          likeCount={reactionTotal(postReactions[viewer.id]?.counts)}
          onClose={() => { openSequence.current++; setViewer(null); }}
          position={workPosts.findIndex(post => post.id === viewer.id)} total={workPosts.length}
          onPrevious={workPosts.findIndex(post => post.id === viewer.id) > 0 ? () => void openPost(workPosts[workPosts.findIndex(post => post.id === viewer.id) - 1]) : undefined}
          onNext={workPosts.findIndex(post => post.id === viewer.id) >= 0 && workPosts.findIndex(post => post.id === viewer.id) < workPosts.length - 1 ? () => void openPost(workPosts[workPosts.findIndex(post => post.id === viewer.id) + 1]) : undefined}
          onRetry={async () => { const ready = await showcase.refreshPost(viewer); setViewer(current => current?.id === ready.id ? ready : current); }}
          onOpenProfile={() => setViewer(null)}
          onLike={async () => {
            const previous = postReactions[viewer.id]?.mine;
            const next = previous ? null : "♥";
            const { data, error } = await supabase.rpc("set_my_worker_showcase_reaction", { p_post_id: viewer.id, p_emoji: next });
            if (error) {
              throw new Error(error.message || "Like could not be saved");
            }
            setPostReactions((current) => ({
              ...current,
              [viewer.id]: { counts: (data || {}) as Record<string, number>, mine: next },
            }));
          }}
        />
      )}
    </PublicProfileSurface>
  );
}
function reactionTotal(counts?: Record<string, number>) {
  return Object.values(counts || {}).reduce((total, value) => total + Number(value || 0), 0);
}
function cleanBio(value: string) {
  return String(value || "").split(/\n\s*Services\s+Offered\s*:/i)[0].trim();
}

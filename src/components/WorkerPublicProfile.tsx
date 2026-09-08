import { useEffect, useState } from "react";
import GoldTickBadge from "@/components/GoldTickBadge";
import { supabase } from "@/lib/supabase";
import { workerOccupation, workerServiceNames } from "@/lib/workerTaxonomy";
import type { Profile } from "@/types";
import VideoPlayer from "@/components/VideoPlayer";
import { toast } from "sonner";

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
type PublicReview={id:string;rating:number;comment:string|null;created_at:string;reviewer_name:string;service_name:string};
type PostReaction = { post_id: string; emoji: string; reaction_count: number; mine: boolean };
type Props = {
  worker: Profile;
  onBack: () => void;
  onBook: () => void;
  bookingActive?: boolean;
  onOpenBooking?: () => void;
};

export default function WorkerPublicProfileV2({
  worker,
  onBack,
  onBook,
  bookingActive = false,
  onOpenBooking,
}: Props) {
  const [posts, setPosts] = useState<Post[]>([]),
    [viewer, setViewer] = useState<Post | null>(null),
    [loading, setLoading] = useState(true),
    [trust, setTrust] = useState<Trust | null>(null),
    [reviews,setReviews]=useState<PublicReview[]>([]),
    [postReactions,setPostReactions]=useState<Record<string,{counts:Record<string,number>;mine:string|null}>>({});
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wehouse:nested-screen', { detail: { open: true } }));
    let active = true;
    void (async () => {
      const [{ data: rows }, { data: trustData },{data:reviewRows},{data:reactionRows}] = await Promise.all([
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
        supabase.rpc("get_public_worker_reviews",{p_worker_id:worker.user_id,p_limit:20}),
        supabase.rpc("get_worker_showcase_reactions",{p_worker_id:worker.user_id}),
      ]);
      const enriched = await Promise.all(
        ((rows || []) as Post[]).map(async (row) => {
          const { data } = await supabase.storage
            .from("worker-showcase")
            .createSignedUrl(row.storage_path, 3600);
          return { ...row, url: data?.signedUrl || "" } as Post;
        }),
      );
      if (active) {
        setPosts(enriched);
        setTrust((trustData || null) as Trust | null);
        setReviews((reviewRows||[]) as PublicReview[]);
        const grouped: Record<string,{counts:Record<string,number>;mine:string|null}> = {};
        for (const reaction of (reactionRows || []) as PostReaction[]) {
          grouped[reaction.post_id] ||= { counts: {}, mine: null };
          grouped[reaction.post_id].counts[reaction.emoji] = Number(reaction.reaction_count || 0);
          if (reaction.mine) grouped[reaction.post_id].mine = reaction.emoji;
        }
        setPostReactions(grouped);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
      window.dispatchEvent(new CustomEvent('wehouse:nested-screen', { detail: { open: false } }));
    };
  }, [worker.user_id]);
  const skills = workerServiceNames(worker),
    occupation = workerOccupation(worker),
    workPosts = posts.filter((post) => post.kind === "work_post"),
    rating = Number(trust?.rating ?? 0) || 0,
    reviewCount = Number(trust?.review_count ?? 0) || 0;
  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-[#0A0A0F]/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07] bg-white/[.03]"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold tracking-[.18em] text-violet-300">WEHOUSE SERVICE WORKER</p>
            <p className="truncate text-sm font-semibold">Worker profile</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-5">
        <section className="py-2">
          <div className="flex items-start gap-4">
            <div className="shrink-0 rounded-[26px]">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-violet-600 text-2xl font-bold">
                {worker.avatar_url ? (
                  <img
                    src={worker.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (worker.full_name || worker.username || "W")[0].toUpperCase()
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-xl font-bold">
                  {worker.full_name || worker.username || "Service worker"}
                </h1>
                {trust?.reviewed && <GoldTickBadge title="Gold Tick · WeHouse reviewed service worker" />}
              </div>
              <p className="mt-1 text-xs text-[#A5ABB8]">{occupation}</p>
              <p className="mt-1 text-[10px] text-[#72798A]">
                {[worker.city || worker.local_government, worker.state]
                  .filter(Boolean)
                  .join(", ") || "Location not shown"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {trust?.reviewed && <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold text-emerald-300">{trust.trusted ? 'WeHouse Trusted · earned performance tier' : 'WeHouse Reviewed · Gold Tick'}</span>}
                {worker.worker_price && (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[9px] font-semibold text-emerald-300">
                    From ₦{Number(worker.worker_price).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="grid grid-cols-3 border-y border-white/[.06]"><ProfileFact label="WeHouse identity" value={trust?.reviewed?'Reviewed':'Not reviewed'}/><ProfileFact label="Completed-job rating" value={rating>0?`${rating.toFixed(1)} · ${reviewCount}`:'New'}/><ProfileFact label="Completed jobs" value={String(Number(trust?.completed_jobs||0))}/></section>
        {trust?.reviewed&&<p className="-mt-2 text-[9px] leading-5 text-[#73798A]">The Gold Tick means WeHouse approved this service worker’s onboarding and review. “WeHouse Trusted” is an additional performance tier earned from completed jobs; it does not replace the Gold Tick.</p>}
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold">Work Posts</h2>
            <p className="mt-1 text-[9px] text-[#666D7E]">
              Photos and videos published by this worker
            </p>
          </div>
          {loading ? (
            <div className="min-h-24" role="status" aria-label="Loading work posts" />
          ) : workPosts.length === 0 ? (
            <Empty text="This worker has not published any work posts yet." />
          ) : (
            <div className="-mx-4 divide-y divide-white/[.06] border-y border-white/[.06] sm:mx-0">
              {workPosts.map((post) => (
                <article key={post.id} className="py-4 first:pt-0">
                  <button onClick={() => setViewer(post)} className="group relative block w-full overflow-hidden bg-[#0D1118] text-left">
                    <Media post={post} className="aspect-[16/11] w-full object-cover transition duration-300 group-active:scale-[.99]" />
                    {post.verified_job && <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2 py-1 text-[7px] font-bold text-[#04100B]">WEHOUSE JOB ✓</span>}
                  </button>
                  {post.caption&&<p className="px-4 pt-3 text-[11px] leading-5 text-[#C7CBD4] sm:px-0">{post.caption}</p>}
                  <div className="flex items-center gap-1 px-3 pt-2 sm:px-0">
                    {["👍","❤️","👏"].map(emoji=><button key={emoji} type="button" onClick={async()=>{
                      const previous=postReactions[post.id]?.mine;
                      const next=previous===emoji?null:emoji;
                      const {data,error}=await supabase.rpc('set_my_worker_showcase_reaction',{p_post_id:post.id,p_emoji:next});
                      if(error)return toast.error(error.message||'Reaction could not be saved');
                      setPostReactions(current=>({...current,[post.id]:{counts:(data||{}) as Record<string,number>,mine:next}}));
                    }} className={`rounded-full px-2.5 py-1.5 text-[10px] ${postReactions[post.id]?.mine===emoji?'bg-violet-500/20 ring-1 ring-violet-400/30':'bg-white/[.04]'}`}>{emoji}{postReactions[post.id]?.counts[emoji]?` ${postReactions[post.id].counts[emoji]}`:''}</button>)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section><h2 className="text-sm font-bold">About</h2><p className="mt-2 whitespace-pre-line text-xs leading-6 text-[#8E94A3]">{worker.worker_bio?cleanBio(worker.worker_bio):'This worker has not added an introduction yet.'}</p>{skills.length>0&&<div className="mt-4 flex flex-wrap gap-2">{skills.map(skill=><span key={skill} className="rounded-full border border-white/[.07] px-2.5 py-1.5 text-[9px] text-[#A9AEBA]">{skill}</span>)}</div>}</section>
        <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-sm font-bold">Customer reviews</h2><p className="mt-1 text-[9px] text-[#666D7E]">Verified reviews from completed WeHouse jobs.</p></div>{reviewCount>0&&<p className="text-xs font-semibold text-amber-300">★ {rating.toFixed(1)} · {reviewCount}</p>}</div>{reviews.length?<div className="divide-y divide-white/[.06] border-y border-white/[.06]">{reviews.map(review=><article key={review.id} className="py-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{review.reviewer_name}</p><p className="mt-1 text-[9px] text-[#686F80]">{review.service_name} · {new Date(review.created_at).toLocaleDateString()}</p></div><p className="text-[10px] font-semibold text-amber-300">{'★'.repeat(Number(review.rating))}</p></div>{review.comment&&<p className="mt-3 whitespace-pre-wrap text-[11px] leading-5 text-[#A5AAB7]">{review.comment}</p>}</article>)}</div>:<Empty text="No customer reviews yet. Reviews appear only after completed WeHouse jobs."/>}</section>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.08] bg-[#090B12]/96 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mx-auto max-w-4xl">
          <button
            onClick={bookingActive ? onOpenBooking : onBook}
            className={`h-12 w-full rounded-2xl text-xs font-semibold ${bookingActive ? "border border-amber-500/20 bg-amber-500/[.07] text-amber-300" : "bg-violet-500 text-white"}`}
          >
            {bookingActive
              ? "Open service booking"
              : "Request service"}
          </button>
        </div>
      </div>
      {viewer && (
        <div
          className="fixed inset-0 z-[90] bg-black/95"
          onClick={() => setViewer(null)}
        >
          <div
            className="mx-auto flex h-full max-w-lg flex-col justify-center p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold">
                  Work Post
                </p>
                {viewer.verified_job && (
                  <p className="mt-1 text-[9px] text-emerald-300">
                    Completed through WeHouse ✓
                  </p>
                )}
              </div>
              <button
                onClick={() => setViewer(null)}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
              >
                ×
              </button>
            </div>
            {viewer.media_type === 'video' ? <VideoPlayer src={viewer.url || ''} className="max-h-[72dvh] w-full bg-black object-contain" autoPlay /> : <img src={viewer.url} alt="Worker work" className="max-h-[72dvh] w-full bg-black object-contain" />}
            {viewer.caption && (
              <p className="mt-3 rounded-2xl bg-white/[.06] p-4 text-[11px] leading-relaxed text-[#D0D3DA]">
                {viewer.caption}
              </p>
            )}
          </div>
        </div>
      )}
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
  return post.media_type === "video" ? (
    controls ? <VideoPlayer src={post.url || ""} className={className} autoPlay /> : <div className={`${className} grid place-items-center bg-[radial-gradient(circle_at_center,rgba(139,92,246,.2),transparent_42%),#090B10]`} role="img" aria-label="Video post"><span className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/45 text-sm text-white">▶</span></div>
  ) : (
    <img src={post.url} alt="Worker work" className={className} loading="lazy" decoding="async" />
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[.08] px-5 py-8 text-center text-[10px] text-[#666D7E]">
      {text}
    </div>
  );
}
function ProfileFact({label,value}:{label:string;value:string}){return <div className="min-w-0 border-r border-white/[.06] px-3 py-4 text-center last:border-r-0"><p className="truncate text-[10px] font-semibold text-[#D5D8E0]">{value}</p><p className="mt-1 text-[8px] text-[#666D7E]">{label}</p></div>}
function cleanBio(value: string) {
  return String(value || "")
    .split(/\n\s*Services\s+Offered\s*:/i)[0]
    .trim();
}

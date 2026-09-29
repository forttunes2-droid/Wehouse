import ShowcaseMediaThumbnail from "@/components/ShowcaseMediaThumbnail";
import type { ShowcasePost } from "@/hooks/useWorkerShowcase";
type Props = { posts: ShowcasePost[]; loading: boolean; error?: string; owner?: boolean; onOpen: (post: ShowcasePost) => void; onRetry: () => void; more?: boolean; loadingMore?: boolean; onMore?: () => void };
export default function WorkerShowcaseGrid({ posts, loading, error, owner = false, onOpen, onRetry, more, loadingMore, onMore }: Props) {
  const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4';
  return <div>
    {error && <div role="alert" className="mb-4 text-sm leading-6 text-[#B8BECC]">{error}<button type="button" onClick={onRetry} className="ml-2 min-h-11 font-medium text-violet-300">Try again</button></div>}
    {loading ? <div role="status" aria-label="Loading work posts"><span className="sr-only">Loading work posts…</span><div aria-hidden="true" className={grid}>{Array.from({ length: 6 }, (_, index) => <div key={index} className="aspect-[3/4] rounded-2xl bg-white/[.05] motion-safe:animate-pulse" />)}</div></div> : posts.length ? <div className={grid} data-showcase-grid>
      {posts.map(post => <button type="button" key={post.id} onClick={() => onOpen(post)} aria-label={`Open work sample: ${post.caption || (post.media_type === "video" ? "Video" : "Photo")}${owner && post.hidden_at ? " · Hidden" : ""}`} className="relative aspect-[3/4] min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#161A23] text-left shadow-lg shadow-black/20 outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
        <ShowcaseMediaThumbnail src={post.url} mediaType={post.media_type} alt={post.caption || "Work sample"} className="h-full w-full object-cover" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent" />
        <span className="absolute inset-x-3 bottom-3 line-clamp-2 text-xs font-semibold leading-4 text-white">{post.caption || (post.media_type === 'video' ? 'Work video' : 'Work photo')}</span>
        {owner && post.hidden_at ? <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-[11px] font-semibold text-white">Hidden</span> : owner && post.job_confirmation_status === "pending" ? <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-[11px] font-semibold text-white">Awaiting confirmation</span> : post.verified_job ? <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-[11px] font-semibold text-white">WeHouse job</span> : null}
      </button>)}
    </div> : !error ? <p className="py-12 text-center text-sm text-[#A7ADBA]">{owner ? "No work posts in this view." : "No published work posts yet."}</p> : null}
    {more && <button type="button" disabled={loadingMore} onClick={onMore} className="mt-4 min-h-12 w-full rounded-xl border border-white/10 text-sm font-medium text-violet-300 disabled:opacity-40">{loadingMore ? "Loading…" : "Show more work"}</button>}
  </div>;
}

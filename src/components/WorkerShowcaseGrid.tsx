import ShowcaseMediaThumbnail from "@/components/ShowcaseMediaThumbnail";
import type { ShowcasePost } from "@/hooks/useWorkerShowcase";
type Props = { posts: ShowcasePost[]; loading: boolean; error?: string; owner?: boolean; onOpen: (post: ShowcasePost) => void; onRetry: () => void; more?: boolean; loadingMore?: boolean; onMore?: () => void };
export default function WorkerShowcaseGrid({ posts, loading, error, owner = false, onOpen, onRetry, more, loadingMore, onMore }: Props) {
  return <div>
    {error && <div role="alert" className="mb-4 text-sm leading-6 text-[#B8BECC]">{error}<button type="button" onClick={onRetry} className="ml-2 min-h-11 font-medium text-violet-300">Try again</button></div>}
    {loading ? <div role="status" aria-label="Loading work posts"><span className="sr-only">Loading work posts…</span><div aria-hidden="true" className="grid grid-cols-3 gap-1">{Array.from({ length: 6 }, (_, index) => <div key={index} className="aspect-[3/4] rounded-sm bg-white/[.05] motion-safe:animate-pulse" />)}</div></div> : posts.length ? <div className="grid grid-cols-3 gap-1 sm:grid-cols-4" data-showcase-grid>
      {posts.map(post => <button type="button" key={post.id} onClick={() => onOpen(post)} aria-label={`Open work sample: ${post.caption || (post.media_type === "video" ? "Video" : "Photo")}${owner && post.hidden_at ? " · Hidden" : ""}`} className="relative aspect-[3/4] min-w-0 overflow-hidden rounded-sm bg-[#161A23] text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
        <ShowcaseMediaThumbnail src={post.url} mediaType={post.media_type} alt={post.caption || "Work sample"} className="h-full w-full object-cover" />
        {owner && post.hidden_at ? <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-1 text-xs text-white">Hidden</span> : owner && post.job_confirmation_status === "pending" ? <span className="absolute bottom-2 left-2 right-2 rounded-md bg-black/80 px-2 py-1 text-xs leading-4 text-white">Awaiting confirmation</span> : post.verified_job ? <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-1 text-xs text-white">WeHouse job</span> : null}
      </button>)}
    </div> : !error ? <p className="py-12 text-center text-sm text-[#A7ADBA]">{owner ? "No work posts in this view." : "No published work posts yet."}</p> : null}
    {more && <button type="button" disabled={loadingMore} onClick={onMore} className="mt-4 min-h-12 w-full rounded-xl border border-white/10 text-sm font-medium text-violet-300 disabled:opacity-40">{loadingMore ? "Loading…" : "Show more work"}</button>}
  </div>;
}

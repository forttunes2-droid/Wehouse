import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Heart, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/withTimeout";
import MediaPagingActions from "@/components/MediaPagingActions";
import { useMediaSwipe } from "@/hooks/useMediaSwipe";
import VideoPlayer from "@/components/VideoPlayer";
import BackButton from "@/components/BackButton";
type Post = { id: string; media_type: "image" | "video"; caption: string | null; url?: string; verified_job?: boolean; hidden_at?: string | null; job_confirmation_status?: string | null };
type Comment = { id: string; user_id: string; body: string; created_at: string; display_name: string; avatar_url: string | null };
function commentTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString();
}
type Props = { post: Post; workerName: string; workerAvatar?: string | null; ownerView?: boolean; readOnly?: boolean; liked?: boolean; likeCount?: number; onClose: () => void; onLike?: () => Promise<void>; ownerActions?: ReactNode; onOpenProfile?: () => void; position?: number; total?: number; onPrevious?: () => void; onNext?: () => void; onRetry?: () => Promise<void> };
export default function WorkerShowcasePostViewer({ post, workerName, workerAvatar, ownerView = false, readOnly = false, liked = false, likeCount = 0, onClose, onLike, ownerActions, onOpenProfile, position = 0, total = 1, onPrevious, onNext, onRetry }: Props) {
  const [comments, setComments] = useState<Comment[]>([]), [commentsOpen, setCommentsOpen] = useState(false), [commentsLoading, setCommentsLoading] = useState(false), [commentsLoaded, setCommentsLoaded] = useState(false), [commentsError, setCommentsError] = useState("");
  const [comment, setComment] = useState(""), [commentBusy, setCommentBusy] = useState(false), [likeBusy, setLikeBusy] = useState(false);
  const [localLiked, setLocalLiked] = useState(liked), [localLikeCount, setLocalLikeCount] = useState(likeCount), [retrying, setRetrying] = useState(false);
  const current = useRef(post.id); current.current = post.id;
  const commentGeneration = useRef(0), mounted = useRef(true);
  const paging = useMediaSwipe({ identity: post.id, axis: "vertical", enabled: !commentsOpen, onPrevious, onNext });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; commentGeneration.current++; }; }, []);
  useEffect(() => { setLocalLiked(liked); setLocalLikeCount(likeCount); }, [liked, likeCount, post.id]);
  useEffect(() => { setComments([]); setCommentsOpen(false); setCommentsLoaded(false); setCommentsLoading(false); setCommentsError(""); setComment(""); setCommentBusy(false); setLikeBusy(false); commentGeneration.current++; }, [post.id]);
  const loadComments = useCallback(async () => {
    const id = post.id, request = ++commentGeneration.current; setCommentsLoading(true); setCommentsError("");
    try {
      const result = await withTimeout(supabase.rpc("get_worker_showcase_post_comments", { p_post_id: id }), 12000, "Comments took too long.");
      if (!mounted.current || current.current !== id || request !== commentGeneration.current) return;
      if (result.error || !Array.isArray(result.data)) throw new Error("Comments could not be loaded.");
      setComments(result.data as Comment[]); setCommentsLoaded(true);
    } catch { if (mounted.current && current.current === id && request === commentGeneration.current) setCommentsError("Comments could not be loaded."); }
    finally { if (mounted.current && current.current === id && request === commentGeneration.current) setCommentsLoading(false); }
  }, [post.id]);
  const dismiss = useRecordScreenBack(onClose);
  const closeComments = useRecordScreenBack(() => setCommentsOpen(false), commentsOpen);
  const dialogRef = useDialogInteraction(commentsOpen ? closeComments : dismiss);
  const wasCommentsOpen = useRef(false);
  useEffect(() => {
    const label = commentsOpen ? "Back to work post" : wasCommentsOpen.current ? "Open comments" : "";
    wasCommentsOpen.current = commentsOpen;
    if (label) dialogRef.current?.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.focus();
  }, [commentsOpen, dialogRef]);
  function openComments() { setCommentsOpen(true); if (!commentsLoaded && !commentsLoading) void loadComments(); }
  async function toggleLike() {
    if (!onLike || likeBusy) return;
    const id = post.id, before = localLiked, count = localLikeCount;
    setLocalLiked(!before); setLocalLikeCount(Math.max(0, count + (before ? -1 : 1))); setLikeBusy(true);
    try { await onLike(); }
    catch { if (mounted.current && current.current === id) { setLocalLiked(before); setLocalLikeCount(count); toast.error("Like could not be updated"); } }
    finally { if (mounted.current && current.current === id) setLikeBusy(false); }
  }
  async function submitComment() {
    const body = comment.trim(), id = post.id;
    if (!body || commentBusy) return;
    setCommentBusy(true); setComment("");
    try {
      const result = await withTimeout(supabase.rpc("add_my_worker_showcase_comment", { p_post_id: id, p_body: body }), 15000, "Comment could not be confirmed. Check the discussion before trying again.");
      if (result.error) throw result.error;
      if (mounted.current && current.current === id) await loadComments();
    } catch { if (mounted.current && current.current === id) { setComment(text => text || body); setCommentsError("Your comment could not be confirmed. Refresh the discussion before trying again."); } }
    finally { if (mounted.current && current.current === id) setCommentBusy(false); }
  }
  return createPortal(<div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${workerName} work post`} className="fixed inset-0 z-[100200] isolate flex h-[100dvh] flex-col overflow-hidden bg-[#090B10] text-white outline-none"
    onKeyDown={event => { if (commentsOpen || (event.target as HTMLElement).closest("input,textarea,select,button")) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); (event.key === "ArrowDown" ? onNext : onPrevious)?.(); } }}>
    <header inert={commentsOpen} className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-3 pt-[env(safe-area-inset-top)] sm:px-5">
      <div className="pointer-events-auto"><BackButton onClick={dismiss} ariaLabel="Back to work posts" /></div>
      <div className="flex-1" />{ownerActions && <div className="pointer-events-auto flex shrink-0 items-center gap-1">{ownerActions}</div>}
    </header>
    <div inert={commentsOpen} className="relative h-full w-full touch-pan-x bg-[#08090D]" data-showcase-stage {...paging}>
      <MediaStage key={`${post.id}:${post.url}`} post={post} workerName={workerName} paused={commentsOpen} onRetry={onRetry ? async () => { setRetrying(true); try { await onRetry(); } catch { toast.error("This media could not be loaded."); } finally { if (mounted.current) setRetrying(false); } } : undefined} retrying={retrying} />
    </div>
    <footer inert={commentsOpen} className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-28 sm:px-6">
      <div className="mx-auto flex max-w-3xl items-end gap-3">
      <div className="min-w-0 flex-1">
      {ownerView ? <p className="mb-2 text-xs text-white/75">Your work post</p> :
        <button type="button" disabled={!onOpenProfile} onClick={onOpenProfile} className="pointer-events-auto mb-2 flex min-h-11 max-w-full items-center gap-2 text-left disabled:cursor-default" aria-label={onOpenProfile ? `Open ${workerName}'s profile` : undefined}>
          <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-white/30 bg-violet-500/25 text-sm font-semibold">{workerAvatar ? <img src={workerAvatar} alt="" className="h-full w-full object-cover" /> : workerName[0]?.toUpperCase()}</span><span className="truncate text-sm font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,.8)]">{workerName}</span>
        </button>}
      {post.verified_job ? <span className="mb-2 inline-flex rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">Completed WeHouse job</span> : ownerView && post.job_confirmation_status === 'pending' ? <span className="mb-2 inline-flex rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">Awaiting customer confirmation</span> : null}
      {ownerView && post.hidden_at && <span className="mb-2 ml-2 inline-flex rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">Hidden from profile</span>}
      {post.caption && <p className="pointer-events-auto max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-white [text-shadow:0_1px_3px_rgba(0,0,0,.8)]">{post.caption}</p>}
      {total > 1 && position >= 0 && <div className="pointer-events-auto mt-2 flex items-center gap-1"><span className="text-xs text-white/80">{position + 1} / {total}</span><MediaPagingActions onPrevious={onPrevious} onNext={onNext} previousLabel="Previous work post" nextLabel="Next work post" /></div>}
      </div>
      <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-3 pb-1">{onLike && <button type="button" onClick={() => void toggleLike()} disabled={likeBusy} aria-label={localLiked ? "Remove like" : "Like work post"} className="flex min-h-12 min-w-12 flex-col items-center justify-center rounded-full bg-black/35 px-2 text-xs backdrop-blur-sm"><Heart size={23} className={localLiked ? "fill-violet-400 text-violet-400" : "text-white"} /><span>{localLikeCount || 'Like'}</span></button>}<button type="button" onClick={openComments} aria-label="Open comments" className="flex min-h-12 min-w-12 flex-col items-center justify-center rounded-full bg-black/35 px-2 text-xs backdrop-blur-sm"><MessageCircle size={23} /><span>{commentsLoaded ? comments.length : 'Reply'}</span></button></div>
      </div>
    </footer>
    {commentsOpen && <section role="region" aria-label="Work post comments" onClick={closeComments} className="absolute inset-0 z-20 flex flex-col justify-end bg-black/65">
      <div onClick={event => event.stopPropagation()} className="wh-comments-sheet flex min-h-[55dvh] max-h-[82dvh] w-full flex-col rounded-t-[28px] border-t border-white/10 bg-[#10131A] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:mx-auto sm:max-w-xl sm:rounded-[28px]">
      <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25" />
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-3"><BackButton onClick={closeComments} ariaLabel="Back to work post" /><div><h2 className="text-base font-semibold">Comments <span className="ml-1 text-sm font-normal text-[#9AA3B3]">{commentsLoaded ? comments.length : ""}</span></h2><p className="text-xs text-[#929AAA]">{workerName}'s work</p></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">{commentsError && <div role="alert" className="py-4 text-sm leading-6 text-[#C3C9D5]">{commentsError}<button type="button" onClick={() => void loadComments()} className="ml-2 min-h-11 text-violet-300">Try again</button></div>}{commentsLoading ? <p role="status" className="py-10 text-sm text-[#A7ADBA]">Loading comments…</p> : comments.length ? comments.map(item => <article key={item.id} className="flex gap-3 border-b border-white/[.07] py-4 last:border-b-0"><span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-semibold">{item.avatar_url ? <img src={item.avatar_url} alt="" className="h-full w-full object-cover" /> : item.display_name[0]?.toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2"><p className="text-sm font-semibold">{item.display_name}</p><time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()} className="text-xs text-[#929AAA]">{commentTime(item.created_at)}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#D0D5DF]">{item.body}</p></div></article>) : !commentsError ? <p className="py-12 text-center text-sm text-[#A7ADBA]">No comments yet. Start the conversation about this work.</p> : null}</div>
      {readOnly ? <p className="border-t border-white/10 px-4 py-4 text-sm text-[#A7ADBA]">Creator preview · comments are read only</p> : <form onSubmit={event => { event.preventDefault(); void submitComment(); }} className="flex shrink-0 items-end gap-2 border-t border-white/10 bg-[#10131A] p-3"><textarea aria-label="Add a comment" value={comment} onChange={event => setComment(event.target.value.slice(0, 500))} placeholder="Add a comment…" rows={1} className="max-h-28 min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-white/10 bg-[#191D26] px-4 py-3 text-base outline-none focus:border-violet-400" /><button type="submit" disabled={commentBusy || !comment.trim()} className="min-h-12 rounded-2xl bg-violet-500 px-5 text-sm font-semibold disabled:opacity-40">{commentBusy ? "Sending…" : "Post"}</button></form>}
      </div>
    </section>}
  </div>, document.body);
}
function MediaStage({ post, workerName, paused, onRetry, retrying }: { post: Post; workerName: string; paused: boolean; onRetry?: () => Promise<void>; retrying: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (post.url) return;
    const timer = window.setTimeout(() => setFailed(true), 12000);
    return () => window.clearTimeout(timer);
  }, [post.url]);
  if (!post.url && !failed) return <div role="status" className="grid h-full place-items-center px-6 text-center text-sm text-[#A7ADBA]">Loading {post.media_type === 'video' ? 'video' : 'photo'}…</div>;
  if (!post.url || failed) return <div className="grid h-full place-items-center px-6 text-center"><div><p className="text-sm text-[#C7CDD9]">This media could not be loaded.</p>{onRetry && <button type="button" disabled={retrying} onClick={() => { setFailed(false); void onRetry(); }} className="mt-3 min-h-11 px-4 text-sm font-medium text-violet-300">{retrying ? "Loading…" : "Try again"}</button>}</div></div>;
  return post.media_type === "video" ? <VideoPlayer src={post.url} autoPlay paused={paused} onPlaybackError={() => setFailed(true)} controlsPositionClassName="bottom-40 sm:bottom-36" containerClassName="h-full w-full bg-[#08090D]" className="h-full w-full object-contain" /> : <img src={post.url} alt={`${workerName} work`} onError={() => setFailed(true)} className="h-full w-full object-contain" />;
}

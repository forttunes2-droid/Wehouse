import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { useRecordScreenBack } from "@/hooks/useRecordScreenBack";
import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Heart, MessageCircle, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/withTimeout";
import VideoPlayer from "@/components/VideoPlayer";
import BackButton from "@/components/BackButton";
type Post = { id: string; media_type: "image" | "video"; caption: string | null; url?: string };
type Comment = { id: string; user_id: string; body: string; created_at: string; display_name: string; avatar_url: string | null };
type Props = { post: Post; workerName: string; workerAvatar?: string | null; liked?: boolean; likeCount?: number; onClose: () => void; onLike?: () => Promise<void>; ownerActions?: ReactNode; onOpenProfile?: () => void; position?: number; total?: number; onPrevious?: () => void; onNext?: () => void; onRetry?: () => Promise<void> };
export default function WorkerShowcasePostViewer({ post, workerName, workerAvatar, liked = false, likeCount = 0, onClose, onLike, ownerActions, onOpenProfile, position = 0, total = 1, onPrevious, onNext, onRetry }: Props) {
  const [comments, setComments] = useState<Comment[]>([]), [commentsOpen, setCommentsOpen] = useState(false), [commentsLoading, setCommentsLoading] = useState(false), [commentsLoaded, setCommentsLoaded] = useState(false), [commentsError, setCommentsError] = useState("");
  const [comment, setComment] = useState(""), [commentBusy, setCommentBusy] = useState(false), [likeBusy, setLikeBusy] = useState(false);
  const [localLiked, setLocalLiked] = useState(liked), [localLikeCount, setLocalLikeCount] = useState(likeCount), [retrying, setRetrying] = useState(false);
  const current = useRef(post.id); current.current = post.id;
  const commentGeneration = useRef(0), mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null), suppressClickUntil = useRef(0);
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
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (commentsOpen || event.pointerType !== "touch" || !event.isPrimary || target.closest("input,textarea,a,select") || (target.closest("button") && !target.closest('[data-media-toggle]'))) return;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, active: false };
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current; if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.active && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.4) { start.active = true; event.currentTarget.setPointerCapture(event.pointerId); }
    if (start.active) event.preventDefault();
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current; gesture.current = null;
    if (!start || start.id !== event.pointerId || !start.active) return;
    suppressClickUntil.current = Date.now() + 400;
    const delta = event.clientY - start.y;
    if (Math.abs(delta) >= 64) (delta < 0 ? onNext : onPrevious)?.();
  }
  return createPortal(<div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${workerName} work post`} className="fixed inset-0 z-[100200] isolate flex h-[100dvh] flex-col overflow-hidden bg-[#090B10] text-white outline-none"
    onKeyDown={event => { if (commentsOpen || (event.target as HTMLElement).closest("input,textarea,select,button")) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); (event.key === "ArrowDown" ? onNext : onPrevious)?.(); } }}>
    <header inert={commentsOpen} className="z-10 flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-[#090B10] px-3 pt-[env(safe-area-inset-top)]">
      <BackButton onClick={dismiss} ariaLabel="Back to work posts" />
      <button type="button" disabled={!onOpenProfile} onClick={onOpenProfile} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default" aria-label={onOpenProfile ? `Open ${workerName}'s profile` : undefined}>
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-semibold">{workerAvatar ? <img src={workerAvatar} alt="" className="h-full w-full object-cover" /> : workerName[0]?.toUpperCase()}</span><span className="truncate text-sm font-semibold">{workerName}</span>
      </button>{ownerActions && <div className="flex shrink-0 items-center gap-1">{ownerActions}</div>}
    </header>
    <div inert={commentsOpen} className="relative min-h-0 flex-1 touch-pan-x bg-[#08090D]" data-showcase-stage onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; }} onClickCapture={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}>
      <MediaStage key={`${post.id}:${post.url}`} post={post} workerName={workerName} paused={commentsOpen} onRetry={onRetry ? async () => { setRetrying(true); try { await onRetry(); } catch { toast.error("This media could not be loaded."); } finally { if (mounted.current) setRetrying(false); } } : undefined} retrying={retrying} />
    </div>
    <footer inert={commentsOpen} className="shrink-0 border-t border-white/10 bg-[#090B10] px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">
      {post.caption && <p className="mx-auto max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-[#D2D6DF] max-h-24 overflow-y-auto">{post.caption}</p>}
      <div className="mx-auto mt-1 flex max-w-3xl items-center justify-between gap-2"><div className="flex items-center gap-3">{onLike && <button type="button" onClick={() => void toggleLike()} disabled={likeBusy} aria-label={localLiked ? "Remove like" : "Like work post"} className="flex min-h-11 items-center gap-2 text-sm"><Heart size={21} className={localLiked ? "fill-violet-400 text-violet-400" : "text-[#CFD4DF]"} /><span>{localLikeCount || "Like"}</span></button>}<button type="button" onClick={openComments} aria-label="Open comments" className="flex min-h-11 items-center gap-2 text-sm"><MessageCircle size={21} /><span>{commentsLoaded ? comments.length : "Comments"}</span></button></div>
      {total > 1 && position >= 0 && <div className="flex items-center gap-1"><span className="mr-1 text-xs text-[#A7ADBA]">{position + 1} / {total}</span><button type="button" disabled={!onPrevious} onClick={onPrevious} aria-label="Previous work post" className="grid h-11 w-11 place-items-center disabled:opacity-25"><ChevronUp size={22} /></button><button type="button" disabled={!onNext} onClick={onNext} aria-label="Next work post" className="grid h-11 w-11 place-items-center disabled:opacity-25"><ChevronDown size={22} /></button></div>}
      </div>
    </footer>
    {commentsOpen && <section role="region" aria-label="Work post comments" className="absolute inset-0 z-20 flex flex-col bg-[#10131A] pb-[env(safe-area-inset-bottom)]">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-white/10 px-3 pt-[env(safe-area-inset-top)]"><BackButton onClick={closeComments} ariaLabel="Back to work post" /><h2 className="text-base font-semibold">Comments</h2></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">{commentsError && <div role="alert" className="py-4 text-sm leading-6 text-[#C3C9D5]">{commentsError}<button type="button" onClick={() => void loadComments()} className="ml-2 min-h-11 text-violet-300">Try again</button></div>}{commentsLoading ? <p role="status" className="py-10 text-sm text-[#A7ADBA]">Loading comments…</p> : comments.length ? comments.map(item => <article key={item.id} className="flex gap-3 border-b border-white/5 py-4"><span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-medium">{item.avatar_url ? <img src={item.avatar_url} alt="" className="h-full w-full object-cover" /> : item.display_name[0]?.toUpperCase()}</span><div className="min-w-0"><p className="text-sm font-semibold">{item.display_name}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#D0D5DF]">{item.body}</p><p className="mt-2 text-xs text-[#A7ADBA]">{new Date(item.created_at).toLocaleString()}</p></div></article>) : !commentsError ? <p className="py-12 text-center text-sm text-[#A7ADBA]">No comments yet.</p> : null}</div>
      <form onSubmit={event => { event.preventDefault(); void submitComment(); }} className="flex shrink-0 items-end gap-3 border-t border-white/10 bg-[#10131A] p-3"><textarea aria-label="Add a comment" value={comment} onChange={event => setComment(event.target.value.slice(0, 500))} placeholder="Add a comment" rows={1} className="max-h-28 min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#191D26] px-3 py-3 text-base outline-none focus:border-violet-400" /><button type="submit" disabled={commentBusy || !comment.trim()} className="min-h-12 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40">{commentBusy ? "Sending…" : "Post"}</button></form>
    </section>}
  </div>, document.body);
}
function MediaStage({ post, workerName, paused, onRetry, retrying }: { post: Post; workerName: string; paused: boolean; onRetry?: () => Promise<void>; retrying: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!post.url || failed) return <div className="grid h-full place-items-center px-6 text-center"><div><p className="text-sm text-[#C7CDD9]">This media could not be loaded.</p>{onRetry && <button type="button" disabled={retrying} onClick={() => { setFailed(false); void onRetry(); }} className="mt-3 min-h-11 px-4 text-sm font-medium text-violet-300">{retrying ? "Loading…" : "Try again"}</button>}</div></div>;
  return post.media_type === "video" ? <VideoPlayer src={post.url} autoPlay paused={paused} onPlaybackError={() => setFailed(true)} containerClassName="h-full w-full bg-[#08090D]" className="h-full w-full object-contain" /> : <img src={post.url} alt={`${workerName} work`} onError={() => setFailed(true)} className="h-full w-full object-contain" />;
}

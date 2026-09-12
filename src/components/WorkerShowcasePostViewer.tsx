import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import VideoPlayer from "@/components/VideoPlayer";

type Post = {
  id: string;
  media_type: "image" | "video";
  caption: string | null;
  url?: string;
};

type Comment = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  display_name: string;
  avatar_url: string | null;
};

type Props = {
  post: Post;
  workerName: string;
  workerAvatar?: string | null;
  liked?: boolean;
  likeCount?: number;
  onClose: () => void;
  onLike?: () => Promise<void>;
  ownerActions?: ReactNode;
  onOpenProfile?: () => void;
};

export default function WorkerShowcasePostViewer({
  post,
  workerName,
  workerAvatar,
  liked = false,
  likeCount = 0,
  onClose,
  onLike,
  ownerActions,
  onOpenProfile,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [localLiked, setLocalLiked] = useState(liked);
  const [localLikeCount, setLocalLikeCount] = useState(likeCount);

  useEffect(() => {
    setLocalLiked(liked);
    setLocalLikeCount(likeCount);
  }, [liked, likeCount, post.id]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    const { data, error } = await supabase.rpc(
      "get_worker_showcase_post_comments",
      { p_post_id: post.id },
    );
    setCommentsLoading(false);
    if (error) return toast.error("Comments could not be loaded");
    setComments((Array.isArray(data) ? data : []) as Comment[]);
    setCommentsLoaded(true);
  }, [post.id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function openComments() {
    setCommentsOpen(true);
    if (!commentsLoaded && !commentsLoading) void loadComments();
  }

  async function toggleLike() {
    if (!onLike || likeBusy) return;
    const previousLiked = localLiked;
    const previousCount = localLikeCount;
    setLocalLiked(!previousLiked);
    setLocalLikeCount(Math.max(0, previousCount + (previousLiked ? -1 : 1)));
    setLikeBusy(true);
    try {
      await onLike();
    } catch {
      setLocalLiked(previousLiked);
      setLocalLikeCount(previousCount);
      toast.error("Like could not be updated");
    } finally {
      setLikeBusy(false);
    }
  }

  async function submitComment() {
    const body = comment.trim();
    if (!body || commentBusy) return;
    setCommentBusy(true);
    setComment("");
    const { error } = await supabase.rpc("add_my_worker_showcase_comment", {
      p_post_id: post.id,
      p_body: body,
    });
    setCommentBusy(false);
    if (error) {
      setComment(body);
      return toast.error(error.message || "Comment could not be posted");
    }
    await loadComments();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100200] isolate h-[100dvh] overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${workerName} work post`}
    >
      <MediaStage post={post} workerName={workerName} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/75 via-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-black/95 via-black/48 to-transparent" />

      <button
        type="button"
        onClick={onClose}
        className="absolute left-3 top-[max(.75rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-full bg-black/45 text-xl backdrop-blur-md"
        aria-label="Close work post"
      >
        ×
      </button>
      {ownerActions ? (
        <div className="absolute right-3 top-[max(.75rem,env(safe-area-inset-top))] z-10 flex items-center gap-2 rounded-full bg-black/45 px-2 py-1 backdrop-blur-md">
          {ownerActions}
        </div>
      ) : null}

      <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-3 z-10 flex flex-col items-center gap-5">
        {onLike ? (
          <button
            type="button"
            disabled={likeBusy}
            onClick={() => void toggleLike()}
            className="flex flex-col items-center gap-1 text-[9px] font-semibold disabled:opacity-60"
            aria-label={localLiked ? "Remove like" : "Like work post"}
          >
            <span className={`grid h-12 w-12 place-items-center rounded-full bg-black/38 backdrop-blur-md ${localLiked ? "text-rose-400" : "text-white"}`}>
              <HeartIcon filled={localLiked} />
            </span>
            <span>{localLikeCount > 0 ? localLikeCount : "Like"}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={openComments}
          className="flex flex-col items-center gap-1 text-[9px] font-semibold"
          aria-label="Open comments"
        >
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/38 backdrop-blur-md"><CommentIcon /></span>
          <span>{commentsLoaded && comments.length ? comments.length : "Comment"}</span>
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-[max(1.1rem,env(safe-area-inset-bottom))] z-[5] px-4 pr-20">
        <button
          type="button"
          disabled={!onOpenProfile}
          onClick={onOpenProfile}
          className="flex max-w-full items-center gap-2 text-left disabled:cursor-default"
          aria-label={onOpenProfile ? `Open ${workerName}'s profile` : undefined}
        >
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-white/15 bg-violet-500/20 text-xs font-bold">
            {workerAvatar ? <img src={workerAvatar} alt="" className="h-full w-full object-cover" /> : workerName[0]?.toUpperCase()}
          </span>
          <p className="truncate text-[13px] font-semibold">{workerName}</p>
        </button>
        {post.caption ? (
          <p className="mt-2 line-clamp-3 max-w-xl text-[11px] leading-5 text-white/92">{post.caption}</p>
        ) : null}
      </div>

      {commentsOpen ? (
        <div className="absolute inset-0 z-20 flex items-end bg-black/45 backdrop-blur-[1px]" onClick={() => setCommentsOpen(false)}>
          <section
            className="flex h-[min(82dvh,760px)] w-full flex-col rounded-t-[24px] border-t border-white/[.1] bg-[#10131A] pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_70px_rgba(0,0,0,.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
            <header className="flex items-center justify-between px-4 pb-3 pt-2">
              <div>
                <h2 className="text-sm font-bold">Comments</h2>
                <p className="mt-0.5 text-[9px] text-[#72798A]">{comments.length ? `${comments.length} ${comments.length === 1 ? "comment" : "comments"}` : "Work discussion"}</p>
              </div>
              <button type="button" onClick={() => setCommentsOpen(false)} className="grid h-10 w-10 place-items-center rounded-full text-xl text-[#A2A8B7]" aria-label="Close comments">×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[.06] px-4">
              {commentsLoading ? (
                <p className="py-12 text-center text-[10px] text-[#747B8B]">Loading comments…</p>
              ) : comments.length ? (
                comments.map((item) => (
                  <article key={item.id} className="flex gap-3 py-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-[10px] font-bold">
                      {item.avatar_url ? <img src={item.avatar_url} alt="" className="h-full w-full object-cover" /> : item.display_name[0]?.toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold">{item.display_name}</p>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-[#D0D3DB]">{item.body}</p>
                      <p className="mt-1 text-[8px] text-[#656C7C]">{new Date(item.created_at).toLocaleString()}</p>
                    </div>
                  </article>
                ))
              ) : (
                <div className="grid min-h-44 place-items-center text-center">
                  <div><p className="text-xs font-semibold">No comments yet</p><p className="mt-2 text-[9px] text-[#747B8B]">Be the first to respond to this work.</p></div>
                </div>
              )}
            </div>
            <form
              className="flex items-end gap-2 border-t border-white/[.07] bg-[#10131A] p-3"
              onSubmit={(event) => { event.preventDefault(); void submitComment(); }}
            >
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 500))}
                placeholder="Add a comment"
                rows={1}
                className="max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-white/[.08] bg-[#191D26] px-4 py-3 text-xs outline-none placeholder:text-[#626879] focus:border-violet-500/40"
              />
              <button type="submit" disabled={commentBusy || !comment.trim()} className="h-11 shrink-0 rounded-full bg-violet-500 px-4 text-[10px] font-semibold disabled:bg-white/[.06] disabled:text-[#666C7B]">
                {commentBusy ? "…" : "Post"}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function MediaStage({ post, workerName }: { post: Post; workerName: string }) {
  const src = post.url || "";
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {src ? (
        post.media_type === "video" ? (
          <video src={src} muted autoPlay loop playsInline aria-hidden="true" className="absolute inset-[-8%] h-[116%] w-[116%] scale-110 object-cover opacity-35 blur-3xl" />
        ) : (
          <img src={src} alt="" aria-hidden="true" className="absolute inset-[-8%] h-[116%] w-[116%] scale-110 object-cover opacity-35 blur-3xl" />
        )
      ) : null}
      <div className="absolute inset-0 bg-black/25" />
      <div className="absolute inset-0 flex items-center justify-center">
        {post.media_type === "video" ? (
          <VideoPlayer src={src} autoPlay className="h-full w-full bg-transparent object-contain" />
        ) : (
          <img src={src} alt={`${workerName} work`} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H6l-3 2v-7a8 8 0 1 1 18-3Z" />
    </svg>
  );
}

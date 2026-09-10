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
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    const { data, error } = await supabase.rpc(
      "get_worker_showcase_post_comments",
      { p_post_id: post.id },
    );
    setCommentsLoading(false);
    if (error) return toast.error("Comments could not be loaded");
    setComments((Array.isArray(data) ? data : []) as Comment[]);
  }, [post.id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void loadComments();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [loadComments]);

  async function submitComment() {
    const body = comment.trim();
    if (!body || commentBusy) return;
    setCommentBusy(true);
    const { error } = await supabase.rpc("add_my_worker_showcase_comment", {
      p_post_id: post.id,
      p_body: body,
    });
    setCommentBusy(false);
    if (error) return toast.error(error.message || "Comment could not be posted");
    setComment("");
    await loadComments();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100200] isolate flex h-[100dvh] flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`${workerName} work post`}>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {post.media_type === "video" ? (
          <VideoPlayer src={post.url || ""} autoPlay className="h-full w-full bg-black object-contain" />
        ) : (
          <img src={post.url} alt={`${workerName} work`} className="h-full w-full object-contain" />
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent" />
        <button type="button" onClick={onClose} className="absolute left-3 top-[max(.75rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-black/55 text-xl backdrop-blur" aria-label="Close work post">×</button>
        {ownerActions ? <div className="absolute right-3 top-[max(.75rem,env(safe-area-inset-top))] flex items-center gap-2 rounded-full bg-black/55 px-2 py-1 backdrop-blur">{ownerActions}</div> : null}
        <div className="absolute bottom-4 right-3 flex flex-col items-center gap-4">
          {onLike ? <button
            type="button"
            disabled={likeBusy}
            onClick={async () => {
              setLikeBusy(true);
              await onLike?.();
              setLikeBusy(false);
            }}
            className="flex flex-col items-center gap-1 text-[9px] font-semibold"
            aria-label={liked ? "Remove like" : "Like work post"}
          >
            <span className={`grid h-12 w-12 place-items-center rounded-full bg-black/55 text-2xl backdrop-blur ${liked ? "text-rose-400" : "text-white"}`}>{liked ? "♥" : "♡"}</span>
            {likeCount || "Like"}
          </button> : null}
          <button type="button" onClick={() => setCommentsOpen(true)} className="flex flex-col items-center gap-1 text-[9px] font-semibold" aria-label="Open comments">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-xl backdrop-blur">◯</span>
            {comments.length || "Comment"}
          </button>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 pb-5 pr-20 pt-20">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-violet-500/20 text-xs font-bold">
              {workerAvatar ? <img src={workerAvatar} alt="" className="h-full w-full object-cover" /> : workerName[0]?.toUpperCase()}
            </span>
            <p className="text-xs font-semibold">{workerName}</p>
          </div>
          {post.caption ? <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-white/90">{post.caption}</p> : null}
        </div>
      </div>

      {commentsOpen ? (
        <div className="absolute inset-0 z-20 flex items-end bg-black/55" onClick={() => setCommentsOpen(false)}>
          <section className="flex max-h-[68dvh] w-full flex-col rounded-t-[28px] border-t border-white/[.09] bg-[#12161F] pb-[env(safe-area-inset-bottom)]" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-white/[.07] px-4 py-3">
              <div><h2 className="text-sm font-bold">Comments</h2><p className="mt-0.5 text-[9px] text-[#72798A]">{comments.length} on this work post</p></div>
              <button type="button" onClick={() => setCommentsOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-lg" aria-label="Close comments">×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {commentsLoading ? <p className="py-10 text-center text-[10px] text-[#747B8B]">Loading comments…</p> : comments.length ? comments.map((item) => (
                <article key={item.id} className="flex gap-3 border-b border-white/[.055] py-3 last:border-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-[10px] font-bold">{item.avatar_url ? <img src={item.avatar_url} alt="" className="h-full w-full object-cover" /> : item.display_name[0]?.toUpperCase()}</span>
                  <div className="min-w-0"><p className="text-[10px] font-semibold">{item.display_name}</p><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-[#C0C4CE]">{item.body}</p><p className="mt-1 text-[8px] text-[#656C7C]">{new Date(item.created_at).toLocaleString()}</p></div>
                </article>
              )) : <p className="py-10 text-center text-[10px] text-[#747B8B]">No comments yet. Start the conversation about this work.</p>}
            </div>
            <form className="flex gap-2 border-t border-white/[.07] p-3" onSubmit={(event) => { event.preventDefault(); void submitComment(); }}>
              <input value={comment} onChange={(event) => setComment(event.target.value.slice(0, 500))} placeholder="Add a comment" className="h-11 min-w-0 flex-1 rounded-full border border-white/[.08] bg-[#1A1E27] px-4 text-xs outline-none focus:border-violet-500/40" />
              <button type="submit" disabled={commentBusy || !comment.trim()} className="h-11 rounded-full bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-40">{commentBusy ? "…" : "Post"}</button>
            </form>
          </section>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

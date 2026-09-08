import { useEffect } from "react";
import { Reply, Trash2, X } from "lucide-react";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type Props = {
  preview: string;
  time: string;
  readStatus?: string | null;
  currentReaction?: string | null;
  onReact: (emoji: string) => void;
  onReply?: () => void;
  onRemove?: () => void;
  onClose: () => void;
};

export default function MessageActionSheet({
  preview,
  time,
  readStatus,
  currentReaction,
  onReact,
  onReply,
  onRemove,
  onClose,
}: Props) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100050] flex items-end justify-center bg-black/65 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <section
        className="w-full max-w-sm overflow-hidden rounded-[26px] border border-white/[.09] bg-[#12161E] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#747B8D]">
            React to message
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close message actions"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/[.04] text-[#8B91A1]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-3 pb-3 pt-2">
          <div className="grid grid-cols-6 gap-1">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                aria-label={`React ${emoji}`}
                aria-pressed={currentReaction === emoji}
                className={`grid h-11 place-items-center rounded-full text-lg transition active:scale-90 ${currentReaction === emoji ? "bg-violet-500/25 ring-1 ring-violet-400/50" : "hover:bg-white/[.06]"}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        <div className="border-y border-white/[.06] px-4 py-3">
          <p className="truncate text-[10px] text-[#A3A8B5]">{preview || "Attachment"}</p>
          <p className="mt-1 text-[8px] text-[#62697A]">
            {time}{readStatus ? ` · ${readStatus}` : ""}
          </p>
        </div>
        <div className="p-2">
          {onReply ? (
            <button type="button" onClick={onReply} className="flex min-h-12 w-full items-center rounded-2xl px-3 text-left text-xs font-semibold text-white hover:bg-white/[.04]">
              <Reply className="mr-3 h-4 w-4 text-violet-300" />
              Reply
            </button>
          ) : null}
          {onRemove ? (
            <button type="button" onClick={onRemove} className="flex min-h-14 w-full items-center rounded-2xl px-3 text-left hover:bg-red-500/[.05]">
              <span className="mr-3 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-300">
                <Trash2 className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-xs font-semibold text-red-300">Remove for me</span>
                <span className="mt-0.5 block text-[8px] text-[#6F7585]">The other person keeps their copy</span>
              </span>
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

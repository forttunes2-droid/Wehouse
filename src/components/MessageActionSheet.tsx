import { useEffect } from "react";
import { Reply, Trash2 } from "lucide-react";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type Props = {
  currentReaction?: string | null;
  onReact: (emoji: string) => void;
  onReply?: () => void;
  onRemove?: () => void;
  onClose: () => void;
};

export default function MessageActionSheet({
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
      className="fixed inset-0 z-[100050] flex items-center justify-center bg-black/45 px-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        className="w-full max-w-xs"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
      >
        <div className="flex items-center justify-between gap-0.5 rounded-full border border-white/[.1] bg-[#171A22] p-1.5 shadow-2xl">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              aria-label={`React ${emoji}`}
              aria-pressed={currentReaction === emoji}
              className={`grid h-10 w-10 place-items-center rounded-full text-lg transition active:scale-90 ${currentReaction === emoji ? "bg-violet-500/25 ring-1 ring-violet-400/50" : "hover:bg-white/[.07]"}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="mt-2 overflow-hidden rounded-2xl border border-white/[.09] bg-[#171A22] p-1.5 shadow-2xl">
          {onReply ? (
            <button type="button" onClick={onReply} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-xs font-semibold text-white hover:bg-white/[.05]">
              <Reply className="mr-3 h-4 w-4 text-[#B9BECA]" />
              Reply
            </button>
          ) : null}
          {onRemove ? (
            <button type="button" onClick={onRemove} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-xs font-semibold text-red-300 hover:bg-red-500/[.07]">
              <Trash2 className="mr-3 h-4 w-4" />
              Delete for me
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

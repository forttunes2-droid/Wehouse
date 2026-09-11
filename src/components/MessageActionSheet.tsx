import { useEffect, useState } from "react";
import { Copy, Plus, Reply, Trash2 } from "lucide-react";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const MORE_EMOJIS = [
  "😀", "😁", "🥰", "😍", "🤩", "😘", "😊", "🥹",
  "😎", "🤔", "🙄", "😬", "😭", "😡", "🤯", "🥳",
  "👏", "🙌", "🤝", "💪", "👌", "✌️", "🤞", "🫶",
  "🔥", "✨", "💯", "🎉", "✅", "❌", "👀", "💜",
];

type Props = {
  mode?: "reactions" | "actions";
  currentReaction?: string | null;
  onReact: (emoji: string) => void;
  onReply?: () => void;
  onRemove?: () => void;
  onCopy?: () => void;
  onClose: () => void;
};

export default function MessageActionSheet({
  mode = "reactions",
  currentReaction,
  onReact,
  onReply,
  onRemove,
  onCopy,
  onClose,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  function choose(emoji: string) {
    onReact(emoji);
  }

  function useKeyboardEmoji() {
    const emoji = customEmoji.trim();
    const codePoints = Array.from(emoji);
    if (
      !emoji ||
      codePoints.length > 8 ||
      /[\p{L}\p{N}\s]/u.test(emoji)
    )
      return;
    choose(emoji);
  }

  return (
    <div
      className="fixed inset-0 z-[100050] flex items-end justify-center bg-black/55 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:px-4"
      onClick={onClose}
    >
      <section
        className="w-full max-w-sm"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "reactions" ? "Choose a reaction" : "Message actions"}
      >
        {mode === "reactions" ? (
          <>
            <div className="flex items-center justify-between gap-0.5 rounded-[22px] border border-white/[.1] bg-[#171A22] p-1.5 shadow-2xl">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => choose(emoji)}
                  aria-label={currentReaction === emoji ? "Remove " + emoji + " reaction" : "React " + emoji}
                  aria-pressed={currentReaction === emoji}
                  className={"grid h-10 w-10 place-items-center rounded-full text-lg transition active:scale-90 " + (currentReaction === emoji ? "bg-violet-500/25 ring-1 ring-violet-400/50" : "hover:bg-white/[.07]")}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMoreOpen((value) => !value)}
                aria-label="Show more reactions"
                className={"grid h-10 w-10 place-items-center rounded-full transition " + (moreOpen ? "bg-violet-500/20 text-violet-200" : "text-[#AEB4C0] hover:bg-white/[.07]")}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {moreOpen ? (
              <div className="mt-2 rounded-[22px] border border-white/[.09] bg-[#171A22] p-2.5 shadow-2xl">
                <div className="grid grid-cols-8 gap-1">
                  {MORE_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => choose(emoji)}
                      aria-label={currentReaction === emoji ? "Remove " + emoji + " reaction" : "React " + emoji}
                      aria-pressed={currentReaction === emoji}
                      className={"grid aspect-square place-items-center rounded-lg text-lg active:scale-90 " + (currentReaction === emoji ? "bg-violet-500/25 ring-1 ring-violet-400/50" : "hover:bg-white/[.06]")}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 border-t border-white/[.07] pt-2">
                  <input
                    value={customEmoji}
                    onChange={(event) => setCustomEmoji(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        useKeyboardEmoji();
                      }
                    }}
                    autoComplete="off"
                    aria-label="Emoji from keyboard"
                    placeholder="Choose an emoji from your keyboard"
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#10131A] px-3 text-sm outline-none placeholder:text-[9px] placeholder:text-[#656B79] focus:border-violet-500/45"
                  />
                  <button
                    type="button"
                    onClick={useKeyboardEmoji}
                    disabled={
                      !customEmoji.trim() ||
                      Array.from(customEmoji.trim()).length > 8 ||
                      /[\p{L}\p{N}\s]/u.test(customEmoji.trim())
                    }
                    className="h-10 rounded-xl bg-violet-500 px-3 text-[9px] font-semibold disabled:bg-white/[.06] disabled:text-[#626877]"
                  >
                    React
                  </button>
                </div>
              </div>
            ) : null}
            {currentReaction ? (
              <p className="mt-2 text-center text-[9px] text-white/50">
                Tap your selected reaction to remove it.
              </p>
            ) : null}
          </>
        ) : (
          <div className="overflow-hidden rounded-[22px] border border-white/[.1] bg-[#171A22] shadow-2xl">
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="flex min-h-14 w-full items-center gap-3 border-b border-white/[.07] px-4 text-left text-xs font-semibold"
              >
                <Reply className="h-4 w-4 text-[#AEB4C0]" />
                Reply
              </button>
            ) : null}
            {onCopy ? (
              <button
                type="button"
                onClick={onCopy}
                className="flex min-h-14 w-full items-center gap-3 border-b border-white/[.07] px-4 text-left text-xs font-semibold"
              >
                <Copy className="h-4 w-4 text-[#AEB4C0]" />
                Copy message
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                onClick={onRemove}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-xs font-semibold text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Remove from my chat
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { messageMenuPosition, type MessageMenuAnchor } from "@/lib/messageMenuPosition";
import { Copy, Plus, Reply, Trash2 } from "lucide-react";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
type Props = {
  anchor?: MessageMenuAnchor | null;
  mode?: "reactions" | "actions";
  currentReaction?: string | null;
  onReact: (emoji: string) => void;
  onReply?: () => void;
  onRemove?: () => void;
  onCopy?: () => void;
  onClose: () => void;
};

function firstGrapheme(value: string) {
  const input = value.trim();
  if (!input) return "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return segmenter.segment(input)[Symbol.iterator]().next().value?.segment || "";
  }
  return Array.from(input)[0] || "";
}

export default function MessageActionSheet({
  mode = "reactions",
  anchor = null,
  currentReaction,
  onReact,
  onReply,
  onRemove,
  onCopy,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const [position, setPosition] = useState({ top: 12, left: 12 });
  const [moreOpen, setMoreOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");
  const customEmojiRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const positionMenu = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const viewport = window.visualViewport;
      setPosition(messageMenuPosition(anchor, rect.width, rect.height, {
        width: viewport?.width || window.innerWidth,
        height: viewport?.height || window.innerHeight,
        top: viewport?.offsetTop || 0,
      }));
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
    };
  }, [anchor, moreOpen]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab") return;
      const items = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => { window.removeEventListener("keydown", keyboard); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (moreOpen) customEmojiRef.current?.focus();
  }, [moreOpen]);

  function choose(emoji: string) {
    const reaction = firstGrapheme(emoji);
    if (!reaction) return;
    onReact(reaction);
  }

  return (
    <div
      className="fixed inset-0 z-[100050] bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <section
        ref={panelRef}
        style={position}
        className="fixed w-[min(340px,calc(100vw-24px))] max-h-[calc(var(--wh-visual-viewport-height,100dvh)-24px)] select-none overflow-y-auto rounded-[22px] animate-in fade-in slide-in-from-top-2 duration-150"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Message options"
        data-opened-for={mode}
      >
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
                aria-label="Use an emoji from your keyboard"
                className={"grid h-10 w-10 place-items-center rounded-full transition " + (moreOpen ? "bg-violet-500/20 text-violet-200" : "text-[#AEB4C0] hover:bg-white/[.07]")}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {moreOpen ? (
              <div className="mt-2 rounded-[22px] border border-white/[.09] bg-[#171A22] p-2.5 shadow-2xl">
                <p className="px-1 pb-2 text-[9px] leading-4 text-[#858B9B]">
                  Open your phone keyboard, choose any emoji, then tap React.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    ref={customEmojiRef}
                    value={customEmoji}
                    onChange={(event) => setCustomEmoji(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && firstGrapheme(customEmoji)) {
                        event.preventDefault();
                        choose(customEmoji);
                      }
                    }}
                    inputMode="text"
                    autoComplete="off"
                    aria-label="Emoji from keyboard"
                    placeholder="Choose an emoji"
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#0E1118] px-3 text-[11px] outline-none placeholder:text-[#626879] focus:border-violet-500/35"
                  />
                  <button
                    type="button"
                    disabled={!firstGrapheme(customEmoji)}
                    onClick={() => choose(customEmoji)}
                    className="h-10 rounded-xl bg-violet-500 px-3 text-[9px] font-semibold disabled:opacity-35"
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
        {(onReply || onCopy || onRemove) && (
          <div className="mt-2 overflow-hidden rounded-[22px] border border-white/[.1] bg-[#171A22] shadow-2xl">
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="flex min-h-11 w-full items-center gap-3 border-b border-white/[.07] px-4 text-left text-xs font-semibold"
              >
                <Reply className="h-4 w-4 text-[#AEB4C0]" />
                Reply
              </button>
            ) : null}
            {onCopy ? (
              <button
                type="button"
                onClick={onCopy}
                className="flex min-h-11 w-full items-center gap-3 border-b border-white/[.07] px-4 text-left text-xs font-semibold"
              >
                <Copy className="h-4 w-4 text-[#AEB4C0]" />
                Copy message
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                onClick={onRemove}
                className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-xs font-semibold text-red-300"
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

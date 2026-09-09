import { useEffect, useState } from "react";
import { Reply, Trash2, Plus } from "lucide-react";

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
  const [customOpen, setCustomOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState("");
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

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
        aria-label="Message actions"
      >
        <div className="flex items-center justify-between gap-0.5 rounded-[22px] border border-white/[.1] bg-[#171A22] p-1.5 shadow-2xl">
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
          <button type="button" onClick={()=>setCustomOpen(value=>!value)} aria-label="Choose another reaction" className={`grid h-10 w-10 place-items-center rounded-full transition ${customOpen?'bg-violet-500/20 text-violet-200':'text-[#AEB4C0] hover:bg-white/[.07]'}`}><Plus className="h-4 w-4"/></button>
        </div>
        {customOpen&&<div className="mt-2 flex gap-2 rounded-2xl border border-white/[.09] bg-[#171A22] p-2 shadow-2xl"><input autoFocus inputMode="text" value={customEmoji} onChange={event=>setCustomEmoji(event.target.value.slice(0,12))} placeholder="Choose or type an emoji" className="h-11 min-w-0 flex-1 rounded-xl border border-white/[.08] bg-[#0F1218] px-3 text-sm outline-none focus:border-violet-500/40"/><button type="button" disabled={!customEmoji.trim()} onClick={()=>onReact(customEmoji.trim())} className="h-11 rounded-xl bg-violet-500 px-4 text-[10px] font-semibold disabled:opacity-35">React</button></div>}
        {(onReply||onRemove)&&<div className="mt-2 overflow-hidden rounded-2xl border border-white/[.09] bg-[#171A22] p-1.5 shadow-2xl">
          {onReply ? (
            <button type="button" onClick={onReply} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-xs font-semibold text-white hover:bg-white/[.05]">
              <Reply className="mr-3 h-4 w-4 text-[#B9BECA]" />
              Reply
            </button>
          ) : null}
          {onRemove ? (
            <button type="button" onClick={onRemove} className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-xs font-semibold text-red-300 hover:bg-red-500/[.07]">
              <Trash2 className="mr-3 h-4 w-4" />
              Remove from my chat
            </button>
          ) : null}
        </div>}
      </section>
    </div>
  );
}

import { useState } from "react";
import { Pin, PinOff } from "lucide-react";

export type PinnedPreview = { id: string; text: string };

export default function PinnedMessagesBar({ items, onJump, onUnpin }: {
  items: PinnedPreview[];
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const latest = items[0];
  return (
    <div className="border-b border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)]">
      <div className="flex min-h-11 items-center gap-2 px-4">
        <Pin className="h-4 w-4 shrink-0 text-violet-400" />
        <button type="button" onClick={() => onJump(latest.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-xs text-[var(--wh-text-secondary)]">{latest.text}</span>
        </button>
        {items.length > 1 ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="min-h-11 shrink-0 text-xs font-semibold text-violet-300">
            {open ? "Hide" : `All ${items.length}`}
          </button>
        ) : null}
        <button type="button" onClick={() => onUnpin(latest.id)} aria-label="Unpin message" className="flex h-11 w-9 shrink-0 items-center justify-center text-[var(--wh-text-muted)]">
          <PinOff className="h-4 w-4" />
        </button>
      </div>
      {open ? (
        <ul className="max-h-48 divide-y divide-[var(--wh-border-subtle)] overflow-y-auto border-t border-[var(--wh-border-subtle)]">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-11 items-center gap-2 px-4">
              <button type="button" onClick={() => { onJump(item.id); setOpen(false); }} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs">{item.text}</span>
              </button>
              <button type="button" onClick={() => onUnpin(item.id)} aria-label="Unpin message" className="flex h-11 w-9 shrink-0 items-center justify-center text-[var(--wh-text-muted)]">
                <PinOff className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function scrollToMessage(id: string) {
  const el = document.querySelector(`[data-message-id="${id}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ backgroundColor: "rgba(139,92,246,.25)" }, { backgroundColor: "transparent" }], { duration: 1400 });
  }
}

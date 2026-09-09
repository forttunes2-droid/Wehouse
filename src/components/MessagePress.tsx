import { useRef, useState, type PointerEvent, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  onOpen: () => void;
  onTap?: () => void;
  onReply?: () => void;
};

export default function MessagePress({
  children,
  className = "",
  onOpen,
  onTap,
  onReply,
}: Props) {
  const timer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const opened = useRef(false);
  const dragged = useRef(false);
  const [translate, setTranslate] = useState(0);

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    opened.current = false;
    dragged.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    cancel();
    timer.current = window.setTimeout(() => {
      opened.current = true;
      timer.current = null;
      navigator.vibrate?.(18);
      onOpen();
    }, 420);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const dx = event.clientX - origin.current.x,
      dy = event.clientY - origin.current.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      cancel();
      setTranslate(0);
      return;
    }
    if (onReply && Math.abs(dx) > 8) {
      cancel();
      dragged.current = true;
      const distance = Math.min(72, Math.abs(dx) * 0.72);
      setTranslate(Math.sign(dx) * distance);
    }
  }
  function finish() {
    cancel();
    if (Math.abs(translate) >= 54 && onReply) {
      navigator.vibrate?.(12);
      onReply();
      opened.current = true;
    }
    setTranslate(0);
  }

  return (
    <div
      className={`relative touch-pan-y select-none ${className}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={() => {
        cancel();
        setTranslate(0);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
        onOpen();
      }}
      onClick={(event) => {
        if (opened.current || dragged.current || !onTap) return;
        const target = event.target as HTMLElement;
        if (target.closest("button,a,input,textarea,audio,video")) return;
        onTap();
      }}
      onClickCapture={(event) => {
        if (!opened.current && !dragged.current) return;
        event.preventDefault();
        event.stopPropagation();
        opened.current = false;
      }}
    >
      {onReply && translate !== 0 ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute ${translate > 0 ? "left-1" : "right-1"} grid h-8 w-8 place-items-center rounded-full bg-violet-500 text-sm text-white transition-opacity ${Math.abs(translate) >= 54 ? "opacity-100" : "opacity-45"}`}
        >
          ↩
        </span>
      ) : null}
      <div
        style={{ transform: `translateX(${translate}px)` }}
        className="transition-[transform] duration-75"
      >
        {children}
      </div>
    </div>
  );
}

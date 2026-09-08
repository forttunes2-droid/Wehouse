import { useRef, type PointerEvent, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  onOpen: () => void;
};

export default function MessagePress({ children, className = "", onOpen }: Props) {
  const timer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const opened = useRef(false);

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    opened.current = false;
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
    if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel();
  }

  return (
    <div
      className={`touch-pan-y select-none ${className}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
        onOpen();
      }}
      onDoubleClick={onOpen}
      onClickCapture={(event) => {
        if (!opened.current) return;
        event.preventDefault();
        event.stopPropagation();
        opened.current = false;
      }}
    >
      {children}
    </div>
  );
}

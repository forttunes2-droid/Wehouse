import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { useDialogInteraction } from "@/hooks/useDialogInteraction";
import { displayDate } from "@/lib/displayDate";

function parseCalendarDate(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() + 1 === Number(match[2]) && date.getDate() === Number(match[3]) ? date : undefined;
}

function calendarValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function BookingDateField({ label, value, min, max, onChange, context = "Stay dates" }: {
  label: string; value: string; min?: string; max?: string; context?: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pointer = useRef<{ x: number; y: number; top: number; at: number; moved: boolean } | null>(null);
  const dialogRef = useDialogInteraction(() => setOpen(false), open);
  const selected = parseCalendarDate(value);
  const first = parseCalendarDate(min);
  const last = parseCalendarDate(max);
  const today = new Date();
  const initialMonth = selected || first || (last && last < today ? last : today);
  const historical = Boolean(last && last < today && !first);
  const unavailable = Boolean(min && max && min > max);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("wehouse:navigation", close);
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    return () => {
      window.removeEventListener("wehouse:navigation", close);
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
    };
  }, [open]);

  return <div className="min-w-0">
    <span className="mb-2 block text-xs text-[#A1A1AA]">{label}</span>
    <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={unavailable}
      onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY, top: event.currentTarget.getBoundingClientRect().top, at: performance.now(), moved: false }; }}
      onPointerMove={event => { if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 8) pointer.current.moved = true; }}
      onPointerCancel={() => { if (pointer.current) pointer.current.moved = true; }}
      onClick={event => {
        // Some mobile browsers dispatch a click after a finger slides across a
        // control while scrolling. Only a deliberate tap may open the calendar.
        const gesture = pointer.current;
        const dragged = Boolean(gesture && performance.now() - gesture.at < 1000 &&
          (gesture.moved || Math.abs(event.currentTarget.getBoundingClientRect().top - gesture.top) > 4));
        pointer.current = null;
        if (dragged) { event.preventDefault(); return; }
        setOpen(true);
      }}
      className="flex min-h-12 w-full touch-manipulation items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[.04] px-3 text-left text-sm text-white outline-none focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:opacity-40">
      <span className="min-w-0 truncate">{value ? displayDate(value) : "Choose date"}</span>
      <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-300" />
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100300] flex touch-none items-end justify-center bg-black/75 sm:items-center sm:p-5" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label={`Choose ${label}`} onClick={event => event.stopPropagation()}
          className="max-h-[calc(100dvh-1rem)] w-full touch-pan-y overflow-y-auto overscroll-contain rounded-t-3xl border border-white/10 bg-[#11141C] text-white shadow-2xl sm:max-w-md sm:rounded-3xl">
          <header className="flex items-start justify-between gap-3 border-b border-white/[.07] px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-violet-300">{context}</p>
              <h2 className="mt-1 text-lg font-semibold">Choose {label.toLowerCase()}</h2>
              <p className="mt-1 text-xs text-[#A1A7B5]">{value ? displayDate(value) : "Select an available day"}</p>
            </div>
            <button type="button" aria-label="Close calendar" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-xl text-[#B5BBC8]">×</button>
          </header>
          <div className="flex justify-center px-1 py-4">
            <Calendar mode="single" selected={selected} defaultMonth={initialMonth}
              startMonth={first || (historical ? new Date(1900, 0, 1) : undefined)} endMonth={last} showOutsideDays={false}
              captionLayout={historical ? "dropdown" : "label"}
              disabled={[...(first ? [{ before: first }] : []), ...(last ? [{ after: last }] : [])]}
              onSelect={date => { if (date) { onChange(calendarValue(date)); setOpen(false); } }}
              className="w-full max-w-sm rounded-2xl bg-[#171B25] p-2 [--cell-size:2.5rem]"
              classNames={{ caption_label: "text-sm font-semibold text-white", weekday: "flex-1 text-xs text-[#9AA2B3]", today: "rounded-xl bg-violet-500/10 text-violet-200", selected: "rounded-xl bg-violet-500 text-white", day_button: "rounded-xl hover:bg-white/[.08]" }} />
          </div>
          <p className="border-t border-white/[.07] px-5 py-3 pb-[max(.85rem,env(safe-area-inset-bottom))] text-xs text-[#9AA2B3]">{label === "Check-out" ? "Choose a day after check-in." : context === "Stay dates" ? "Dates outside the booking window are unavailable." : "Choose a date inside the allowed range."}</p>
        </section>
      </div>, document.body)}
  </div>;
}

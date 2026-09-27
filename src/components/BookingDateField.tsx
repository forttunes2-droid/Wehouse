import { useEffect, useState } from "react";
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

export default function BookingDateField({ label, value, min, max, onChange }: {
  label: string; value: string; min?: string; max?: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogInteraction(() => setOpen(false), open);
  const selected = parseCalendarDate(value);
  const first = parseCalendarDate(min);
  const last = parseCalendarDate(max);
  const unavailable = Boolean(min && max && min > max);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener("wehouse:navigation", close);
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("wehouse:navigation", close);
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
    };
  }, [open]);

  return <div className="min-w-0">
    <span className="mb-2 block text-xs text-[#A1A1AA]">{label}</span>
    <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={unavailable}
      onClick={() => setOpen(true)}
      className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[.04] px-3 text-left text-sm text-white outline-none focus-visible:border-violet-400 focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:opacity-40">
      <span className="min-w-0 truncate">{value ? displayDate(value) : "Choose date"}</span>
      <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-300" />
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100300] flex items-end justify-center bg-black/75 sm:items-center sm:p-5" onClick={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-label={`Choose ${label}`} onClick={event => event.stopPropagation()}
          className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-[#11141C] text-white shadow-2xl sm:max-w-md sm:rounded-3xl">
          <header className="flex items-start justify-between gap-3 border-b border-white/[.07] px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-violet-300">Stay dates</p>
              <h2 className="mt-1 text-lg font-semibold">Choose {label.toLowerCase()}</h2>
              <p className="mt-1 text-xs text-[#A1A7B5]">{value ? displayDate(value) : "Select an available day"}</p>
            </div>
            <button type="button" aria-label="Close calendar" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-xl text-[#B5BBC8]">×</button>
          </header>
          <div className="flex justify-center px-1 py-4">
            <Calendar mode="single" selected={selected} defaultMonth={selected || first || new Date()}
              startMonth={first} endMonth={last} showOutsideDays={false}
              disabled={[...(first ? [{ before: first }] : []), ...(last ? [{ after: last }] : [])]}
              onSelect={date => { if (date) { onChange(calendarValue(date)); setOpen(false); } }}
              className="w-full max-w-sm rounded-2xl bg-[#171B25] p-2 [--cell-size:2.5rem]"
              classNames={{ caption_label: "text-sm font-semibold text-white", weekday: "flex-1 text-xs text-[#9AA2B3]", today: "rounded-xl bg-violet-500/10 text-violet-200", selected: "rounded-xl bg-violet-500 text-white", day_button: "rounded-xl hover:bg-white/[.08]" }} />
          </div>
          <p className="border-t border-white/[.07] px-5 py-3 pb-[max(.85rem,env(safe-area-inset-bottom))] text-xs text-[#9AA2B3]">{label === "Check-out" ? "Choose a day after check-in." : "Dates outside the booking window are unavailable."}</p>
        </section>
      </div>, document.body)}
  </div>;
}

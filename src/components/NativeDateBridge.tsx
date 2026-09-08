import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar } from "@/components/ui/calendar";

function dateTitle(input: HTMLInputElement) {
  const aria = input.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const label = input.closest("label");
  if (label) {
    const clone = label.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input,select,textarea,button").forEach((node) => node.remove());
    const text = clone.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "Choose a date";
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function NativeDateBridge() {
  const [active, setActive] = useState<HTMLInputElement | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    function open(event: PointerEvent) {
      const input = (event.target as Element | null)?.closest?.(
        'input[type="date"]',
      ) as HTMLInputElement | null;
      if (!input || input.disabled || input.readOnly || input.dataset.wehouseNative === "true") return;
      event.preventDefault();
      event.stopPropagation();
      setActive(input);
      setVersion((value) => value + 1);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
    }
    document.addEventListener("pointerdown", open, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", open, true);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);

  const values = useMemo(() => {
    if (!active) return { selected: undefined, min: undefined, max: undefined };
    return {
      selected: parseDate(active.value),
      min: parseDate(active.min),
      max: parseDate(active.max),
    };
  }, [active, version]);

  if (!active || typeof document === "undefined") return null;
  const title = dateTitle(active);
  const disabled = [
    ...(values.min ? [{ before: values.min }] : []),
    ...(values.max ? [{ after: values.max }] : []),
  ];

  function choose(date: Date | undefined) {
    if (!active || !date) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const value = formatDate(date);
    if (setter) setter.call(active, value);
    else active.value = value;
    active.dispatchEvent(new Event("input", { bubbles: true }));
    active.dispatchEvent(new Event("change", { bubbles: true }));
    active.focus({ preventScroll: true });
    setActive(null);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-5"
      onClick={() => setActive(null)}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full overflow-hidden rounded-t-[28px] border border-white/[.09] bg-[#0E1118] text-white shadow-2xl shadow-black/70 sm:max-w-md sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/[.06] px-5 py-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">WEHOUSE CALENDAR</p>
            <h2 className="mt-1 text-base font-semibold">{title}</h2>
            <p className="mt-1 text-[10px] text-[#747A8B]">
              {values.selected ? values.selected.toLocaleDateString(undefined, { dateStyle: "long" }) : "Choose an available date"}
            </p>
          </div>
          <button type="button" onClick={() => setActive(null)} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-lg text-[#A7ACB9]" aria-label="Close calendar">×</button>
        </header>
        <div className="flex justify-center px-3 py-4">
          <Calendar
            mode="single"
            selected={values.selected}
            defaultMonth={values.selected || values.min || new Date()}
            disabled={disabled}
            onSelect={choose}
            className="w-full max-w-sm rounded-2xl bg-[#11151E] p-3 [--cell-size:2.65rem]"
            classNames={{
              caption_label: "text-sm font-semibold text-white",
              weekday: "flex-1 text-[.72rem] font-medium text-[#697080]",
              today: "rounded-xl bg-violet-500/10 text-violet-200",
              selected: "rounded-xl bg-violet-500 text-white",
              day_button: "rounded-xl hover:bg-white/[.06]",
            }}
          />
        </div>
        <footer className="border-t border-white/[.06] px-5 py-3 pb-[max(.85rem,env(safe-area-inset-bottom))] text-[9px] text-[#646B7B]">
          Dates outside the allowed booking range are unavailable.
        </footer>
      </section>
    </div>,
    document.body,
  );
}

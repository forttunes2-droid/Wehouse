import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar } from "@/components/ui/calendar";

function dateTitle(input: HTMLInputElement) {
  const aria = input.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const label = input.closest("label");
  if (label) {
    const clone = label.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("input,select,textarea,button")
      .forEach((node) => node.remove());
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
  const [pendingDate, setPendingDate] = useState<Date | undefined>();
  const [pendingTime, setPendingTime] = useState("09:00");

  useEffect(() => {
    function open(event: Event) {
      const input = (event.target as Element | null)?.closest?.(
        'input[type="date"],input[type="datetime-local"]',
      ) as HTMLInputElement | null;
      if (
        !input ||
        input.disabled ||
        input.readOnly ||
        input.dataset.wehouseNative === "true"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
      input.blur();
      const [dateValue, timeValue] = input.value.split("T");
      setPendingDate(parseDate(dateValue));
      setPendingTime(timeValue?.slice(0, 5) || "09:00");
      setActive(input);
      setVersion((value) => value + 1);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
    }
    const close = () => setActive(null);
    document.addEventListener("pointerdown", open, true);
    document.addEventListener("click", open, true);
    document.addEventListener("keydown", escape);
    document.addEventListener("submit", close, true);
    document.addEventListener("reset", close, true);
    window.addEventListener("wehouse:navigation", close);
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    window.addEventListener("pagehide", close);
    return () => {
      document.removeEventListener("pointerdown", open, true);
      document.removeEventListener("click", open, true);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("submit", close, true);
      document.removeEventListener("reset", close, true);
      window.removeEventListener("wehouse:navigation", close);
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
      window.removeEventListener("pagehide", close);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const observer = new MutationObserver(() => {
      if (!active.isConnected) setActive(null);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.body.style.overflow = previous;
    };
  }, [active]);

  const values = useMemo(() => {
    if (!active) return { selected: undefined, min: undefined, max: undefined };
    return {
      selected: pendingDate || parseDate(active.value.split("T")[0]),
      min: parseDate(active.min.split("T")[0]),
      max: parseDate(active.max.split("T")[0]),
    };
  }, [active, pendingDate, version]);

  if (!active || typeof document === "undefined") return null;
  const title = dateTitle(active);
  const includesTime = active.type === "datetime-local";
  const disabled = [
    ...(values.min ? [{ before: values.min }] : []),
    ...(values.max ? [{ after: values.max }] : []),
  ];

  function choose(date: Date | undefined) {
    if (!active || !date) return;
    if (includesTime) {
      setPendingDate(date);
      return;
    }
    commit(formatDate(date));
  }

  function commit(value: string) {
    if (!active) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(active, value);
    else active.value = value;
    active.dispatchEvent(new Event("input", { bubbles: true }));
    active.dispatchEvent(new Event("change", { bubbles: true }));
    setActive(null);
  }

  const dateTimeValue = pendingDate ? `${formatDate(pendingDate)}T${pendingTime}` : "";
  const dateTimeInvalid = includesTime && (!dateTimeValue || Boolean(active.min && dateTimeValue < active.min) || Boolean(active.max && dateTimeValue > active.max));
  const timeOptions = Array.from(
    new Set([
      pendingTime,
      ...Array.from({ length: 96 }, (_, index) => {
        const hour = Math.floor(index / 4);
        const minute = (index % 4) * 15;
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      }),
    ]),
  ).sort();

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
            <p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">
              WEHOUSE CALENDAR
            </p>
            <h2 className="mt-1 text-base font-semibold">{title}</h2>
            <p className="mt-1 text-[10px] text-[#747A8B]">
              {values.selected
                ? values.selected.toLocaleDateString(undefined, {
                    dateStyle: "long",
                  })
                : "Choose an available date"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActive(null)}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05] text-lg text-[#A7ACB9]"
            aria-label="Close calendar"
          >
            ×
          </button>
        </header>
        <div className="flex justify-center px-3 py-4">
          <Calendar
            mode="single"
            selected={values.selected}
            defaultMonth={values.selected || values.min || new Date()}
            startMonth={values.min}
            endMonth={values.max}
            showOutsideDays={false}
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
        {includesTime ? (
          <div className="border-t border-white/[.06] px-5 py-4">
            <label className="block text-[9px] font-semibold text-[#9EA4B2]">
              Time
              <select value={pendingTime} onChange={(event) => setPendingTime(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-[#171B24] px-3 text-xs text-white outline-none">
                {timeOptions.map((value) => {
                  const [hour, minute] = value.split(":").map(Number);
                  const label = new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                  return <option key={value} value={value}>{label}</option>;
                })}
              </select>
            </label>
            <button type="button" disabled={dateTimeInvalid} onClick={() => commit(dateTimeValue)} className="mt-3 h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-35">Use this date and time</button>
            {dateTimeInvalid ? <p className="mt-2 text-[9px] text-amber-300">Choose a date and time inside the allowed window.</p> : null}
          </div>
        ) : null}
        <footer className="border-t border-white/[.06] px-5 py-3 pb-[max(.85rem,env(safe-area-inset-bottom))] text-[9px] text-[#646B7B]">
          {includesTime ? "The selected time uses your device time zone." : "Dates outside this booking window are unavailable."}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

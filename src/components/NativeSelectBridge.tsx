import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
};

function selectTitle(select: HTMLSelectElement) {
  const aria = select.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const labelledBy = select.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }
  const wrappingLabel = select.closest('label');
  if (wrappingLabel) {
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('select,input,textarea,button').forEach((node) => node.remove());
    const text = clone.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  const previous = select.previousElementSibling?.textContent?.replace(/\s+/g, ' ').trim();
  return previous || 'Choose an option';
}

export default function NativeSelectBridge() {
  const [active, setActive] = useState<HTMLSelectElement | null>(null);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    function open(event: PointerEvent) {
      const target = event.target as Element | null;
      const select = target?.closest?.('select') as HTMLSelectElement | null;
      if (!select || select.disabled || select.multiple || select.size > 1 || select.dataset.wehouseNative === 'true') return;

      event.preventDefault();
      event.stopPropagation();
      setActive(select);
      setSearch('');
      setVersion((value) => value + 1);
    }

    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setActive(null);
    }

    document.addEventListener('pointerdown', open, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', open, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const options = useMemo<SelectOption[]>(() => {
    if (!active) return [];
    return Array.from(active.options).map((option) => ({
      value: option.value,
      label: option.textContent?.trim() || option.label || option.value,
      disabled: option.disabled,
    }));
  }, [active, version]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(needle));
  }, [options, search]);

  if (!active || typeof document === 'undefined') return null;

  const title = selectTitle(active);
  const currentValue = active.value;

  function choose(value: string) {
    if (!active) return;
    active.value = value;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    setActive(null);
    setSearch('');
  }

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={() => setActive(null)}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg overflow-hidden rounded-t-3xl border border-white/[0.09] bg-[#0E1118] shadow-2xl shadow-black/70 sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">WEHOUSE</p>
            <h2 className="mt-1 truncate text-base font-semibold text-white">{title}</h2>
          </div>
          <button type="button" onClick={() => setActive(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-lg text-[#A1A6B3]">×</button>
        </header>

        <div className="border-b border-white/[0.06] p-3 sm:p-4">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-[#171B24] px-3 focus-within:border-violet-500/40">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[#686F7F]"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Type to search…"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#626979]"
            />
          </div>
        </div>

        <div className="max-h-[55dvh] overflow-y-auto p-2 sm:max-h-[420px]">
          {shown.map((option) => (
            <button
              key={`${option.value}:${option.label}`}
              type="button"
              disabled={option.disabled}
              onClick={() => choose(option.value)}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition disabled:opacity-30 ${option.value === currentValue ? 'bg-violet-500/15 text-violet-200' : 'text-[#D5D8E0] hover:bg-white/[0.04]'}`}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === currentValue ? <span className="text-violet-300">✓</span> : null}
            </button>
          ))}
          {shown.length === 0 ? <div className="px-4 py-12 text-center text-xs text-[#666D7D]">No matching option</div> : null}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] text-[9px] text-[#626979] sm:px-5">
          Search by typing any part of the option name.
        </div>
      </section>
    </div>,
    document.body,
  );
}

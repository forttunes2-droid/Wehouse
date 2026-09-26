import { useDialogInteraction } from "@/hooks/useDialogInteraction";
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
  const dialogRef = useDialogInteraction(() => setActive(null), Boolean(active));
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    const observer = new MutationObserver(() => { if (!active.isConnected) close(); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("wehouse:navigation", close);
    return () => { observer.disconnect(); window.removeEventListener("wehouse:navigation", close); };
  }, [active]);

  useEffect(() => {
    function open(event: PointerEvent) {
      const target = event.target as Element | null;
      const select = target?.closest?.('select') as HTMLSelectElement | null;
      if (!select || select.disabled || select.multiple || select.size > 1 || select.dataset.wehouseNative === 'true') return;

      event.preventDefault();
      event.stopPropagation();
      setActive(select);
      setVersion((value) => value + 1);
    }


    document.addEventListener('pointerdown', open, true);

    return () => {
      document.removeEventListener('pointerdown', open, true);

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

  if (!active || typeof document === 'undefined') return null;

  const title = selectTitle(active);
  const currentValue = active.value;

  function choose(value: string) {
    if (!active?.isConnected) { setActive(null); return; }
    // React tracks form values on the element instance. Using the native
    // prototype setter ensures React receives the change instead of restoring
    // the previous controlled value after this sheet closes.
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(active, value);
    else active.value = value;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    active.focus({ preventScroll: true });
    setActive(null);
  }

  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100300] flex items-center justify-center bg-[#0E1118] p-4" onClick={() => setActive(null)}>
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

        <div className="max-h-[55dvh] overflow-y-auto p-2 sm:max-h-[420px]">
          {options.map((option) => (
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
        </div>

        <div className="border-t border-white/[0.06] px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] text-[9px] text-[#626979] sm:px-5">
          Choose one option.
        </div>
      </section>
    </div>,
    document.body,
  );
}

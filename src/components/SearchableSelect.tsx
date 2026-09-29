import { useEffect, useMemo, useRef, useState } from 'react';

type Option = { value: string; label: string; meta?: string; keywords?: string };
type Props = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  emptyText?: string;
};

export default function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  searchPlaceholder = 'Type to search…',
  disabled = false,
  emptyText = 'No results',
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.value} ${option.meta || ''} ${option.keywords || ''}`.toLowerCase().includes(needle));
  }, [options, search]);

  useEffect(() => {
    function close(event: MouseEvent | TouchEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, []);

  return (
    <label className="block">
      {label ? <span className="mb-1.5 block text-[10px] font-medium text-[var(--wh-text-muted)]">{label}</span> : null}
      <div ref={root} className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (disabled) return;
            setOpen((current) => !current);
            setSearch('');
          }}
          className="flex h-11 w-full items-center justify-between rounded-xl border border-white/[0.08] bg-[var(--wh-elevated)] px-3 text-left text-xs text-[var(--wh-text)] outline-none transition focus:border-violet-500/45 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className={selected ? 'truncate text-white' : 'truncate text-[var(--wh-text-muted)]'}>{selected?.label || placeholder}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`shrink-0 text-[var(--wh-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
        </button>

        {open && !disabled ? (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[120] overflow-hidden rounded-2xl border border-white/[0.09] bg-[var(--wh-surface)] shadow-2xl shadow-black/60">
            <div className="border-b border-white/[0.06] p-2.5">
              <div className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-[var(--wh-surface)] px-3 focus-within:border-violet-500/40">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-[var(--wh-text-muted)]"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[var(--wh-text-muted)]" />
              </div>
            </div>
            <div role="listbox" className="max-h-60 overflow-y-auto p-1.5">
              {filtered.map((option) => (
                <button
                  key={option.value || option.label}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-xs transition ${option.value === value ? 'bg-violet-500/14 text-violet-200' : 'text-[#D1D4DC] hover:bg-white/[0.04]'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.meta ? <span className="rounded-full bg-[var(--wh-interactive)] px-2 py-0.5 text-[8px] text-[var(--wh-text-muted)]">{option.meta}</span> : null}
                  {option.value === value ? <span className="text-violet-300">✓</span> : null}
                </button>
              ))}
              {filtered.length === 0 ? <div className="px-3 py-5 text-center text-[10px] text-[var(--wh-text-muted)]">{emptyText}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </label>
  );
}

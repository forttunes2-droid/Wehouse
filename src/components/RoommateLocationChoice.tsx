import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isolateDialog } from '@/lib/dialogIsolation';

type Props = {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
};

export default function RoommateLocationChoice({ label, value, options, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !root.current) return;
    const release = isolateDialog(root.current);
    search.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      release();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open]);
  const matches = options.filter(option => option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <button ref={trigger} type="button" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setQuery(''); setOpen(true); }}
      className="mt-2 flex min-h-12 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-[var(--wh-elevated)] px-3 text-left text-sm text-white focus-visible:border-violet-400 disabled:opacity-40">
      <span className="truncate">{value || `Choose ${label.toLowerCase()}`}</span><span aria-hidden="true" className="text-violet-300">⌄</span>
    </button>
    {open && createPortal(<div ref={root} className="fixed inset-0 z-[100200] flex items-end bg-black/75 sm:items-center sm:justify-center sm:p-5" role="presentation" onClick={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}
        className="flex max-h-[80dvh] w-full flex-col rounded-t-3xl border border-[var(--wh-border)] bg-[var(--wh-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-base font-semibold">Choose {label.toLowerCase()}</h3>
          <button type="button" aria-label="Close locations" className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/[.06]" onClick={() => setOpen(false)}>×</button>
        </div>
        <input ref={search} aria-label={`Search ${label.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`} className="my-3 min-h-12 rounded-xl border border-white/10 bg-[var(--wh-elevated)] px-4 text-base text-white outline-none focus:border-violet-400" />
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {matches.map(option => <button key={option} type="button" aria-pressed={option === value}
            onClick={() => { onChange(option); setOpen(false); }} className="flex min-h-12 w-full items-center justify-between border-b border-white/[.06] px-2 py-2 text-left text-sm last:border-0">
            {option}{option === value ? <span className="text-violet-300">✓</span> : null}
          </button>)}
          {!matches.length && <p className="py-6 text-sm text-[var(--wh-text-secondary)]">No matching location</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}

import { Children, isValidElement, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { isolateDialog } from '@/lib/dialogIsolation';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> & {
  value: string | number;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
};
type Choice = { value: string; label: string; disabled: boolean };

function asText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(asText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return asText(node.props.children);
  return '';
}

function choicesFrom(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return [];
    if (child.type === 'option') return [{
      value: String(child.props.value ?? asText(child.props.children)),
      label: asText(child.props.children).trim(),
      disabled: Boolean(child.props.disabled),
    }];
    return choicesFrom(child.props.children);
  });
}

/** The controlled select contract with an in-app sheet instead of an OS popup. */
export default function WeHouseChoice({ value, onChange, children, disabled, className = '', title, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const headingId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const options = choicesFrom(children);
  const selected = options.find(option => option.value === String(value));
  const label = String(rest['aria-label'] || title || 'Choose an option');
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open || !root.current) return;
    const release = isolateDialog(root.current);
    (search.current || root.current.querySelector<HTMLButtonElement>('[data-choice]'))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab' || !root.current) return;
      const controls = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); release(); trigger.current?.focus({ preventScroll: true }); };
  }, [open]);

  function choose(next: string) {
    // Existing controlled callers read only event.target.value. Preserve that
    // contract while the actual interaction is an accessible button dialog.
    onChange({ target: { value: next }, currentTarget: { value: next } } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  }

  return <>
    <button ref={trigger} type="button" disabled={disabled} aria-label={rest['aria-label']} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setQuery(''); setOpen(true); }}
      className={`flex min-h-11 min-w-0 items-center justify-between gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 disabled:opacity-40 ${className}`}>
      <span className="min-w-0 truncate">{selected?.label || 'Choose'}</span><span aria-hidden="true" className="shrink-0 text-violet-300">⌄</span>
    </button>
    {open && createPortal(<div ref={root} role="presentation" onClick={() => setOpen(false)}
      className="fixed inset-0 z-[100300] flex items-end bg-black/75 sm:items-center sm:justify-center sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby={headingId} onClick={event => event.stopPropagation()}
        className="flex max-h-[82dvh] w-full flex-col rounded-t-3xl border border-[var(--wh-border)] bg-[#11141C] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3">
          <h3 id={headingId} className="text-base font-semibold">{label}</h3>
          <button type="button" aria-label="Close options" onClick={() => setOpen(false)} className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/[.06]">×</button>
        </div>
        {options.length > 8 && <input ref={search} aria-label={`Search ${label.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Search options" className="my-3 min-h-12 rounded-xl border border-white/10 bg-[#1A1E29] px-4 text-base text-white outline-none focus:border-violet-400" />}
        <div className="min-h-0 overflow-y-auto overscroll-contain pt-2">
          {filtered.map(option => <button key={option.value} data-choice type="button" disabled={option.disabled}
            aria-pressed={option.value === String(value)} onClick={() => choose(option.value)}
            className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-white/[.06] px-2 py-2 text-left text-sm last:border-0 disabled:opacity-40">
            <span>{option.label}</span>{option.value === String(value) && <span aria-hidden="true" className="text-violet-300">✓</span>}
          </button>)}
          {!filtered.length && <p className="py-6 text-sm text-[var(--wh-text-secondary)]">No matching option</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}

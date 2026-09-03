import { useEffect, useId, useMemo, useState } from 'react';

export type WeHouseSelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
};

type Props<T extends string> = {
  value: T;
  options: readonly WeHouseSelectOption<T>[];
  onChange: (value: T) => void;
  title?: string;
  eyebrow?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

export default function WeHouseSelect<T extends string>({value,options,onChange,title='Choose an option',eyebrow='WeHouse',ariaLabel='Choose an option',disabled=false,className=''}:Props<T>){
  const[open,setOpen]=useState(false);
  const titleId=useId();
  const selected=useMemo(()=>options.find(option=>option.value===value)??options[0],[options,value]);
  useEffect(()=>{if(!open)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[open]);
  return <>
    <button type="button" disabled={disabled} onClick={()=>setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} className={`flex h-10 min-w-36 items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-[#111119] px-3 text-left text-[10px] font-semibold text-[#B3B7C3] outline-none transition focus:border-violet-500/40 disabled:opacity-40 ${className}`}><span className="truncate">{selected?.label??'Choose'}</span><span aria-hidden="true" className="text-violet-300">⌄</span></button>
    {open&&<div className="fixed inset-0 z-[100100] flex items-end bg-black/70 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-5" role="presentation" onClick={()=>setOpen(false)}><section className="max-h-[82dvh] w-full overflow-y-auto rounded-t-[28px] border border-white/[.08] bg-[#11131A] p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-[28px] sm:pb-4" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event=>event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">{eyebrow}</p><h3 id={titleId} className="mt-1 text-base font-bold">{title}</h3></div><button type="button" onClick={()=>setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-white/[.05]" aria-label="Close options">×</button></div><div className="divide-y divide-white/[.06]">{options.map(option=><button key={option.value} type="button" onClick={()=>{onChange(option.value);setOpen(false)}} className="flex min-h-16 w-full items-center gap-3 py-3 text-left"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${value===option.value?'border-violet-400 bg-violet-500':'border-white/20'}`}>{value===option.value&&<span className="h-1.5 w-1.5 rounded-full bg-white"/>}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{option.label}</span>{option.description&&<span className="mt-1 block text-[9px] text-[#727889]">{option.description}</span>}</span></button>)}</div></section></div>}
  </>;
}

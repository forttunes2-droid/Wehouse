type Props={onOpen:()=>void};

export default function AssistantEntryCard({onOpen}:Props){
 return <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[.025] active:bg-white/[.04]">
  <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/10">
   <AssistantIcon/>
   <span className="absolute -right-0.5 -top-0.5 rounded-full border-2 border-[#11141C] bg-[#151A25] px-1.5 py-0.5 text-[7px] font-bold text-blue-200">AI</span>
  </div>
  <div className="min-w-0 flex-1">
   <div className="flex items-center gap-2"><p className="truncate text-[13px] font-semibold text-white">WeHouse Assistant</p><span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[7px] font-semibold text-blue-300">Guide</span></div>
   <p className="mt-1 truncate text-[9px] text-[#6C7282]">Homes, Workers, Roommates and how to use WeHouse</p>
  </div>
  <span className="text-lg text-[#555C6D]">›</span>
 </button>
}
function AssistantIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4"/></svg>}

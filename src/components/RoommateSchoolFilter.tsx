type Props={school:string;sameSchool:boolean;profileSchool?:string|null;onSchool:(value:string)=>void;onToggle:()=>void};

export default function RoommateSchoolFilter({school,sameSchool,profileSchool,onSchool,onToggle}:Props){
 return <section className="rounded-2xl border border-blue-500/15 bg-blue-500/[.04] p-4">
  <div className="flex items-start justify-between gap-4">
   <div className="min-w-0"><p className="text-xs font-semibold">Same-school matching <span className="font-normal text-[#737889]">(optional)</span></p><p className="mt-1 text-[10px] leading-relaxed text-[#737889]">Enter your school. Turn this on only when you want candidates from other schools excluded.</p></div>
   <button type="button" disabled={!school.trim()} aria-pressed={sameSchool} onClick={onToggle} className={`relative h-7 w-12 shrink-0 rounded-full disabled:opacity-35 ${sameSchool?'bg-blue-500':'bg-[#292D37]'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${sameSchool?'left-6':'left-1'}`}/></button>
  </div>
  <input value={school} onChange={event=>onSchool(event.target.value)} placeholder={profileSchool||'Enter your school'} className="mt-4 h-11 w-full rounded-xl border border-white/[.08] bg-[#0D0F16] px-3 text-xs text-white outline-none focus:border-blue-500/40"/>
  <p className="mt-2 text-[9px] leading-relaxed text-[#677083]">{sameSchool?`Only verified candidates whose saved school matches “${school.trim()}” will be shown.`:'School does not restrict your matches while this is off.'}</p>
 </section>
}

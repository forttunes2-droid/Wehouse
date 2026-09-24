import {useId} from 'react';
type Props={school:string;sameSchool:boolean;profileSchool?:string|null;onSchool:(value:string)=>void;onToggle:()=>void};
export default function RoommateSchoolFilter({school,sameSchool,profileSchool,onSchool,onToggle}:Props){
 const id=useId();
 return <section className="border-y border-white/[.07] py-4">
  <div className="flex items-start justify-between gap-4">
   <div className="min-w-0"><h3 id={id+'-title'} className="text-base font-semibold">Same-school matching <span className="text-sm font-normal text-[#AAA3B3]">(optional)</span></h3><p id={id+'-hint'} className="mt-2 text-sm leading-6 text-[#AAA3B3]">Only suggest people from your school.</p></div>
   <button type="button" role="switch" aria-label="Same-school matching" aria-describedby={id+'-hint'} disabled={!school.trim()} aria-checked={sameSchool} onClick={onToggle} className="grid h-11 w-14 shrink-0 place-items-center rounded-xl disabled:opacity-35 focus-visible:outline focus-visible:outline-violet-300"><span className={`relative block h-7 w-12 rounded-full ${sameSchool?'bg-violet-500':'bg-[#292D37]'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${sameSchool?'left-6':'left-1'}`}/></span></button>
  </div>
  <label htmlFor={id+'-school'} className="mt-4 block text-sm font-medium">Your school</label>
  <input id={id+'-school'} value={school} onChange={event=>onSchool(event.target.value)} placeholder={profileSchool||'Enter your school'} className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#171923] px-3 text-base text-white outline-none focus:border-violet-400"/>
  <p className="sr-only">Existing connections are not removed when this preference changes.</p>
 </section>;
}

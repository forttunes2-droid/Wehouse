import {useId} from 'react';
import SettingSwitch from '@/components/SettingSwitch';
type Props={school:string;sameSchool:boolean;profileSchool?:string|null;onSchool:(value:string)=>void;onToggle:()=>void};
export default function RoommateSchoolFilter({school,sameSchool,profileSchool,onSchool,onToggle}:Props){
 const id=useId();
 return <section className="border-y border-[var(--wh-border-subtle)] py-4">
  <div className="flex items-start justify-between gap-4">
   <div className="min-w-0"><h3 id={id+'-title'} className="text-base font-semibold">Same-school matching <span className="text-sm font-normal text-[var(--wh-text-secondary)]">(optional)</span></h3><p id={id+'-hint'} className="mt-2 text-sm leading-6 text-[var(--wh-text-secondary)]">Only suggest people from your school.</p></div>
   <SettingSwitch label="Same-school matching" disabled={!school.trim()} checked={sameSchool} onChange={onToggle}/>
  </div>
  <label htmlFor={id+'-school'} className="mt-4 block text-sm font-medium">Your school</label>
  <input id={id+'-school'} value={school} onChange={event=>onSchool(event.target.value)} placeholder={profileSchool||'Enter your school'} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--wh-border-subtle)] bg-[var(--wh-elevated)] px-3 text-base text-[var(--wh-text)] outline-none focus:border-violet-400"/>
  <p className="mt-2 text-xs leading-5 text-[var(--wh-text-secondary)]">Leave this off if you do not require the same school. The other person's preferences still apply. School names are self-reported, not proof of enrolment. Changing this preference does not remove existing connections.</p>
 </section>;
}

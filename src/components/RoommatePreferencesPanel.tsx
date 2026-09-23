import RoommateSchoolFilter from "./RoommateSchoolFilter";
import RoommateBudgetField from "./RoommateBudgetField";
import { RoommateChoice } from "./RoommateChoices";
import { getAllStates, getCitiesForState } from "@/data/nigeria-locations";
import { nigeriaCalendarDate } from "@/lib/shortLetQuote";
import type { RoommatePreferenceForm } from "@/lib/roommatePreferences";
export type { RoommatePreferenceForm } from "@/lib/roommatePreferences";
type Props = { form: RoommatePreferenceForm; setForm: React.Dispatch<React.SetStateAction<RoommatePreferenceForm>>; profileSchool?: string | null; busy:boolean; onSave:()=>void; onCancel?:()=>void };
export default function RoommatePreferencesPanel({form,setForm,profileSchool,busy,onSave,onCancel}:Props) {
  const set = (key: keyof RoommatePreferenceForm, value: string | number | boolean) => setForm(current => ({...current,[key]:value}));
  const choice = (key: keyof RoommatePreferenceForm, title: string, options: Array<[string,string]>) => <RoommateChoice title={title} value={String(form[key])} options={options} onChange={value=>set(key,value)} />;
  const input="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#191622] px-3 text-base text-white";
  return <section className="border-y border-white/[.08] py-5"><h2 className="text-lg font-semibold">Roommate preferences</h2><p className="mt-1 text-sm leading-6 text-[#AAA3B3]">Start with your moving plans. Optional habits help you compare—not predict whether living together will work.</p>
    <div className="mt-6 space-y-6">
      <fieldset className="space-y-3"><legend className="text-base font-semibold">Where you want to live</legend><p className="text-sm leading-6 text-[#AAA3B3]">This is separate from your current address.</p><div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">State<select aria-label="Preferred State" className={input} value={form.preferred_state} onChange={e=>setForm(current=>({...current,preferred_state:e.target.value,preferred_lga:'',preferred_area:''}))}><option value="">Choose State</option>{getAllStates().map(state=><option key={state}>{state}</option>)}</select></label>
        <label className="text-sm">Local government area<select aria-label="Preferred LGA" className={input} value={form.preferred_lga} disabled={!form.preferred_state} onChange={e=>setForm(current=>({...current,preferred_lga:e.target.value,preferred_area:''}))}><option value="">Choose LGA</option>{getCitiesForState(form.preferred_state).map(lga=><option key={lga}>{lga}</option>)}</select></label>
      </div><label className="block text-sm">Preferred area (optional)<input className={input} maxLength={120} value={form.preferred_area} onChange={e=>set('preferred_area',e.target.value)} placeholder="Leave blank for anywhere in this LGA" /></label></fieldset>
      {choice('gender_preference','Who would you live with?',[['no_preference','Anyone'],['male','Male'],['female','Female']])}
      <RoommateBudgetField minimum={form.budget_min} maximum={form.budget_max} onChange={(minimum,maximum)=>setForm(current=>({...current,budget_min:minimum,budget_max:maximum}))}/>
      {choice('move_in_mode','When would you like to move?',[['asap','As soon as possible'],['date','Preferred date'],['range','Date range'],['flexible','Flexible']])}
      {form.move_in_mode==='asap'&&<p className="text-sm leading-6 text-[#AAA3B3]">Match with someone ready to move within the next 30 days.</p>}
      {['date','range'].includes(form.move_in_mode) && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{form.move_in_mode==='range'?'Earliest move-in':'Move-in date'}<input className={input} type="date" min={nigeriaCalendarDate()} value={form.move_in_from} onChange={e=>set('move_in_from',e.target.value)}/></label>{form.move_in_mode==='range'&&<label className="text-sm">Latest move-in<input className={input} type="date" min={form.move_in_from||nigeriaCalendarDate()} value={form.move_in_to} onChange={e=>set('move_in_to',e.target.value)}/></label>}</div>}
      {choice('room_arrangement','What would you share?',[['shared_bedroom','Shared bedroom'],['separate_bedrooms','Separate bedrooms in a shared home'],['either','Either']])}
      <RoommateSchoolFilter school={form.school_name} sameSchool={form.school_match} profileSchool={profileSchool} onSchool={school=>setForm(current=>({...current,school_name:school,school_match:school.trim()?current.school_match:false}))} onToggle={()=>set('school_match',!form.school_match)}/>
      <div className="space-y-5 border-t border-white/10 pt-5"><h3 className="text-base font-semibold">Living together</h3>
        {choice('smoking_habit','Do you smoke?',[['never','No'],['outdoors','Only outside'],['smokes','Yes']])}
        {choice('smoking_preference','Would you live with someone who smokes?',[['no','No'],['outdoors','Only outside'],['yes','Yes']])}
        <details className="space-y-5"><summary className="min-h-11 cursor-pointer text-base font-semibold">Optional daily habits</summary><p className="text-sm leading-6 text-[#AAA3B3]">These choices help you compare. Unanswered choices do not count as agreement.</p>
        {choice('cleanliness','How do you keep shared spaces?',[['neat','Very neat'],['moderate','Balanced'],['relaxed','Relaxed'],['','Skip']])}
        {choice('noise_level','Which home atmosphere do you prefer?',[['quiet','Quiet'],['moderate','Balanced'],['loud','Social'],['','Skip']])}
        {choice('sleep_routine','Your usual sleep routine',[['early','Early nights'],['late','Late nights'],['varies','Varies'],['','Skip']])}
        {choice('visitors','How often do you usually have visitors?',[['rarely','Rarely'],['sometimes','Sometimes'],['often','Often'],['','Skip']])}
        {choice('overnight_visitors','Are you comfortable with overnight visitors?',[['yes','Yes'],['agreement','Only by agreement'],['no','No'],['','Skip']])}
        {choice('stay_duration','How long would you like to stay?',[['3_months','3 months'],['6_months','6 months'],['1_year','1 year'],['1_year+','1+ years'],['','Skip']])}
        {choice('pets_preference','Would pets be okay?',[['yes','Yes'],['agreement','By agreement'],['no','No'],['','Skip']])}</details>
      </div>
      <div className="flex gap-3"><button type="button" onClick={onSave} disabled={busy} className="min-h-12 flex-1 rounded-xl bg-violet-500 px-4 text-sm font-semibold disabled:opacity-40">{busy?'Saving…':'Save preferences'}</button>{onCancel&&<button type="button" onClick={onCancel} disabled={busy} className="min-h-12 rounded-xl border border-white/15 px-4 text-sm">Cancel</button>}</div>
    </div></section>;
}

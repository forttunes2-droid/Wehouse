import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import RoommateSchoolFilter from "./RoommateSchoolFilter";
import RoommateBudgetField from "./RoommateBudgetField";
import { RoommateChoice } from "./RoommateChoices";
import { getAllStates, getCitiesForState } from "@/data/nigeria-locations";
import { nigeriaCalendarDate } from "@/lib/shortLetQuote";
import { roommateHousingError, roommatePreferenceError, type RoommatePreferenceForm } from "@/lib/roommatePreferences";
export type { RoommatePreferenceForm } from "@/lib/roommatePreferences";
type Props = { form: RoommatePreferenceForm; setForm: React.Dispatch<React.SetStateAction<RoommatePreferenceForm>>; profileSchool?: string | null; busy: boolean; onSave: () => void; onCancel?: () => void };
type Section = "location" | "rent" | "timing" | "rooms" | "people" | "smoking" | "habits" | "school";
const optionalFields: Array<{ key: keyof RoommatePreferenceForm; label: string; options: Array<[string, string]> }> = [
  { key: "cleanliness", label: "Shared spaces", options: [["neat", "Very neat"], ["moderate", "Balanced"], ["relaxed", "Relaxed"]] },
  { key: "noise_level", label: "Home atmosphere", options: [["quiet", "Quiet"], ["moderate", "Balanced"], ["loud", "Social"]] },
  { key: "sleep_routine", label: "Sleep routine", options: [["early", "Early nights"], ["late", "Late nights"], ["varies", "Varies"]] },
  { key: "visitors", label: "How often you have visitors", options: [["rarely", "Rarely"], ["sometimes", "Sometimes"], ["often", "Often"]] },
  { key: "overnight_visitors", label: "Overnight visitors", options: [["yes", "Welcome"], ["agreement", "Only by agreement"], ["no", "Not comfortable"]] },
  { key: "stay_duration", label: "Length of stay", options: [["3_months", "3 months"], ["6_months", "6 months"], ["1_year", "1 year"], ["1_year+", "More than a year"]] },
  { key: "pets_preference", label: "Pets", options: [["yes", "Welcome"], ["agreement", "By agreement"], ["no", "Not comfortable"]] },
];
const input = "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-[#151820] px-3 text-base text-white outline-none focus:border-violet-400 disabled:opacity-40";
const labelFor = (value: string, options: Array<[string, string]>, fallback = "Choose") => options.find(([key]) => key === value)?.[1] || fallback;
const genders: Array<[string,string]> = [["no_preference","Anyone"],["male","Male"],["female","Female"]];
const arrangements: Array<[string,string]> = [["shared_bedroom","Shared bedroom"],["separate_bedrooms","Separate bedrooms in a shared home"],["either","Either"]];
const smokingHabits: Array<[string,string]> = [["never","No"],["outdoors","Only outside"],["smokes","Yes"]];
const smokingLimits: Array<[string,string]> = [["no","No"],["outdoors","Only outside"],["yes","Yes"]];
function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(date) : "Choose a date";
}

/** One editor and one save. Expanding a row changes no route or saved data. */
export default function RoommatePreferencesPanel({ form, setForm, profileSchool, busy, onSave, onCancel }: Props) {
  const [open, setOpen] = useState<Section | null>(null), [error, setError] = useState("");
  const root = useRef<HTMLElement>(null);
  const openedWith = useRef(form);
  const set = (key: keyof RoommatePreferenceForm, value: string | number | boolean) => setForm(current => ({ ...current, [key]: value }));
  const choice = (key: keyof RoommatePreferenceForm, label: string, options: Array<[string, string]>) => <RoommateChoice title={label} value={String(form[key])} options={options} onChange={value => set(key, value)} />;
  function save() {
    const problem = roommateHousingError(form, nigeriaCalendarDate()) || roommatePreferenceError(form, nigeriaCalendarDate());
    if (!problem) { setError(""); onSave(); return; }
    setError(problem);
    // Reveal the invalid required group; never invent missing answers to save.
    const section: Section = !genders.some(([v]) => v === form.gender_preference) ? "people"
      : !form.preferred_state || !form.preferred_lga ? "location"
      : ![form.budget_min,form.budget_max].every(v => Number.isSafeInteger(v) && v > 0 && v <= 2000000000) || form.budget_max < form.budget_min ? "rent"
      : !arrangements.some(([v]) => v === form.room_arrangement) && problem.startsWith("Choose whether") ? "rooms"
      : problem.startsWith("Add your school") ? "school"
      : problem.startsWith("Complete the two smoking") ? "smoking" : "timing";
    setOpen(section);
    requestAnimationFrame(() => {
      const field = root.current?.querySelector<HTMLElement>(`[data-preference-section="${section}"] button[aria-expanded]`);
      field?.focus({preventScroll:true}); field?.scrollIntoView({block:"nearest"});
    });
  }
  const row = (id: Section, title: string, summary: string, children: ReactNode, optional = false) => <PreferenceRow key={id} id={id} title={title} summary={summary} optional={optional} open={open === id} onToggle={() => {setOpen(open === id ? null : id);setError("");}}>{children}</PreferenceRow>;
  const timing = form.move_in_mode === "range" ? `${displayDate(form.move_in_from)} – ${displayDate(form.move_in_to)}` : form.move_in_mode === "date" ? displayDate(form.move_in_from) : labelFor(form.move_in_mode, [["asap","Within 30 days"],["flexible","Flexible"]]);
  const habitLabels: Record<string,string> = {cleanliness:"Spaces",noise_level:"Home",sleep_routine:"Sleep",visitors:"Visitors",overnight_visitors:"Overnight guests",stay_duration:"Stay",pets_preference:"Pets"};
  const habits = optionalFields.filter(field => form[field.key]).map(field => `${habitLabels[field.key]}: ${labelFor(String(form[field.key]),field.options)}`);
  return <section ref={root} aria-label="Roommate preferences" className="mx-auto max-w-xl py-2">
    <h2 className="mb-5 text-xl font-semibold tracking-tight">Roommate preferences</h2>
    <fieldset disabled={busy} className="divide-y divide-white/[.08] border-y border-white/[.08] disabled:opacity-60">
      {row("location","Where you want to live",[form.preferred_area,form.preferred_lga,form.preferred_state].filter(Boolean).join(", ") || "Choose your location",<>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">State<select aria-label="Preferred State" className={input} value={form.preferred_state} onChange={e => setForm(current => ({...current,preferred_state:e.target.value,preferred_lga:"",preferred_area:""}))}><option value="">Choose State</option>{getAllStates().map(state => <option key={state}>{state}</option>)}</select></label>
          <label className="text-sm">LGA<select aria-label="Preferred LGA" className={input} disabled={!form.preferred_state} value={form.preferred_lga} onChange={e => setForm(current => ({...current,preferred_lga:e.target.value,preferred_area:""}))}><option value="">Choose LGA</option>{getCitiesForState(form.preferred_state).map(lga => <option key={lga}>{lga}</option>)}</select></label>
        </div>
        <label className="block text-sm">Area (optional)<input aria-label="Preferred area" className={input} maxLength={120} value={form.preferred_area} onChange={e => set("preferred_area",e.target.value)} placeholder="Anywhere in this LGA" /></label>
      </>)}
      {row("rent","Your yearly rent share",form.budget_min && form.budget_max ? `₦${form.budget_min.toLocaleString()}–₦${form.budget_max.toLocaleString()} · bills excluded` : "Choose your range · bills excluded",<RoommateBudgetField minimum={form.budget_min} maximum={form.budget_max} onChange={(minimum,maximum) => setForm(current => ({...current,budget_min:minimum,budget_max:maximum}))} />)}
      {row("timing","Move-in",timing,<>
        <label className="block text-sm">When would you like to move?<select aria-label="When would you like to move?" className={input} value={form.move_in_mode} onChange={e => set("move_in_mode",e.target.value)}><option value="">Choose timing</option><option value="asap">As soon as possible (within 30 days)</option><option value="date">Preferred date</option><option value="range">Date range</option><option value="flexible">Flexible</option></select></label>
        {["date","range"].includes(form.move_in_mode) && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{form.move_in_mode === "range" ? "Earliest move-in" : "Move-in date"}<input className={input} type="date" min={nigeriaCalendarDate()} value={form.move_in_from} onChange={e => set("move_in_from",e.target.value)} /></label>{form.move_in_mode === "range" && <label className="text-sm">Latest move-in<input className={input} type="date" min={form.move_in_from || nigeriaCalendarDate()} value={form.move_in_to} onChange={e => set("move_in_to",e.target.value)} /></label>}</div>}
      </>)}
      {row("rooms","Room arrangement",labelFor(form.room_arrangement,arrangements),<label className="block text-sm">What would you share?<select aria-label="What would you share?" className={input} value={form.room_arrangement} onChange={e => set("room_arrangement",e.target.value)}><option value="">Choose arrangement</option>{arrangements.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
      {row("people","Who you would live with",labelFor(form.gender_preference,genders),choice("gender_preference","Who would you live with?",genders))}
      {row("smoking","Smoking",form.smoking_habit && form.smoking_preference ? `You: ${labelFor(form.smoking_habit,smokingHabits)} · Roommate: ${labelFor(form.smoking_preference,smokingLimits)}` : "Your habit and what you accept",<>{choice("smoking_habit","Do you smoke?",smokingHabits)}{choice("smoking_preference","Would you live with someone who smokes?",smokingLimits)}</>)}
      {row("habits","Daily habits",habits.length ? habits.slice(0,2).join(" · ") + (habits.length > 2 ? " · More" : "") : "Visitors, sleep and shared spaces",<div className="divide-y divide-white/[.07]">{optionalFields.map(field => <label key={field.key} className="grid min-h-16 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 py-3 text-sm"><span>{field.label}</span><select aria-label={field.label} className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-[#151820] px-3 text-sm text-white outline-none focus:border-violet-400" value={String(form[field.key])} onChange={e => set(field.key,e.target.value)}><option value="">Not set</option>{field.options.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div>,true)}
      {row("school","School matching",form.school_match ? `Same school · ${form.school_name}` : "Any school",<RoommateSchoolFilter school={form.school_name} sameSchool={form.school_match} profileSchool={profileSchool} onSchool={school => setForm(current => ({...current,school_name:school,school_match:school.trim() ? current.school_match : false}))} onToggle={() => set("school_match",!form.school_match)} />,true)}
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm leading-6 text-amber-200">{error}</p>}
    <div className="mt-5 flex items-center gap-3">{onCancel && <button type="button" disabled={busy} onClick={() => {setForm(openedWith.current);onCancel();}} className="min-h-12 rounded-xl px-4 text-sm text-[#CBD0DB]">Cancel</button>}<button type="button" onClick={save} disabled={busy} className="min-h-12 flex-1 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : "Save preferences"}</button></div>
  </section>;
}
function PreferenceRow({id,title,summary,optional,open,onToggle,children}:{id:Section;title:string;summary:string;optional:boolean;open:boolean;onToggle:()=>void;children:ReactNode}) {
  const contentId = useId();
  return <div data-preference-section={id}>
    <button type="button" aria-label={`Edit ${title.toLowerCase()}`} aria-expanded={open} aria-controls={contentId} onClick={onToggle} className="flex min-h-[76px] w-full items-center gap-4 py-4 text-left focus-visible:outline focus-visible:outline-violet-300">
      <span className="min-w-0 flex-1"><span className="block text-base font-medium">{title}{optional && <span className="ml-2 text-xs font-normal text-[#A7ADBA]">Optional</span>}</span><span className="mt-1 block text-sm leading-5 text-[#A7ADBA]">{summary}</span></span>
      <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-[#A7ADBA] ${open ? "rotate-180" : ""}`} />
    </button>
    <div id={contentId} hidden={!open} className="space-y-5 pb-5">{open ? children : null}</div>
  </div>;
}

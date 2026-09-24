import { useRef, useState } from "react";
import RoommateSchoolFilter from "./RoommateSchoolFilter";
import RoommateBudgetField from "./RoommateBudgetField";
import { RoommateChoice } from "./RoommateChoices";
import { getAllStates, getCitiesForState } from "@/data/nigeria-locations";
import { nigeriaCalendarDate } from "@/lib/shortLetQuote";
import { roommateHousingError, roommatePreferenceError, type RoommatePreferenceForm } from "@/lib/roommatePreferences";
export type { RoommatePreferenceForm } from "@/lib/roommatePreferences";
type Props = { form: RoommatePreferenceForm; setForm: React.Dispatch<React.SetStateAction<RoommatePreferenceForm>>; profileSchool?: string | null; busy: boolean; onSave: () => void; onCancel?: () => void };
type Step = "housing" | "living" | "review";
const optionalFields: Array<{ key: keyof RoommatePreferenceForm; label: string; options: Array<[string, string]> }> = [
  { key: "cleanliness", label: "Shared spaces", options: [["neat", "Very neat"], ["moderate", "Balanced"], ["relaxed", "Relaxed"]] },
  { key: "noise_level", label: "Home atmosphere", options: [["quiet", "Quiet"], ["moderate", "Balanced"], ["loud", "Social"]] },
  { key: "sleep_routine", label: "Sleep routine", options: [["early", "Early nights"], ["late", "Late nights"], ["varies", "Varies"]] },
  { key: "visitors", label: "How often you have visitors", options: [["rarely", "Rarely"], ["sometimes", "Sometimes"], ["often", "Often"]] },
  { key: "overnight_visitors", label: "Overnight visitors", options: [["yes", "Welcome"], ["agreement", "Only by agreement"], ["no", "Not comfortable"]] },
  { key: "stay_duration", label: "Length of stay", options: [["3_months", "3 months"], ["6_months", "6 months"], ["1_year", "1 year"], ["1_year+", "More than a year"]] },
  { key: "pets_preference", label: "Pets", options: [["yes", "Welcome"], ["agreement", "By agreement"], ["no", "Not comfortable"]] },
];
const titles: Record<Step, string> = { housing: "Housing needs", living: "Living preferences", review: "Review" };
const input = "mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#151820] px-3 text-base text-white outline-none focus:border-violet-400 disabled:opacity-40";
export default function RoommatePreferencesPanel({ form, setForm, profileSchool, busy, onSave, onCancel }: Props) {
  const [step, setStep] = useState<Step>("housing"), [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const set = (key: keyof RoommatePreferenceForm, value: string | number | boolean) => setForm(current => ({ ...current, [key]: value }));
  function go(next: Step) {
    setStep(next); setError("");
    requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); });
  }
  function next() {
    const problem = step === "housing" ? roommateHousingError(form, nigeriaCalendarDate()) : roommatePreferenceError(form, nigeriaCalendarDate());
    if (problem) { setError(problem); return; }
    if (step === "review") onSave(); else go(step === "housing" ? "living" : "review");
  }
  const choice = (key: keyof RoommatePreferenceForm, label: string, options: Array<[string, string]>) => <RoommateChoice title={label} value={String(form[key])} options={options} onChange={value => set(key, value)} />;
  const reviewValue = (key: keyof RoommatePreferenceForm, options: Array<[string, string]>) => options.find(([value]) => value === form[key])?.[1] || "Not set";
  const reviewSection = (title: string, edit: Step, children: React.ReactNode) => <section className="border-t border-white/10 py-5"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-base font-semibold">{title}</h4><button type="button" onClick={() => go(edit)} className="min-h-11 px-2 text-sm font-medium text-violet-300">Edit {title.toLowerCase()}</button></div><dl className="space-y-3 text-sm">{children}</dl></section>;
  const row = (label: string, value: string) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4"><dt className="text-[#A7ADBA]">{label}</dt><dd className="break-words text-right text-[#E4E6EC]">{value}</dd></div>;
  return <section aria-label="Roommate preferences" className="mx-auto max-w-xl py-2">
    <header className="mb-6 border-b border-white/10 pb-5">
      <div className="flex items-center justify-between gap-3"><h2 ref={heading} tabIndex={-1} className="scroll-mt-5 text-2xl font-semibold tracking-tight outline-none">{titles[step]}</h2><span className="text-xs tabular-nums text-[#A7ADBA]">{["housing", "living", "review"].indexOf(step) + 1} of 3</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">{(["housing", "living", "review"] as Step[]).map((item, index) => <span key={item} className={`h-1 rounded-full ${index <= ["housing", "living", "review"].indexOf(step) ? "bg-violet-400" : "bg-white/10"}`} />)}</div>
    </header>
    <fieldset disabled={busy} className="space-y-6 disabled:opacity-60">
    {step === "housing" && <>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Preferred State<select aria-label="Preferred State" className={input} value={form.preferred_state} onChange={e => setForm(current => ({ ...current, preferred_state: e.target.value, preferred_lga: "", preferred_area: "" }))}><option value="">Choose State</option>{getAllStates().map(state => <option key={state}>{state}</option>)}</select></label>
        <label className="text-sm">Preferred LGA<select aria-label="Preferred LGA" className={input} value={form.preferred_lga} disabled={!form.preferred_state} onChange={e => setForm(current => ({ ...current, preferred_lga: e.target.value, preferred_area: "" }))}><option value="">Choose LGA</option>{getCitiesForState(form.preferred_state).map(lga => <option key={lga}>{lga}</option>)}</select></label>
      </div>
      <label className="block text-sm">Area <span className="text-[#A7ADBA]">(optional)</span><input aria-label="Preferred area" className={input} maxLength={120} value={form.preferred_area} onChange={e => set("preferred_area", e.target.value)} placeholder="Anywhere in this LGA" /></label>
      {choice("gender_preference", "Who would you live with?", [["no_preference", "Anyone"], ["male", "Male"], ["female", "Female"]])}
      <RoommateBudgetField minimum={form.budget_min} maximum={form.budget_max} onChange={(minimum, maximum) => setForm(current => ({ ...current, budget_min: minimum, budget_max: maximum }))} />
      <label className="block text-sm">When would you like to move?<select aria-label="When would you like to move?" className={input} value={form.move_in_mode} onChange={e => set("move_in_mode", e.target.value)}><option value="">Choose timing</option><option value="asap">As soon as possible (within 30 days)</option><option value="date">Preferred date</option><option value="range">Date range</option><option value="flexible">Flexible</option></select></label>
      {["date", "range"].includes(form.move_in_mode) && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{form.move_in_mode === "range" ? "Earliest move-in" : "Move-in date"}<input className={input} type="date" min={nigeriaCalendarDate()} value={form.move_in_from} onChange={e => set("move_in_from", e.target.value)} /></label>{form.move_in_mode === "range" && <label className="text-sm">Latest move-in<input className={input} type="date" min={form.move_in_from || nigeriaCalendarDate()} value={form.move_in_to} onChange={e => set("move_in_to", e.target.value)} /></label>}</div>}
      <label className="block text-sm">What would you share?<select aria-label="What would you share?" className={input} value={form.room_arrangement} onChange={e => set("room_arrangement", e.target.value)}><option value="">Choose arrangement</option><option value="shared_bedroom">Shared bedroom</option><option value="separate_bedrooms">Separate bedrooms in a shared home</option><option value="either">Either</option></select></label>
      <RoommateSchoolFilter school={form.school_name} sameSchool={form.school_match} profileSchool={profileSchool} onSchool={school => setForm(current => ({ ...current, school_name: school, school_match: school.trim() ? current.school_match : false }))} onToggle={() => set("school_match", !form.school_match)} />
    </>}
    {step === "living" && <>
      {choice("smoking_habit", "Do you smoke?", [["never", "No"], ["outdoors", "Only outside"], ["smokes", "Yes"]])}
      {choice("smoking_preference", "Would you live with someone who smokes?", [["no", "No"], ["outdoors", "Only outside"], ["yes", "Yes"]])}
      <section className="border-t border-white/10 pt-5"><h4 className="text-base font-semibold">Daily habits <span className="text-sm font-normal text-[#A7ADBA]">· optional</span></h4><div className="mt-3 divide-y divide-white/[.07]">{optionalFields.map(field => <label key={field.key} className="grid min-h-16 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 py-3 text-sm"><span>{field.label}</span><select aria-label={field.label} className="min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-[#151820] px-3 text-sm text-white outline-none focus:border-violet-400" value={String(form[field.key])} onChange={e => set(field.key, e.target.value)}><option value="">Not set</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div></section>
    </>}
    {step === "review" && <>
      {reviewSection("Housing needs", "housing", <>{row("Location", [form.preferred_area, form.preferred_lga, form.preferred_state].filter(Boolean).join(", "))}{row("Yearly rent share", `₦${form.budget_min.toLocaleString()}–₦${form.budget_max.toLocaleString()} · bills excluded`)}{row("Move-in", form.move_in_mode === "range" ? `${form.move_in_from} to ${form.move_in_to}` : form.move_in_mode === "date" ? form.move_in_from : form.move_in_mode === "asap" ? "Within 30 days" : "Flexible")}{row("Room arrangement", reviewValue("room_arrangement", [["shared_bedroom", "Shared bedroom"], ["separate_bedrooms", "Separate bedrooms"], ["either", "Either"]]))}{row("Live with", reviewValue("gender_preference", [["no_preference", "Anyone"], ["male", "Male"], ["female", "Female"]]))}{row("School restriction", form.school_match ? form.school_name : "Off")}</>)}
      {reviewSection("Living preferences", "living", <>{row("Your smoking", reviewValue("smoking_habit", [["never", "No"], ["outdoors", "Only outside"], ["smokes", "Yes"]]))}{row("Roommate smoking", reviewValue("smoking_preference", [["no", "No"], ["outdoors", "Only outside"], ["yes", "Yes"]]))}{optionalFields.filter(field => form[field.key]).map(field => row(field.label, reviewValue(field.key, field.options)))}</>)}
    </>}
    </fieldset>
    {error && <p role="alert" className="mt-4 text-sm leading-6 text-amber-200">{error}</p>}
    <div className="mt-7 flex items-center gap-3 border-t border-white/10 pt-5">{step !== "housing" ? <button type="button" disabled={busy} onClick={() => go(step === "review" ? "living" : "housing")} className="min-h-12 rounded-xl px-4 text-sm text-[#CBD0DB]">Back</button> : onCancel ? <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-xl px-4 text-sm text-[#CBD0DB]">Cancel</button> : null}<button type="button" onClick={next} disabled={busy} className="min-h-12 flex-1 rounded-xl bg-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Saving…" : step === "review" ? "Save preferences" : "Continue"}</button></div>
  </section>;
}

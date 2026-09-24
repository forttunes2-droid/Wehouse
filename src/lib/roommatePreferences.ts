import type { RoommatePreferences } from "@/types";

export type RoommatePreferenceForm = {
  gender_preference: string; budget_min: number; budget_max: number;
  preferred_state: string; preferred_lga: string; preferred_area: string;
  move_in_mode: string; move_in_from: string; move_in_to: string; room_arrangement: string;
  cleanliness: string; noise_level: string; visitors: string; stay_duration: string;
  sleep_routine: string; smoking_habit: string; smoking_preference: string;
  overnight_visitors: string; pets_preference: string;
  area_preference: string; school_name: string; school_match: boolean;
};
export function roommatePreferenceForm(p?: Partial<RoommatePreferences> | null, school = ""): RoommatePreferenceForm {
  return {
    gender_preference: p?.gender_preference || "", budget_min: Number(p?.budget_min || 0), budget_max: Number(p?.budget_max || 0),
    preferred_state: p?.preferred_state || "", preferred_lga: p?.preferred_lga || "", preferred_area: p?.preferred_area || p?.area_preference || "",
    move_in_mode: p?.move_in_mode || "", move_in_from: p?.move_in_from || "", move_in_to: p?.move_in_to || "", room_arrangement: p?.room_arrangement || "",
    cleanliness: p?.cleanliness || "", noise_level: p?.noise_level || "", visitors: p?.visitors || "", stay_duration: p?.stay_duration || "",
    sleep_routine: p?.sleep_routine || "", smoking_habit: p?.smoking_habit || "", smoking_preference: p?.smoking_preference || "",
    overnight_visitors: p?.overnight_visitors || "", pets_preference: p?.pets_preference || "",
    area_preference: p?.area_preference || "", school_name: p?.school_name || school, school_match: Boolean(p?.school_match),
  };
}
/** Empty optional answers stay empty; we never manufacture agreement. */
export function roommateHousingError(form: RoommatePreferenceForm, today: string): string | null {
  if (!['male','female','no_preference'].includes(form.gender_preference)) return 'Choose who you would live with.';
  if (!form.preferred_state || !form.preferred_lga) return 'Choose where you want to move: State and LGA.';
  if (![form.budget_min, form.budget_max].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2000000000) || form.budget_max < form.budget_min) return 'Enter your own annual rent range, with the maximum at least the minimum.';
  if (!['asap','date','range','flexible'].includes(form.move_in_mode)) return 'Choose when you would like to move.';
  const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0,10) === v;
  if (['date','range'].includes(form.move_in_mode) && (!validDate(form.move_in_from) || form.move_in_from < today)) return 'Choose a valid future move-in date.';
  if (form.move_in_mode === 'range' && (!validDate(form.move_in_to) || form.move_in_to < form.move_in_from)) return 'Choose an end date on or after your earliest move-in date.';
  if (!['shared_bedroom','separate_bedrooms','either'].includes(form.room_arrangement)) return 'Choose whether you want to share a bedroom or just a home.';

  if (form.school_match && !form.school_name.trim()) return 'Add your school before enabling same-school matching.';
  return null;
}
export function roommatePreferenceError(form: RoommatePreferenceForm, today: string): string | null {
  const housing = roommateHousingError(form, today);
  if (housing) return housing;
  if (!['never','outdoors','smokes'].includes(form.smoking_habit) || !['no','outdoors','yes'].includes(form.smoking_preference)) return 'Complete the two smoking choices so both people’s limits are respected.';
  return null;
}
export function roommateScoreLabel(score: number | null | undefined, answered = 0) {
  if (!Number.isFinite(score) || answered < 1) return 'Compare your plans';
  return Number(score) >= 75 ? 'Strong preference match' : Number(score) >= 50 ? 'Some shared preferences' : 'Discuss your differences';
}

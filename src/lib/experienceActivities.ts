import { supabase } from './supabase/client';
import { withTimeout } from './withTimeout';

export type ExperienceCategory = { code: string; name: string; description: string; examples: string[] };
export type ExperienceDraft = {
  title: string; category: string; what_to_expect: string; host_expertise: string;
  country_code: string; state: string; local_area: string; city: string;
  meeting_area: string; timezone: string; participation_requirements: string;
  accessibility_information: string; duration_minutes: number | null;
  max_group_size: number | null; inclusions: string[]; exclusions: string[];
};
export type ExperienceActivity = {
  id: string; host_user_id: string; revision: number;
  status: 'draft' | 'submitted' | 'changes_required' | 'declined' | 'withdrawn' | 'archived' | 'approved';
  details: ExperienceDraft; updated_at: string; created_at: string;
  category_name?: string | null;
  approved_from_revision?: number; approved_by?: string; approved_at?: string; approval_note?: string;
};
export type ExperienceActivityEvent = { id: string; activity_id: string; activity_revision: number; action: string; note: string | null; created_at: string };
export type ExperienceCursor = { updated_at: string; id: string };

/** Shared wording for the saved application and its operational review. */
export const EXPERIENCE_DETAIL_LABELS: Record<keyof ExperienceDraft, string> = {
  title: 'Activity name', category: 'Category', what_to_expect: 'What participants will do',
  host_expertise: 'Host expertise or venue responsibility', country_code: 'Country', state: 'State or region',
  local_area: 'Local government or district', city: 'City or town', meeting_area: 'Meeting area',
  timezone: 'Activity timezone', participation_requirements: 'Participation requirements',
  accessibility_information: 'Accessibility and assistance', duration_minutes: 'Duration in minutes',
  max_group_size: 'Maximum participants', inclusions: 'What is included', exclusions: 'What is not included',
};

export function emptyExperienceDraft(): ExperienceDraft {
  return { title: '', category: '', what_to_expect: '', host_expertise: '', country_code: '',
    state: '', local_area: '', city: '', meeting_area: '', timezone: '',
    participation_requirements: '', accessibility_information: '', duration_minutes: null,
    max_group_size: null, inclusions: [], exclusions: [] };
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Activity details could not be confirmed. Please refresh.');
  return value as Record<string, unknown>;
};
const identifier = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function activity(value: unknown): ExperienceActivity {
  const row = record(value), details = record(row.details);
  if (!identifier(row.id) || typeof row.host_user_id !== 'string' || !row.host_user_id ||
    (row.category_name!=null&&(typeof row.category_name!=='string'||!row.category_name.trim())) ||
    !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
    !['draft','submitted','changes_required','declined','withdrawn','archived','approved'].includes(String(row.status)) ||
    typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)) ||
    typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw new Error('The activity receipt could not be confirmed. Refresh before continuing.');
  if(row.status==='approved'&&(!Number.isSafeInteger(row.approved_from_revision)||Number(row.approved_from_revision)!==Number(row.revision)-1||typeof row.approved_by!=='string'||row.approved_by===row.host_user_id||typeof row.approved_at!=='string'||!Number.isFinite(Date.parse(row.approved_at))||typeof row.approval_note!=='string'||row.approval_note.trim().length<20))throw new Error('The activity approval could not be confirmed.');
  const draft = emptyExperienceDraft();
  for (const key of Object.keys(draft) as (keyof ExperienceDraft)[]) {
    const item = details[key];
    if (item === undefined) continue;
    if (key === 'inclusions' || key === 'exclusions') {
      if (!Array.isArray(item) || item.some(text => typeof text !== 'string')) throw new Error('The saved activity list is invalid.');
      draft[key] = item;
    } else if (key === 'duration_minutes' || key === 'max_group_size') {
      if (item !== null && (typeof item !== 'number' || !Number.isFinite(item))) throw new Error('The saved activity number is invalid.');
      draft[key] = item as number | null;
    } else {
      if (typeof item !== 'string') throw new Error('The saved activity text is invalid.');
      draft[key] = item;
    }
  }
  return { ...row, details: draft } as unknown as ExperienceActivity;
}

function sameDraft(left: ExperienceDraft, right: ExperienceDraft): boolean {
  return (Object.keys(emptyExperienceDraft()) as (keyof ExperienceDraft)[])
    .every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

async function command(name: string, args: Record<string, unknown>) {
  const { data, error } = await withTimeout(supabase.rpc(name, args), 15000,
    'Activity confirmation took too long. Refresh status before retrying.');
  if (error) throw error;
  return data as unknown;
}
export async function listExperienceCategories(countryCode: string): Promise<ExperienceCategory[]> {
  const data = await command('get_experience_categories', { p_country_code: countryCode });
  if (!Array.isArray(data) || data.some(value => {
    const row = record(value);
    return typeof row.code !== 'string' || !/^[a-z][a-z0-9_]{1,59}$/.test(row.code) ||
      typeof row.name !== 'string' || !row.name.trim() || typeof row.description !== 'string' ||
      !Array.isArray(row.examples) || row.examples.some(example => typeof example !== 'string');
  }) || new Set(data.map(row => row.code)).size !== data.length) {
    throw new Error('Activity categories could not be confirmed. Please try again.');
  }
  return data as ExperienceCategory[];
}
export async function listExperienceActivities(review = false, cursor?: ExperienceCursor) {
  const data = await command(review ? 'get_experience_activity_review_queue' : 'get_my_experience_activities', {
    p_before: cursor?.updated_at || null, p_before_id: cursor?.id || null,
  });
  if (!Array.isArray(data) || data.length > 20) throw new Error('Activities could not be loaded. Please try again.');
  const rows = data.map(activity);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Activities could not be confirmed. Please refresh.');
  return rows;
}
export async function getExperienceActivity(id: string, forReview = false) {
  if (!identifier(id)) throw new Error('This application link is invalid.');
  const saved = activity(await command('get_experience_activity', { p_activity_id: id, p_for_review: forReview }));
  if (saved.id !== id) throw new Error('The requested application could not be confirmed.');
  return saved;
}
export async function saveExperienceActivity(id: string, revision: number, details: ExperienceDraft) {
  const data = record(await command('save_my_experience_activity', { p_activity_id: id, p_expected_revision: revision, p_details: details }));
  const saved = activity(data.activity);
  if (saved.id !== id || ![revision, revision + 1].includes(saved.revision) || !['draft','changes_required','withdrawn'].includes(saved.status) || !sameDraft(saved.details, details) || !Array.isArray(data.issues) || data.issues.some(item => typeof item !== 'string')) throw new Error('The saved draft was not confirmed. Refresh before retrying.');
  return { activity: saved, issues: data.issues as string[] };
}
export async function transitionExperienceActivity(row: ExperienceActivity, action: 'submit' | 'withdraw' | 'archive') {
  const saved = activity(await command('transition_my_experience_activity', { p_activity_id: row.id, p_expected_revision: row.revision, p_action: action }));
  const expected = { submit: 'submitted', withdraw: 'withdrawn', archive: 'archived' }[action];
  if (saved.id !== row.id || saved.host_user_id !== row.host_user_id || saved.revision !== row.revision + 1 || !sameDraft(saved.details, row.details) || saved.status !== expected) throw new Error('The activity action was not confirmed. Refresh before retrying.');
  return saved;
}
export async function reviewExperienceActivity(row: ExperienceActivity, decision: 'changes_required' | 'declined', note: string) {
  const saved = activity(await command('request_experience_activity_changes', { p_activity_id: row.id, p_expected_revision: row.revision, p_decision: decision, p_note: note }));
  if (saved.id !== row.id || saved.host_user_id !== row.host_user_id || saved.revision !== row.revision + 1 || !sameDraft(saved.details, row.details) || saved.status !== decision) throw new Error('The review decision was not confirmed. Refresh before retrying.');
  return saved;
}
export async function getExperienceActivityHistory(id: string): Promise<ExperienceActivityEvent[]> {
  const data = await command('get_experience_activity_history', { p_activity_id: id });
  if (!Array.isArray(data) || data.some(value => {
    const row = record(value);
    return !identifier(row.id) || row.activity_id !== id || !Number.isSafeInteger(row.activity_revision) ||
      typeof row.action !== 'string' || (row.note !== null && typeof row.note !== 'string') ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at));
  })) throw new Error('Activity history could not be confirmed. Please try again.');
  return data as ExperienceActivityEvent[];
}

export const EXPERIENCE_APPROVAL_CHECKS = {
  details:'Host-guided plan, activity details and enabled category', provider_access:'Active provider workspace',
  identity:'Current account identity verification', evidence:'Current independently reviewed evidence',
  photos:'All selected activity photos approved', sessions:'Current session dates, prices and capacity',
};
export type ExperienceApprovalReadiness={activity_id:string;revision:number;checks:Record<keyof typeof EXPERIENCE_APPROVAL_CHECKS,boolean>;can_approve:boolean};
export async function getExperienceApprovalReadiness(row:ExperienceActivity){
  const result=record(await command('get_experience_approval_readiness',{p_activity_id:row.id,p_expected_revision:row.revision}));
  const checks=record(result.checks),keys=Object.keys(EXPERIENCE_APPROVAL_CHECKS);
  if(result.activity_id!==row.id||result.revision!==row.revision||typeof result.can_approve!=='boolean'||Object.keys(checks).length!==keys.length||keys.some(key=>typeof checks[key]!=='boolean')||result.can_approve&&(row.status!=='submitted'||keys.some(key=>checks[key]!==true)))throw new Error('Activity approval checks could not be confirmed. Refresh before deciding.');
  return result as unknown as ExperienceApprovalReadiness;
}
export async function approveExperienceActivity(row:ExperienceActivity,note:string){
  const saved=activity(await command('approve_experience_activity',{p_activity_id:row.id,p_expected_revision:row.revision,p_note:note.trim()}));
  if(saved.id!==row.id||saved.host_user_id!==row.host_user_id||saved.revision!==row.revision+1||saved.approved_from_revision!==row.revision||saved.status!=='approved'||saved.approval_note!==note.trim()||!sameDraft(saved.details,row.details))throw new Error('Activity approval was not confirmed. Refresh before retrying.');
  return saved;
}

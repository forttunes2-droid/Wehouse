import { supabase } from './supabase/client';
import { withTimeout } from './withTimeout';
import type { ExperienceActivity } from './experienceActivities';

export type ExperienceSession = {
  id: string; activity_id: string; revision: number; activity_revision: number;
  starts_at: string; ends_at: string; timezone: string; capacity: number;
  price_minor: number; currency: string; status: 'draft' | 'archived';
  booking_open?:boolean;availability_revision?:number;edit_locked?:boolean;
};
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function sessionReceipt(value: unknown, activityId: string): ExperienceSession {
  const r = value as ExperienceSession;
  if (!r || !uuid(r.id) || r.activity_id !== activityId ||
    !Number.isSafeInteger(r.revision) || r.revision < 1 || !Number.isSafeInteger(r.activity_revision) || r.activity_revision < 1 ||
    typeof r.starts_at !== 'string' || !Number.isFinite(Date.parse(r.starts_at)) ||
    typeof r.ends_at !== 'string' || !Number.isFinite(Date.parse(r.ends_at)) || Date.parse(r.ends_at) <= Date.parse(r.starts_at) ||
    !Number.isInteger(r.capacity) || r.capacity < 1 || r.capacity > 100 ||
    !Number.isSafeInteger(r.price_minor) || r.price_minor < 1 || !/^[A-Z]{3}$/.test(r.currency) ||
    !['draft', 'archived'].includes(r.status) || typeof r.timezone !== 'string' ||
    r.booking_open!==undefined&&typeof r.booking_open!=='boolean' || r.edit_locked!==undefined&&typeof r.edit_locked!=='boolean' ||
    r.availability_revision!==undefined&&(!Number.isSafeInteger(r.availability_revision)||r.availability_revision<0)) throw new Error('Session details could not be confirmed. Refresh before continuing.');
  try { new Intl.DateTimeFormat('en', { timeZone: r.timezone }); }
  catch { throw new Error('Session timezone could not be confirmed.'); }
  return r;
}
export function currencyScale(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency is unavailable.');
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) throw new Error('Currency precision is unavailable.');
  return 10 ** digits;
}
export function sessionPriceMinor(text: string, currency: string) {
  const scale = currencyScale(currency), digits = Math.log10(scale);
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1,digits)}})?$`).test(text) || (digits === 0 && text.includes('.'))) throw new Error('Enter a price using the currency’s supported decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const value = Number(whole) * scale + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Enter a valid positive price.');
  return value;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await withTimeout(supabase.rpc(name, args), 15000, 'Session confirmation took too long. Refresh before retrying.');
  if (error) throw error;
  return data;
}
export async function sessionCurrency(country: string) {
  const { data, error } = await withTimeout(supabase.from('platform_countries').select('currency_code').eq('country_code', country).eq('enabled', true).maybeSingle(), 15000, 'Activity currency took too long to load.');
  if (error) throw error;
  if (!data || !/^[A-Z]{3}$/.test(data.currency_code)) throw new Error('Activity-country currency is not configured.');
  return data.currency_code as string;
}
export async function listExperienceSessions(activityId: string, after?: ExperienceSession, reviewRevision?: number) {
  if (reviewRevision !== undefined && (!Number.isSafeInteger(reviewRevision) || reviewRevision < 1)) throw new Error('Application revision could not be confirmed.');
  const data = await rpc(reviewRevision === undefined ? 'get_my_experience_sessions' : 'get_experience_review_sessions', { p_activity_id: activityId, p_after_start: after?.starts_at || null, p_after_id: after?.id || null, ...(reviewRevision === undefined ? {} : { p_expected_revision: reviewRevision }) });
  if (!Array.isArray(data) || data.length > 20) throw new Error('Session list could not be confirmed.');
  const rows = data.map(r => sessionReceipt(r, activityId));
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => r.status !== 'draft')) throw new Error('Session list could not be confirmed.');
  return rows;
}
export async function saveExperienceSession(activity: ExperienceActivity, id: string, revision: number, startsAt: string, capacity: number, priceMinor: number, currency: string) {
  const row = sessionReceipt(await rpc('save_my_experience_session', {
    p_activity_id: activity.id, p_session_id: id, p_expected_revision: revision, p_activity_revision: activity.revision,
    p_starts_at: startsAt, p_capacity: capacity, p_price_minor: priceMinor, p_currency: currency,
  }), activity.id);
  const contentRevision=activity.status==='approved'?(activity.approved_from_revision||activity.revision)-1:activity.revision;
  if (row.id !== id || ![revision, revision + 1].includes(row.revision) || row.activity_revision !== contentRevision ||
    row.status !== 'draft' || Date.parse(row.starts_at) !== Date.parse(startsAt) || row.capacity !== capacity ||
    row.price_minor !== priceMinor || row.currency !== currency || row.timezone !== activity.details.timezone ||
    Date.parse(row.ends_at) - Date.parse(row.starts_at) !== Number(activity.details.duration_minutes) * 60000) throw new Error('Saved session was not confirmed. Refresh before retrying.');
  return row;
}
export async function archiveExperienceSession(row: ExperienceSession) {
  const saved = sessionReceipt(await rpc('archive_my_experience_session', { p_activity_id: row.activity_id, p_session_id: row.id, p_expected_revision: row.revision }), row.activity_id);
  if (saved.id !== row.id || saved.revision !== row.revision + 1 || saved.status !== 'archived' ||
    ['activity_revision','starts_at','ends_at','timezone','capacity','price_minor','currency'].some(key => saved[key as keyof ExperienceSession] !== row[key as keyof ExperienceSession])) throw new Error('Session archive was not confirmed. Refresh before retrying.');
  return saved;
}
export async function setExperienceSessionAvailability(row:ExperienceSession,open:boolean){
  const saved=sessionReceipt(await rpc('set_my_experience_session_availability',{p_session_id:row.id,p_expected_revision:row.availability_revision??0,p_open:open}),row.activity_id);
  if(saved.id!==row.id||saved.revision!==row.revision||saved.status!=='draft'||saved.booking_open!==open||saved.availability_revision!==(row.availability_revision??0)+1||
    ['activity_revision','starts_at','ends_at','timezone','capacity','price_minor','currency'].some(key=>saved[key as keyof ExperienceSession]!==row[key as keyof ExperienceSession]))throw Error('Date availability could not be confirmed. Refresh before retrying.');
  return saved;
}

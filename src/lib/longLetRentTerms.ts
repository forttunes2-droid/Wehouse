import { supabase } from './supabase/client';
import { withTimeout } from './withTimeout';

export const LONG_LET_TERMS = [3,6,12,24,36,48,60] as const;
export type LongLetRentTerms = { listing_id: string; revision: number; accepted_terms_months: number[]; monthly_accepted: boolean };
export function rentTermLabel(months: number): string { return months < 12 ? `${months} months` : `${months/12} year${months===12?'':'s'}`; }
export function longLetTermsReceipt(value: unknown, listingId: string): LongLetRentTerms {
  const row=value as LongLetRentTerms;
  if (!row || row.listing_id!==listingId || !Number.isSafeInteger(row.revision) || row.revision<1 ||
    typeof row.monthly_accepted!=='boolean' || !Array.isArray(row.accepted_terms_months) ||
    row.accepted_terms_months.length<1 || row.accepted_terms_months.length>LONG_LET_TERMS.length ||
    row.accepted_terms_months.some(term=>!LONG_LET_TERMS.some(allowed=>allowed===term)) ||
    new Set(row.accepted_terms_months).size!==row.accepted_terms_months.length) throw new Error('Rental terms could not be confirmed. Refresh before continuing.');
  return row;
}
async function command(name: string, args: Record<string,unknown>) {
  const {data,error}=await withTimeout(supabase.rpc(name,args),15000,'Rental terms confirmation took too long. Refresh saved terms before retrying.');
  if(error)throw error;return data;
}
export async function getLongLetRentTerms(listingId:string) {
  return longLetTermsReceipt(await command('get_my_long_let_rent_terms',{p_listing_id:listingId}),listingId);
}
export async function saveLongLetRentTerms(previous:LongLetRentTerms,terms:number[],monthly:boolean) {
  const normalized=[...terms].sort((a,b)=>a-b);
  const saved=longLetTermsReceipt(await command('set_my_long_let_rent_terms',{
    p_listing_id:previous.listing_id,p_expected_revision:previous.revision,p_terms_months:normalized,p_monthly_accepted:monthly,
  }),previous.listing_id);
  if(![previous.revision,previous.revision+1].includes(saved.revision) || saved.monthly_accepted!==monthly ||
    JSON.stringify(saved.accepted_terms_months)!==JSON.stringify(normalized)) throw new Error('Saved rental terms did not match your choices. Refresh before retrying.');
  return saved;
}

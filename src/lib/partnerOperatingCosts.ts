export const OPERATING_COST_CATEGORIES = ['cleaning','repairs','utilities','supplies','management','other'] as const;
export type OperatingCost = { id: string; asset_kind: 'home' | 'hotel'; asset_id: string; category: string; title: string; amount_ngn: number; incurred_on: string; voided_at?: string | null };
export type OperatingReport = { month: string; currency: 'NGN'; reporting_timezone: 'UTC'; costs: OperatingCost[]; cost_count: number; recorded_costs_ngn: number;
  released_income_ngn: number | null; recorded_margin_ngn: number | null; mixed_currency: boolean; unattributed_earnings: number; next_before_on: string | null; next_before_id: string | null };

export function operatingCostAmount(value: string): number | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount=Number(value);
  return Number.isFinite(amount) && amount>0 && amount<=999999999999.99 ? amount : null;
}
export function parseOperatingReport(value: unknown): OperatingReport {
  const row=value as OperatingReport | null;
  if (!row || row.currency!=='NGN' || row.reporting_timezone!=='UTC' || typeof row.month!=='string' || !Array.isArray(row.costs)
    || !Number.isFinite(row.recorded_costs_ngn) || row.recorded_costs_ngn<0 || !Number.isInteger(row.cost_count) || row.cost_count<0 || typeof row.mixed_currency!=='boolean'
    || !Number.isInteger(row.unattributed_earnings) || !('next_before_id' in row) || !('next_before_on' in row)
    || (row.released_income_ngn!==null && !Number.isFinite(row.released_income_ngn))
    || (row.recorded_margin_ngn!==null && !Number.isFinite(row.recorded_margin_ngn))
    || row.mixed_currency && (row.released_income_ngn!==null || row.recorded_margin_ngn!==null)
    || (row.next_before_on===null)!==(row.next_before_id===null)
    || row.costs.length>row.cost_count
    || row.costs.some(cost=>!cost || typeof cost.id!=='string' || typeof cost.title!=='string' || !Number.isFinite(cost.amount_ngn) || cost.amount_ngn<=0
      || !['home','hotel'].includes(cost.asset_kind) || typeof cost.asset_id!=='string' || typeof cost.incurred_on!=='string')) {
    throw new Error('The operating report could not be confirmed.');
  }
  return row;
}
export function operatingCostsCsv(costs: OperatingCost[], titleFor: (kind: string,id: string)=>string): string {
  const cell=(value: string | number)=>{
    const text=typeof value==='string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
    return `"${text.replaceAll('"','""')}"`;
  };
  return [['Date','Property','Category','Description','Recorded cost (NGN)'],...costs.map(cost=>[cost.incurred_on,titleFor(cost.asset_kind,cost.asset_id),cost.category,cost.title,cost.amount_ngn])]
    .map(row=>row.map(cell).join(',')).join('\r\n');
}

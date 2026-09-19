import { supabase } from '@/lib/supabase';
import type { Def } from '@/lib/creatorSettingsSchema';

export type DbSetting = { key: string; value: string; is_active: boolean };

function normalize(def: Def, raw: string): string {
  if (def.kind !== 'number') return raw;
  const cleaned = raw.trim().replace(/,/g, '');
  const value = Number(cleaned);
  if (!/^\d+(\.\d+)?$/.test(cleaned) || !Number.isFinite(value)
    || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)
    || ((def.step ?? 1) >= 1 && !Number.isInteger(value))) throw new Error(`${def.label} has an invalid value`);
  return String(value);
}

export async function saveCreatorSetting(def: Def, raw: string): Promise<{ row: DbSetting; warning?: string }> {
  const value = normalize(def, raw);
  if (def.category === 'worker_pro') {
    const { error } = await supabase.rpc('creator_set_worker_pro_setting', { p_key: def.key, p_value: value });
    if (error) throw error;
  } else {
    const { data: existing, error: readError } = await supabase.from('platform_settings').select('key').eq('key', def.key).maybeSingle();
    if (readError) throw readError;
    const payload = { value, category: def.category || 'platform', label: def.label, description: def.description,
      data_type: def.kind === 'toggle' ? 'boolean' : def.kind === 'number' ? 'number' : 'text',
      editable: true, is_active: true, updated_at: new Date().toISOString() };
    const { error } = existing ? await supabase.from('platform_settings').update(payload).eq('key', def.key)
      : await supabase.from('platform_settings').insert({ key: def.key, ...payload });
    if (error) throw error;
  }
  const { data: row, error } = await supabase.from('platform_settings').select('key,value,is_active').eq('key', def.key).maybeSingle();
  if (error || !row || row.is_active === false || String(row.value) !== value) throw new Error(`${def.label} could not be verified after saving. Reload before trying again.`);
  const period = def.key === 'worker_pro_monthly_price_ngn' ? 'monthly' : def.key === 'worker_pro_yearly_price_ngn' ? 'yearly' : null;
  if (period && Number(value) > 0) {
    // The server pauses new sales when a price changes. A failed provider sync
    // is reported as partial completion, never as a successful checkout setup.
    try {
      const sync = await supabase.functions.invoke('worker-pro-plan-sync', { body: { billing_period: period } });
      if (sync.error || !sync.data?.success) throw new Error('Plan synchronization failed');
    } catch {
      return { row: row as DbSetting, warning: 'Price saved. Paystack plan synchronization failed; keep new sales closed and retry saving this price.' };
    }
  }
  return { row: row as DbSetting };
}

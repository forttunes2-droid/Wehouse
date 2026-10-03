import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import { supabase } from '@/lib/supabase';

const platforms = [
  { platform: 'apple', key: 'worker_pro_ios_sales_enabled', label: 'App Store' },
  { platform: 'google', key: 'worker_pro_android_sales_enabled', label: 'Google Play' },
] as const;

export default function CreatorNativeBillingControls() {
  const { requestElevation } = useCreatorAuth();
  const [states, setStates] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    const { data, error: readError } = await supabase.from('platform_settings')
      .select('key,value').in('key', platforms.map(item => item.key));
    if (readError) return setError('Native sales controls could not be loaded');
    setError('');
    setStates(Object.fromEntries((data || []).map(row => [row.key, row.value === 'true'])));
  }
  useEffect(() => { void load(); }, []);
  function toggle(platform: typeof platforms[number]) {
    requestElevation('policy_publish', elevationId => {
      void (async () => {
        setBusy(true);
        const { error: saveError } = await supabase.rpc('creator_set_worker_pro_native_sales', {
          p_platform: platform.platform, p_enabled: !states[platform.key],
          p_creator_elevation_id: elevationId,
        });
        setBusy(false);
        if (saveError) return toast.error(saveError.message);
        toast.success(`${platform.label} Worker plan sales updated`);
        await load();
      })();
    });
  }
  return <section className="rounded-2xl border border-[var(--wh-border-subtle)] p-4">
    <h4 className="text-xs font-semibold">Native Worker plan sales</h4>
    <p className="mt-1 text-xs text-[var(--wh-text-secondary)]">Configure store products and terms above, verify billing and reconciliation in the store sandbox, and record the legal approval before opening either store. This controls new sales; existing paid access is reconciled separately.</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2">{platforms.map(item => <button key={item.key}
      type="button" disabled={busy || error !== '' || !(item.key in states)} onClick={() => toggle(item)}
      className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-xs disabled:opacity-40">
      {item.label}: {states[item.key] ? 'Open' : 'Off'}
    </button>)}</div>
  </section>;
}

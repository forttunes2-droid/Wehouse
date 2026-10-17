import { supabase } from './supabase/client';
import { setRegionalDefaults } from './regional';

// Reads the default country row once; the built-in fallback stays in place if it cannot be read.
export async function loadRegionalDefaults(): Promise<void> {
  const { data, error } = await supabase
    .from('platform_countries')
    .select('country_code,name,currency_code,time_zone,locale')
    .eq('enabled', true)
    .eq('is_default', true)
    .maybeSingle();
  if (error || !data) return;
  setRegionalDefaults({
    countryCode: data.country_code,
    countryName: data.name,
    currencyCode: data.currency_code,
    timeZone: data.time_zone,
    locale: data.locale,
  });
}

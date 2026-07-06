import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface PropertyTypeDef {
  value: string;
  label: string;
  icon: string;
}

const DEFAULT_TYPES: PropertyTypeDef[] = [
  { value: 'apartment', label: 'Apartment', icon: '🏢' },
  { value: 'hotel', label: 'Hotel', icon: '🏨' },
  { value: 'house', label: 'House', icon: '🏠' },
  { value: 'duplex', label: 'Duplex', icon: '🏘️' },
  { value: 'studio', label: 'Studio', icon: '🛋️' },
  { value: 'self_contain', label: 'Self Contain', icon: '🚪' },
  { value: 'hostel', label: 'Hostel', icon: '🛏️' },
  { value: 'lodge', label: 'Lodge', icon: '🏕️' },
  { value: 'resort', label: 'Resort', icon: '🏖️' },
  { value: 'office', label: 'Office', icon: '🏢' },
  { value: 'warehouse', label: 'Warehouse', icon: '🏭' },
  { value: 'land', label: 'Land', icon: '🌿' },
];

const ICON_MAP: Record<string, string> = {
  apartment: '🏢', hotel: '🏨', house: '🏠', duplex: '🏘️',
  studio: '🛋️', 'self_contain': '🚪', 'self-contain': '🚪',
  hostel: '🛏️', lodge: '🏕️', resort: '🏖️',
  office: '🏢', warehouse: '🏭', land: '🌿',
  short_let: '⏱️', long_stay: '📅',
};

function toLabel(value: string): string {
  return value
    .split(/[_\-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function usePropertyTypes() {
  const [types, setTypes] = useState<PropertyTypeDef[]>(DEFAULT_TYPES);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_setting_v2', { p_key: 'property_types_allowed' });
      if (!error && data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const defs: PropertyTypeDef[] = parsed.map((v: string) => ({
              value: v,
              label: toLabel(v),
              icon: ICON_MAP[v] || '🏠',
            }));
            setTypes(defs);
            setLoading(false);
            return;
          }
        } catch { /* fallback to defaults */ }
      }
    } catch { /* fallback */ }
    setTypes(DEFAULT_TYPES);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const getLabel = useCallback((value: string | null): string => {
    if (!value) return 'Unknown';
    return types.find(t => t.value === value)?.label || toLabel(value);
  }, [types]);

  const getIcon = useCallback((value: string | null): string => {
    if (!value) return '🏠';
    return types.find(t => t.value === value)?.icon || ICON_MAP[value] || '🏠';
  }, [types]);

  return { types, loading, refresh: load, getLabel, getIcon };
}

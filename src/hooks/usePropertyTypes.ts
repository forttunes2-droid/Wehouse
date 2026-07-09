import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface PropertyTypeDef {
  value: string;
  label: string;
  icon: string;
}

// Fallback: Only Houses, Apartments, Hotels (managed by Creator in Settings)
const DEFAULT_TYPES: PropertyTypeDef[] = [
  { value: 'house', label: 'House', icon: '🏠' },
  { value: 'apartment', label: 'Apartment', icon: '🏢' },
  { value: 'hotel', label: 'Hotel', icon: '🏨' },
];

const ICON_MAP: Record<string, string> = {
  house: '🏠', apartment: '🏢', hotel: '🏨',
  short_let: '⏱️', long_stay: '📅',
};

function toLabel(value: string): string {
  return value
    .split(/[_\-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Map DB property_type name to form value
function nameToValue(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('house')) return 'house';
  if (lower.includes('apartment')) return 'apartment';
  if (lower.includes('hotel')) return 'hotel';
  return lower;
}

export function usePropertyTypes() {
  const [types, setTypes] = useState<PropertyTypeDef[]>(DEFAULT_TYPES);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Read from property_types table (managed by Creator in Settings)
    const { data, error } = await supabase
      .from('property_types')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');

    if (!error && data && data.length > 0) {
      const defs: PropertyTypeDef[] = data.map((t: any) => ({
        value: nameToValue(t.name),
        label: t.name,
        icon: ICON_MAP[nameToValue(t.name)] || '🏠',
      }));
      setTypes(defs);
    } else {
      setTypes(DEFAULT_TYPES);
    }
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

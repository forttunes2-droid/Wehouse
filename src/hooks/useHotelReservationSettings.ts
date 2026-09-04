// ═══════════════════════════════════════════════════════════
// Hotel Reservation Settings — reads canonical platform settings
// Creator controls hotel reservation from Operations > Platform settings.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { getPlatformSetting } from '@/lib/supabase';

export interface HotelReservationSettings {
  enabled: boolean;
  feeType: 'fixed_amount' | 'per_day';
  amount: number;
  expiryHours: number;
  refundPolicy: string;
  loading: boolean;
}

export function useHotelReservationSettings(): HotelReservationSettings {
  const [settings, setSettings] = useState<HotelReservationSettings>({
    enabled: false,
    feeType: 'fixed_amount',
    amount: 5000,
    expiryHours: 48,
    refundPolicy: 'Reservation fee is refundable if cancelled within 24 hours of booking.',
    loading: true,
  });

  useEffect(() => {
    async function loadSettings() {
      const [enabledRes, feeTypeRes, amountRes, expiryRes, refundRes] = await Promise.all([
        getPlatformSetting('hotel_reservation_enabled'),
        getPlatformSetting('hotel_reservation_fee_type'),
        getPlatformSetting('hotel_reservation_amount'),
        getPlatformSetting('hotel_reservation_expiry_hours'),
        getPlatformSetting('hotel_reservation_refund_policy'),
      ]);

      setSettings({
        enabled: enabledRes === 'true' || enabledRes === '1',
        feeType: (feeTypeRes === 'per_day' ? 'per_day' : 'fixed_amount') as 'fixed_amount' | 'per_day',
        amount: parseInt(amountRes || '5000', 10) || 5000,
        expiryHours: parseInt(expiryRes || '48', 10) || 48,
        refundPolicy: refundRes || 'Reservation fee is refundable if cancelled within 24 hours of booking.',
        loading: false,
      });
    }

    loadSettings();
  }, []);

  return settings;
}

export function calculateReservationFee(
  settings: HotelReservationSettings,
  nights?: number
): number {
  if (!settings.enabled) return 0;
  if (settings.feeType === 'per_day' && nights && nights > 0) {
    return settings.amount * nights;
  }
  return settings.amount;
}

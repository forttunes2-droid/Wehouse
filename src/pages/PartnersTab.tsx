import { useState, useEffect } from 'react';
import { getAllUsers } from '@/lib/supabase/admin';
import { supabase } from '@/lib/supabase';
import DomainSettingsPanel from '@/components/DomainSettingsPanel';
import { Toaster } from 'sonner';

export default function PartnersTab() {
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPartners();
  }, []);

  async function loadPartners() {
    setLoading(true);
    const { users } = await getAllUsers();
    const list = (users || []).filter((u: any) => u.role === 'property_partner' && !u.deleted && !u.deleted_at);
    // Get their property counts
    const { data: listings } = await supabase.from('listings').select('owner_id').is('deleted_at', null);
    const listingCounts = new Map<string, number>();
    (listings || []).forEach((l: any) => {
      listingCounts.set(l.owner_id, (listingCounts.get(l.owner_id) || 0) + 1);
    });
    setPartners(list.map((p: any) => ({ ...p, propertyCount: listingCounts.get(p.user_id) || 0 })));
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors theme="dark" />
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Property Partners</h3>
          <p className="text-[10px] text-[#5C5E72]">{partners.length} partner{partners.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {partners.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <p className="text-sm text-[#5C5E72]">No property partners yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {partners.map(p => (
            <div key={p.user_id} className="glass rounded-xl p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-[#8B5CF6] flex items-center justify-center text-white text-xs font-bold">
                  {(p.username || 'P').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white">@{p.username}</div>
                  <div className="text-[10px] text-[#5C5E72]">{p.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-violet-400">{p.propertyCount}</div>
                  <div className="text-[9px] text-[#5C5E72]">properties</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-[#5C5E72]">
                <span>{p.state || 'No state'}</span>
                <span>·</span>
                <span>{p.city || 'No city'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Hotel Rules ── */}
      <div className="pt-4 border-t border-[#232330]">
        <DomainSettingsPanel
          title="Hotel Rules"
          description="Configuration for hotel reservations and bookings"
          settings={[
            { key: 'hotel_reservation_enabled', label: 'Hotel Reservations', description: 'Enable hotel reservation feature', type: 'toggle', defaultValue: 'false' },
            { key: 'hotel_reservation_amount', label: 'Reservation Fee (N)', description: 'Fee for hotel reservations', type: 'number', defaultValue: '5000' },
            { key: 'hotel_reservation_fee_type', label: 'Fee Type', description: 'How the reservation fee is calculated', type: 'select', defaultValue: 'fixed_amount', options: [{ value: 'fixed_amount', label: 'Fixed Amount' }, { value: 'percentage', label: 'Percentage' }] },
            { key: 'hotel_reservation_expiry_hours', label: 'Expiry (hours)', description: 'Hours before reservation expires', type: 'number', defaultValue: '48' },
            { key: 'hotel_reservation_refund_policy', label: 'Refund Policy', description: 'Refund policy for hotel reservations', type: 'textarea', defaultValue: '' },
          ]}
        />
      </div>
    </div>
  );
}

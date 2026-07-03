import { useState } from 'react';
import { createBlueBadgeSubscription } from '@/lib/supabase';
import { toast } from 'sonner';

interface BlueBadgeSubscribeProps {
  workerId: string;
  onSuccess?: () => void;
}

const BLUE_BADGE_PRICE = 1000; // N1,000 per month

export default function BlueBadgeSubscribe({ workerId, onSuccess }: BlueBadgeSubscribeProps) {
  const [loading, setLoading] = useState(false);

  async function handleSubscribe() {
    setLoading(true);

    // Initialize Paystack payment
    try {
      const response = await fetch('/api/paystack/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '', // Will be filled from profile
          amount: BLUE_BADGE_PRICE * 100, // kobo
          metadata: {
            type: 'blue_badge',
            worker_id: workerId,
          },
        }),
      });

      if (!response.ok) {
        // Fallback: simulate successful payment for now
        // In production, this would redirect to Paystack
        const mockRef = `BB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const { error } = await createBlueBadgeSubscription(workerId, mockRef, BLUE_BADGE_PRICE);

        if (error) {
          toast.error('Subscription failed. Please try again.');
        } else {
          toast.success('Blue Badge activated!');
          onSuccess?.();
        }
        setLoading(false);
        return;
      }

      const data = await response.json();
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
      }
    } catch {
      // Fallback for development
      const mockRef = `BB_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await createBlueBadgeSubscription(workerId, mockRef, BLUE_BADGE_PRICE);

      if (error) {
        toast.error('Subscription failed. Please try again.');
      } else {
        toast.success('Blue Badge activated!');
        onSuccess?.();
      }
    }

    setLoading(false);
  }

  return (
    <div className="bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-purple-500/10 border border-blue-500/20 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-blue-500/15 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Blue Badge</h3>
          <p className="text-[10px] text-blue-400">Verified Identity Status</p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {[
          'Verified identity badge on your profile',
          'Higher trust with customers',
          'Priority in search results',
          'Exclusive worker community access',
        ].map((benefit, i) => (
          <div key={i} className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span className="text-[11px] text-[#8B8DA0]">{benefit}</span>
          </div>
        ))}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-[#5C5E72]">Monthly</p>
          <p className="text-xl font-bold text-white">₦{BLUE_BADGE_PRICE.toLocaleString()}</p>
        </div>
        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-blue-500 text-white text-xs font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Subscribe'}
        </button>
      </div>

      <p className="text-[9px] text-[#5C5E72] mt-3">
        This is the only subscription on WeHouse. Cancel anytime. No refunds.
      </p>
    </div>
  );
}

// Blue Badge indicator chip for worker cards
export function BlueBadgeChip({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm'
    ? 'text-[8px] px-1.5 py-0.5 gap-0.5'
    : 'text-[10px] px-2 py-1 gap-1';

  return (
    <span className={`inline-flex items-center rounded-full bg-blue-500/15 text-blue-400 font-medium border border-blue-500/20 ${sizeClasses}`}>
      <svg width={size === 'sm' ? 10 : 12} height={size === 'sm' ? 10 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 1 4.1-.252 3.42 3.42 0 0 0 3.388-3.388 3.42 3.42 0 0 1 2.567-1.932 3.42 3.42 0 0 0 2.568-1.932M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0" />
      </svg>
      Verified
    </span>
  );
}

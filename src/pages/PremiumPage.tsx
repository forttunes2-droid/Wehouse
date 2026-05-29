import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

interface PremiumPageProps {
  profile: Profile;
  onBack: () => void;
}

const FEATURES = [
  {
    num: '60',
    label: 'AI messages',
    sub: 'Every day',
  },
  {
    num: '30',
    label: 'Photo uploads',
    sub: 'Daily to AI Agent',
  },
  {
    num: '',
    label: 'Verified badge',
    sub: 'On your profile',
  },
  {
    num: '',
    label: 'Priority support',
    sub: 'Faster responses',
  },
];

export default function PremiumPage({ profile, onBack }: PremiumPageProps) {
  const [usedToday, setUsedToday] = useState(0);
  const isPremium = profile.is_premium;

  useEffect(() => {
    async function load() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('chat_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .gte('created_at', today.toISOString());
      setUsedToday(count || 0);
    }
    load();
  }, [profile.user_id]);

  return (
    <div
      className="min-h-screen pb-10"
      style={{ background: 'var(--wh-bg)', color: 'var(--wh-text)' }}
    >
      <Toaster position="top-center" richColors />

      {/* Back button */}
      <div className="px-6 pt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: 'var(--wh-text-secondary)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6 text-center">
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{
            background: isPremium
              ? 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)'
              : 'var(--wh-elevated)',
            border: isPremium ? 'none' : '1px solid var(--wh-border)',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isPremium ? '#FFFFFF' : '#F59E0B'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">
          {isPremium ? 'Premium Member' : 'Go Premium'}
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--wh-text-secondary)' }}>
          {isPremium
            ? 'Full access. No limits.'
            : `${Math.max(0, 7 - usedToday)} of 7 free messages left today`}
        </p>
      </div>

      {/* Divider */}
      <div className="mx-6 h-px" style={{ background: 'var(--wh-border)' }} />

      {/* Feature Grid */}
      <div className="px-6 py-6">
        <p
          className="text-xs font-semibold uppercase tracking-widest mb-4"
          style={{ color: 'var(--wh-text-muted)' }}
        >
          What you get
        </p>

        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="rounded-2xl p-4"
              style={{
                background: 'var(--wh-surface)',
                border: '1px solid var(--wh-border)',
              }}
            >
              {f.num && (
                <p
                  className="text-2xl font-extrabold tracking-tight"
                  style={{ color: 'var(--wh-violet)' }}
                >
                  {f.num}
                </p>
              )}
              <p className="text-sm font-semibold mt-1">{f.label}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--wh-text-secondary)' }}>
                {f.sub}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      {!isPremium && (
        <div className="px-6 pt-2">
          <div
            className="rounded-2xl p-6 text-center"
            style={{
              background: 'var(--wh-surface)',
              border: '1px solid var(--wh-border)',
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--wh-text-muted)' }}>
              Monthly
            </p>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-extrabold tracking-tight">N1,000</span>
              <span className="text-sm" style={{ color: 'var(--wh-text-secondary)' }}>/mo</span>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--wh-text-muted)' }}>
              Cancel anytime
            </p>

            <button
              onClick={() =>
                (window.location.href =
                  'mailto:support@wehouse.com.ng?subject=Premium%20Upgrade%20Request&body=Hi%20WeHouse%20Team%2C%0A%0AI%20want%20to%20upgrade%20to%20Premium%20(N1%2C000%2Fmonth).%0A%0AMy%20User%20ID%3A%20' +
                  encodeURIComponent(profile.user_id) +
                  '%0A%0AThanks!')
              }
              className="w-full h-12 rounded-xl text-sm font-semibold text-white mt-5 transition-all active:scale-[0.98]"
              style={{ background: 'var(--wh-violet)' }}
            >
              Upgrade
            </button>

            <p className="text-xs mt-3" style={{ color: 'var(--wh-text-muted)' }}>
              Paystack coming soon
            </p>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 pt-8 text-center">
        <p className="text-xs" style={{ color: 'var(--wh-text-muted)' }}>
          Questions? support@wehouse.com.ng
        </p>
      </div>
    </div>
  );
}

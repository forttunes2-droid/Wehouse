import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

interface PremiumPageProps {
  profile: Profile;
  onBack: () => void;
}

interface Feature {
  icon: string;
  label: string;
  desc?: string;
  soon?: boolean;
}

const USER_FEATURES: Feature[] = [
  { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', label: '60 AI messages daily' },
  { icon: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', label: '30 photo uploads daily' },
  { icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', label: 'Verified profile badge' },
  { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Priority support' },
];

const WORKER_FEATURES: Feature[] = [
  { icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', label: 'Verified worker badge', desc: 'Stand out as trusted' },
  { icon: 'M12 20V10M18 20V4M6 20v-4', label: 'Account analytics', desc: 'Views, clicks, enquiries' },
  { icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', label: 'Public profile boost', desc: 'Appear at top of searches' },
  { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', label: 'GIFs & stickers', desc: 'Coming soon', soon: true },
  { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'Priority support' },
];

export default function PremiumPage({ profile, onBack }: PremiumPageProps) {
  const [usedToday, setUsedToday] = useState(0);
  const [activeTab, setActiveTab] = useState<'user' | 'worker'>(
    profile.role === 'worker' ? 'worker' : 'user'
  );
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

  const features = activeTab === 'worker' ? WORKER_FEATURES : USER_FEATURES;

  return (
    <div className="min-h-screen bg-[#050508] text-white pb-10">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <div className="px-6 pt-6">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-[#7A7A8C] hover:text-white transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>
      </div>

      {/* Hero */}
      <div className="px-6 pt-8 pb-6 text-center">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 ${isPremium ? 'bg-amber-500/20' : 'bg-[#14141C] border border-[rgba(255,255,255,0.06)]'}`}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isPremium ? '#F59E0B' : '#F59E0B'} strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{isPremium ? 'Premium Active' : 'Go Premium'}</h1>
        <p className="text-sm text-[#7A7A8C] mt-2">
          {isPremium ? 'Full access. No limits.' : `${Math.max(0, 7 - usedToday)} of 7 free messages left today`}
        </p>
      </div>

      {/* Tabs — User / Worker */}
      {profile.role === 'worker' && (
        <div className="px-6 mb-6">
          <div className="flex rounded-xl bg-[#14141C] border border-[rgba(255,255,255,0.06)] p-1">
            {(['user', 'worker'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab ? 'bg-[#7C5CFF] text-white' : 'text-[#7A7A8C] hover:text-white'
                }`}
              >
                {tab === 'user' ? 'As User' : 'As Worker'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Features */}
      <div className="px-6 mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#4A4A5C] mb-4">What you get</p>
        <div className="space-y-3">
          {features.map((f, i) => (
            <div key={i} className="flex items-center gap-4 bg-[#0C0C12] rounded-2xl p-4 border border-[rgba(255,255,255,0.06)]">
              <div className="w-10 h-10 rounded-xl bg-[#14141C] flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C5CFF" strokeWidth="2"><path d={f.icon} /></svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{f.label}</p>
                  {f.soon && (
                    <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[#14141C] text-[#4A4A5C]">Soon</span>
                  )}
                </div>
                {f.desc && <p className="text-xs text-[#7A7A8C] mt-0.5">{f.desc}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      {!isPremium && (
        <div className="px-6">
          <div className="bg-[#0C0C12] rounded-2xl p-6 text-center border border-[rgba(255,255,255,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#4A4A5C] mb-3">
              {activeTab === 'worker' ? 'Worker Premium' : 'Monthly'}
            </p>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-extrabold tracking-tight">N1,000</span>
              <span className="text-sm text-[#7A7A8C]">/mo</span>
            </div>
            <p className="text-xs text-[#4A4A5C] mt-2">Cancel anytime. No hidden fees.</p>

            <button
              onClick={() => window.location.href = 'mailto:support@wehouse.com.ng?subject=Premium%20Upgrade%20Request&body=Hi%20WeHouse%20Team%2C%0A%0AI%20want%20to%20upgrade%20to%20Premium%20(N1%2C000%2Fmonth).%0A%0AMy%20User%20ID%3A%20' + encodeURIComponent(profile.user_id) + '%0A%0APlan%3A%20' + activeTab + '%0A%0AThanks!'}
              className="w-full h-12 rounded-xl text-sm font-semibold text-white mt-5 bg-[#7C5CFF] hover:brightness-110 active:scale-[0.98] transition-all"
            >
              Upgrade
            </button>
            <p className="text-xs text-[#4A4A5C] mt-3">Paystack coming soon. Email to activate.</p>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 pt-8 text-center">
        <p className="text-xs text-[#4A4A5C]">Questions? support@wehouse.com.ng</p>
        <p className="text-[10px] text-[#4A4A5C] mt-1">Check your email at mail.zoho.com</p>
      </div>
    </div>
  );
}

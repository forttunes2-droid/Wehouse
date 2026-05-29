import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

interface PremiumPageProps {
  profile: Profile;
  onBack: () => void;
}

const BENEFITS = [
  { icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', title: '60 AI Messages', desc: 'Daily chat with the AI Agent' },
  { icon: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', title: '30 Photos Daily', desc: 'Upload images for AI analysis' },
  { icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', title: 'Verified Badge', desc: 'Blue checkmark on your profile' },
  { icon: 'M13 10V3L4 14h7v7l9-11h-7z', title: 'Priority Support', desc: 'Faster responses from our team' },
];

export default function PremiumPage({ profile, onBack }: PremiumPageProps) {
  const [usedToday, setUsedToday] = useState(0);

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

  const isPremium = profile.is_premium;

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-10">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <div className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-8">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white mb-4 flex items-center gap-2 text-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>

        {/* Status Card */}
        <div className="text-center">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3 ${isPremium ? 'bg-amber-500/20' : 'bg-[#1A1A24]'}`}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isPremium ? '#F59E0B' : '#5C5E72'} strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">{isPremium ? 'Premium Active' : 'WeHouse Premium'}</h1>
          <p className="text-sm text-[#5C5E72] mt-1">
            {isPremium ? 'You have unlimited access' : `${Math.max(0, 7 - usedToday)} of 7 messages left today`}
          </p>
        </div>
      </div>

      {/* Benefits */}
      <div className="px-5 mb-8">
        <h2 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3">What you get</h2>
        <div className="space-y-3">
          {BENEFITS.map((b, i) => (
            <div key={i} className="flex items-center gap-4 bg-[#12121A] rounded-2xl p-4 border border-white/[0.04]">
              <div className="w-10 h-10 rounded-xl bg-[#1A1A24] flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d={b.icon} /></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{b.title}</p>
                <p className="text-xs text-[#5C5E72]">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing + CTA */}
      {!isPremium && (
        <div className="px-5">
          <div className="bg-gradient-to-r from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-2xl p-5 text-center">
            <p className="text-3xl font-extrabold text-white">₦1,000<span className="text-sm font-normal text-[#5C5E72]">/month</span></p>
            <p className="text-xs text-[#5C5E72] mt-1 mb-4">Cancel anytime. No hidden fees.</p>
            <button
              onClick={() => window.location.href = 'mailto:support@wehouse.com.ng?subject=Premium%20Upgrade%20Request&body=Hi%20WeHouse%20Team%2C%0A%0AI%20want%20to%20upgrade%20to%20Premium%20(%E2%82%A61%2C000%2Fmonth).%0A%0AMy%20User%20ID%3A%20' + encodeURIComponent(profile.user_id) + '%0A%0AThanks!'}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Upgrade to Premium
            </button>
            <p className="text-[10px] text-[#5C5E72] mt-3">Paystack coming soon. Email us to activate.</p>
          </div>
        </div>
      )}
    </div>
  );
}

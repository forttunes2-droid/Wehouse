import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { Toaster } from 'sonner';

interface PremiumPageProps {
  profile: Profile;
  onBack: () => void;
}

const PREMIUM_BENEFITS = [
  {
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    title: '60 AI Messages Daily',
    desc: 'Chat with the WeHouse AI Agent up to 60 times every day. Free users only get 7.',
  },
  {
    icon: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z',
    title: '30 Photo Uploads Daily',
    desc: 'Send photos to the AI Agent for analysis. Free users only get 1 photo total.',
  },
  {
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    title: 'Verified Badge',
    desc: 'Blue verified badge on your profile. Stand out as a trusted member.',
  },
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'Priority Support',
    desc: 'Your enquiries get priority handling by our verified staff.',
  },
];

export default function PremiumPage({ profile, onBack }: PremiumPageProps) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ usedToday: 0, usedPhotos: 0 });

  useEffect(() => {
    async function load() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { count: msgCount } = await supabase
        .from('chat_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .gte('created_at', today.toISOString());

      const { count: photoCount } = await supabase
        .from('chat_photo_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.user_id)
        .gte('created_at', today.toISOString());

      setStats({ usedToday: msgCount || 0, usedPhotos: photoCount || 0 });
      setLoading(false);
    }
    load();
  }, [profile.user_id]);

  const isPremium = profile.is_premium;
  const msgsLeft = isPremium ? Math.max(0, 60 - stats.usedToday) : Math.max(0, 7 - stats.usedToday);

  return (
    <div className="min-h-screen bg-transparent pb-24">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-white">Premium</h1>
        </div>

        {/* Status Card */}
        <div className={`rounded-2xl p-5 border ${isPremium ? 'bg-gradient-to-r from-amber-500/10 to-amber-600/5 border-amber-500/20' : 'bg-[#12121A]/80 border-white/[0.06]'}`}>
          {isPremium ? (
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Premium Member</p>
                <p className="text-[10px] text-[#5C5E72]">60 messages · 30 photos daily</p>
                {!loading && (
                  <p className="text-[10px] text-[#5C5E72] mt-0.5">Used today: {stats.usedToday} messages · {stats.usedPhotos} photos</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#1A1A24] flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Free Plan</p>
                {!loading && (
                  <p className="text-[10px] text-[#5C5E72]">{msgsLeft} of 7 messages left today</p>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-6">
        {/* Benefits */}
        <section>
          <h2 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3">Premium Benefits</h2>
          <div className="space-y-3">
            {PREMIUM_BENEFITS.map((b, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                    <path d={b.icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{b.title}</p>
                  <p className="text-[11px] text-[#5C5E72] mt-0.5 leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section>
          <h2 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3">Pricing</h2>
          <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-5">
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-2xl font-extrabold text-white">₦1,000</span>
              <span className="text-xs text-[#5C5E72]">/month</span>
            </div>
            <p className="text-[11px] text-[#5C5E72] mb-4">Cancel anytime. No hidden fees.</p>

            {/* PAYSTACK NOT CONNECTED - contact support to upgrade */}
            <button
              onClick={() => window.location.href = 'mailto:support@wehouse.com.ng?subject=Premium%20Upgrade%20Request&body=Hi%20WeHouse%20Team%2C%0A%0AI%20want%20to%20upgrade%20to%20Premium%20(%E2%82%A61%2C000%2Fmonth).%0A%0AMy%20User%20ID%3A%20' + encodeURIComponent(profile.user_id) + '%0A%0AThanks!'}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white p-4 text-center hover:opacity-90 transition-opacity"
            >
              <p className="text-sm font-semibold mb-0.5">Upgrade to Premium</p>
              <p className="text-[10px] text-white/70">Contact support@wehouse.com.ng to activate</p>
            </button>

            {/* Hidden - will be enabled when Paystack is connected
            <button className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity">
              Upgrade to Premium
            </button>
            */}
          </div>
        </section>

        {/* Support */}
        <section className="pb-8">
          <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 text-center">
            <p className="text-[11px] text-[#5C5E72]">Questions? Contact support@wehouse.com.ng</p>
          </div>
        </section>
      </div>
    </div>
  );
}

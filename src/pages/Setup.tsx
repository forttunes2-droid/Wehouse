import { useState, useMemo } from 'react';
import { updateProfile, isUsernameTaken } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';

interface SetupProps {
  profile: Profile;
  onSetupComplete: (profile: Profile) => void;
}

export default function Setup({ profile, onSetupComplete }: SetupProps) {
  const [username, setUsername] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  // Get LGAs for selected state
  const availableCities = useMemo(() => {
    const found = NIGERIA_STATES.find((s) => s.state === state);
    return found?.cities || [];
  }, [state]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validate username
    const trimmed = username.trim().toLowerCase();
    if (trimmed.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (!/^[a-z0-9_]+$/.test(trimmed)) { setError('Only letters, numbers, and underscores'); return; }

    // Validate location
    if (!state) { setError('Select your current state'); return; }
    if (!city) { setError('Select your local government'); return; }

    setWorking(true);

    try {
      // Check username availability
      const taken = await isUsernameTaken(trimmed);
      if (taken) { setError('Username taken. Try another.'); setWorking(false); return; }

      // Save everything: username + state + city + profile_complete
      const { profile: updated, error: err } = await updateProfile(profile.user_id, {
        username: trimmed,
        state,
        city,
        country: 'Nigeria',
        profile_complete: true,
      });

      if (err || !updated) {
        setError(err?.message || 'Failed to save profile');
        setWorking(false);
        return;
      }

      onSetupComplete(updated);
    } catch {
      setError('Something went wrong. Please try again.');
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-start justify-center px-5 pt-10 pb-10 overflow-y-auto">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center mx-auto mb-4 glow-blue">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Complete Your Profile</h1>
          <p className="text-xs text-[#5C5E72] mt-1">Just a few details to get started</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">
              Username <span className="text-red-400">*</span>
            </label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="johndoe"
              required
              minLength={3}
              maxLength={30}
              className="h-12 rounded-xl bg-[#1A1A24] border-[#232330] text-white placeholder:text-[#5C5E72] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20"
            />
            <p className="text-[10px] text-[#5C5E72] mt-1">Only letters, numbers, underscores. Min 3 characters.</p>
          </div>

          {/* State */}
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">
              Current State <span className="text-red-400">*</span>
            </label>
            <select
              value={state}
              onChange={(e) => { setState(e.target.value); setCity(''); }}
              required
              className="w-full h-12 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 focus:border-[#3B82F6] focus:ring-[#3B82F6]/20 outline-none appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235C5E72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}
            >
              <option value="">Select your state</option>
              {NIGERIA_STATES.map((s) => (
                <option key={s.state} value={s.state}>{s.state}</option>
              ))}
            </select>
          </div>

          {/* LGA / City */}
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">
              Local Government <span className="text-red-400">*</span>
            </label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              disabled={!state}
              className={`w-full h-12 rounded-xl border text-white text-sm px-4 outline-none appearance-none ${
                state
                  ? 'bg-[#1A1A24] border-[#232330] focus:border-[#3B82F6] focus:ring-[#3B82F6]/20'
                  : 'bg-[#12121A] border-[#1E1E2C] text-[#5C5E72] cursor-not-allowed'
              }`}
              style={state ? { backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235C5E72' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' } : {}}
            >
              <option value="">{state ? 'Select your LGA' : 'Select state first'}</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Info card */}
          <div className="glass rounded-2xl p-4">
            <div className="flex items-start gap-2.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <p className="text-[11px] text-[#8A8B9C] leading-relaxed">
                Your state and LGA help us show you relevant listings, roommates near you, and targeted announcements. You can update this anytime in your profile.
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={working}
            className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm hover:bg-[#2563EB] transition-colors glow-blue-sm disabled:opacity-50 btn-press"
          >
            {working ? 'Saving...' : 'Get Started'}
          </button>
        </form>
      </div>
    </div>
  );
}

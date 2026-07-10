import { useState, useMemo } from 'react';
import { updateProfile, isUsernameTaken } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { NIGERIA_STATES } from '@/data/nigeria-locations';
import type { Profile } from '@/types';

interface SetupProps {
  profile: Profile;
  onSetupComplete: (profile: Profile) => void;
}

/*
 * SETUP / PROFILE COMPLETION
 * Role-specific onboarding — NOT the same message for everyone.
 * Property Partner: set up to list properties, manage inspections, track earnings
 * Worker: set up to list skills, get verified, start earning
 * User: set up to find listings, roommates, save properties
 * Staff: set up to manage their assigned modules
 */

export default function Setup({ profile, onSetupComplete }: SetupProps) {
  const [username, setUsername] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const role = profile.role;

  // ═══ Role-specific content — NOT the same for everyone ═══
  const roleContent = {
    user: {
      title: 'Complete Your Profile',
      subtitle: 'Just a few details to get started',
      info: 'Your state and LGA help us show you relevant listings, roommates near you, and targeted announcements. You can update this anytime in your profile.',
      icon: 'user',
    },
    worker: {
      title: 'Worker Profile Setup',
      subtitle: 'Set up your professional profile',
      info: 'Your location helps us match you with nearby jobs and customers. Fill in your details, complete verification, and start earning.',
      icon: 'worker',
    },
    property_partner: {
      title: 'Property Partner Setup',
      subtitle: 'Set up your partner profile to list properties',
      info: 'Your location helps us assign field officers for property inspections. List your properties, manage bookings, and track your earnings from the partner dashboard.',
      icon: 'partner',
    },
    staff: {
      title: 'Staff Profile Setup',
      subtitle: 'Complete your staff profile',
      info: 'Your location helps WeHouse coordinate field operations. Complete your profile to access your assigned modules.',
      icon: 'staff',
    },
    admin: {
      title: 'Admin Profile Setup',
      subtitle: 'Complete your admin profile',
      info: 'Your location is used for platform analytics and regional management. Complete your profile to access the admin dashboard.',
      icon: 'admin',
    },
    creator: {
      title: 'Creator Profile Setup',
      subtitle: 'Complete your creator profile',
      info: 'Your location is used for platform configuration. Complete your profile to access the creator dashboard and manage all platform settings.',
      icon: 'creator',
    },
  };

  const content = roleContent[role as keyof typeof roleContent] || roleContent.user;

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
    <div className="min-h-screen bg-transparent flex items-start justify-center px-5 pt-10 pb-10 overflow-y-auto">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-6">
          {/* Role-specific icon color */}
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
            role === 'property_partner' ? 'bg-gradient-to-br from-emerald-500 to-emerald-700'
            : role === 'worker' ? 'bg-gradient-to-br from-amber-500 to-amber-700'
            : role === 'staff' ? 'bg-gradient-to-br from-violet-500 to-violet-700'
            : role === 'admin' ? 'bg-gradient-to-br from-red-500 to-red-700'
            : role === 'creator' ? 'bg-gradient-to-br from-orange-500 to-orange-700'
            : 'bg-gradient-to-br from-[#3B82F6] to-[#2563EB]'
          }`}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          {/* Role-specific title */}
          <h1 className="text-xl font-bold text-white">{content.title}</h1>
          <p className="text-xs text-[#5C5E72] mt-1">{content.subtitle}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Username *</label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="h-11 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#5C5E72] focus:border-[#3B82F6]/50"
              placeholder="e.g. johnsmith"
              autoFocus
            />
            <p className="text-[10px] text-[#5C5E72] mt-1">This will be your public username</p>
          </div>

          {/* State */}
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">State *</label>
            <select
              value={state}
              onChange={(e) => { setState(e.target.value); setCity(''); }}
              className="w-full h-11 rounded-xl border border-[#2A2A3A] bg-[#1A1A24] text-white text-sm px-3 focus:border-[#3B82F6]/50 outline-none appearance-none"
            >
              <option value="">Select your state</option>
              {NIGERIA_STATES.map((s) => (
                <option key={s.state} value={s.state}>{s.state}</option>
              ))}
            </select>
          </div>

          {/* City / LGA */}
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Local Government *</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full h-11 rounded-xl border border-[#2A2A3A] bg-[#1A1A24] text-white text-sm px-3 focus:border-[#3B82F6]/50 outline-none appearance-none"
            >
              <option value="">{state ? 'Select your LGA' : 'Select state first'}</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Role-specific info card */}
          <div className="glass rounded-2xl p-4">
            <div className="flex items-start gap-2.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <p className="text-[11px] text-[#8A8B9C] leading-relaxed">
                {content.info}
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={working}
            className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm hover:bg-[#2563EB] transition-colors disabled:opacity-50"
          >
            {working ? 'Saving...' : 'Get Started'}
          </button>
        </form>
      </div>
    </div>
  );
}

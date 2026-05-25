import { useState } from 'react';
import { updateUsername, isUsernameTaken } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import type { Profile } from '@/types';

interface SetupProps {
  profile: Profile;
  onSetupComplete: (profile: Profile) => void;
}

export default function Setup({ profile, onSetupComplete }: SetupProps) {
  const [username, setUsername] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = username.trim().toLowerCase();
    if (trimmed.length < 3) { setError('Min 3 characters'); return; }
    if (!/^[a-z0-9_]+$/.test(trimmed)) { setError('Only letters, numbers, underscores'); return; }

    setWorking(true);

    try {
      const taken = await isUsernameTaken(trimmed);
      if (taken) { setError('Username taken. Try another.'); setWorking(false); return; }

      const { error: err } = await updateUsername(profile.user_id, trimmed);
      if (err) { setError(err.message); setWorking(false); return; }

      onSetupComplete({ ...profile, username: trimmed, profile_complete: true });
    } catch {
      setError('Something went wrong');
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-5">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center mx-auto mb-4 glow-blue">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <h1 className="text-xl font-bold text-white">Choose your username</h1>
          <p className="text-xs text-[#5C5E72] mt-1">{profile.email}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
            {error}
          </div>
        )}

        <div className="glass rounded-2xl p-4 mb-5">
          <p className="text-xs text-[#8B8DA0] leading-relaxed">
            Your username is your unique identity on WeHouse. Only letters, numbers, and underscores.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] text-[#8B8DA0] mb-1.5 block font-medium">Username</label>
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
          </div>
          <button type="submit" disabled={working} className="w-full h-12 rounded-xl bg-[#3B82F6] text-white font-medium text-sm hover:bg-[#2563EB] transition-colors glow-blue-sm disabled:opacity-50 btn-press">
            {working ? 'Saving...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

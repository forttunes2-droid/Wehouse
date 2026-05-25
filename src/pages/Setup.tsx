import { useState } from 'react';
import { updateUsername, isUsernameTaken } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Profile } from '@/types';

interface SetupProps {
  profile: Profile;
  onSetupComplete: (profile: Profile) => void;
}

export default function Setup({ profile, onSetupComplete }: SetupProps) {
  const [username, setUsername] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  function validateUsername(value: string): string | null {
    if (value.length < 3) return 'Username must be at least 3 characters';
    if (value.length > 20) return 'Username must be at most 20 characters';
    if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers, and underscores allowed';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmed = username.trim().toLowerCase();
    const validationError = validateUsername(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }

    setWorking(true);

    // Check if username is taken
    const taken = await isUsernameTaken(trimmed);
    if (taken) {
      setError('This username is already taken. Try another.');
      setWorking(false);
      return;
    }

    // Save username
    const { error: updateErr } = await updateUsername(profile.user_id, trimmed);
    if (updateErr) {
      setError(updateErr.message);
      setWorking(false);
      return;
    }

    // Update profile locally and complete setup
    const updatedProfile: Profile = {
      ...profile,
      username: trimmed,
      profile_complete: true,
    };
    onSetupComplete(updatedProfile);
    setWorking(false);
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-5 py-8">
      <div className="w-full max-w-[360px]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#0F1724] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C8A45A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#0F1724]">Choose your username</h1>
          <p className="text-xs text-[#8B8680] mt-1">{profile.email}</p>
        </div>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="mb-4 rounded-xl text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Info */}
        <div className="mb-4 p-3 rounded-xl bg-[#FAF8F5] text-xs text-[#8B8680]">
          Your username is your unique identity on WeHouse. It can only contain letters, numbers, and underscores.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-xs text-[#8B8680] mb-1.5 block">Username</Label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="johndoe"
              required
              minLength={3}
              maxLength={20}
              className="h-11 rounded-xl border-[#e5e2dd] text-sm"
            />
          </div>

          <Button
            type="submit"
            disabled={working}
            className="w-full h-11 rounded-xl bg-[#C8A45A] text-[#0F1724] hover:bg-[#b8944a] font-medium text-sm"
          >
            {working ? 'Saving...' : 'Continue'}
          </Button>
        </form>
      </div>
    </div>
  );
}

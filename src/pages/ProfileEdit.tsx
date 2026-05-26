import { useState, useRef, useCallback, useEffect } from 'react';
import { updateProfile, uploadAvatar, validateUsername, checkUsernameAvailable } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import LocationSelector from '@/components/LocationSelector';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface ProfileEditProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
  onBack: () => void;
}

export default function ProfileEdit({ profile, onUpdate, onBack }: ProfileEditProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string | null>(profile.avatar_url);

  // Username validation
  const [username, setUsername] = useState(profile.username || '');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [usernameError, setUsernameError] = useState('');
  const usernameTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState({
    bio: profile.bio || '',
    phone: profile.phone || '',
    occupation: profile.occupation || '',
    is_student: profile.is_student || false,
    school: profile.school || '',
    gender: profile.gender || '',
    budget_min: profile.budget_min || 50000,
    budget_max: profile.budget_max || 500000,
  });

  const [location, setLocation] = useState({
    country: profile.country || 'Nigeria',
    state: profile.state || '',
    city: profile.city || '',
    area: profile.area || '',
  });

  const initials = (username || profile.email[0]).toUpperCase();

  // Debounced username validation
  useEffect(() => {
    if (usernameTimeout.current) clearTimeout(usernameTimeout.current);
    const trimmed = username.trim().toLowerCase();

    if (!trimmed) {
      setUsernameStatus('idle');
      setUsernameError('');
      return;
    }
    if (trimmed === (profile.username || '').toLowerCase()) {
      setUsernameStatus('idle');
      setUsernameError('');
      return;
    }

    const validation = validateUsername(trimmed);
    if (!validation.valid) {
      setUsernameStatus('invalid');
      setUsernameError(validation.error || 'Invalid username');
      return;
    }

    setUsernameStatus('checking');
    setUsernameError('');

    usernameTimeout.current = setTimeout(async () => {
      const { available } = await checkUsernameAvailable(trimmed, profile.user_id);
      if (available) {
        setUsernameStatus('available');
        setUsernameError('');
      } else {
        setUsernameStatus('taken');
        setUsernameError('Username already taken');
      }
    }, 400);

    return () => { if (usernameTimeout.current) clearTimeout(usernameTimeout.current); };
  }, [username, profile.username, profile.user_id]);

  // Avatar upload
  const handleAvatarTap = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast.error('Please select an image'); return; }
      if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }

      setUploadingAvatar(true);
      const { url, error } = await uploadAvatar(file, profile.user_id);
      setUploadingAvatar(false);
      if (error || !url) { toast.error('Upload failed: ' + (error?.message || 'Unknown')); return; }

      const { error: updateErr } = await updateProfile(profile.user_id, { avatar_url: url });
      if (updateErr) { toast.error('Failed to save'); return; }

      setLocalAvatar(url);
      toast.success('Photo updated!');
    },
    [profile.user_id]
  );

  // Form submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (usernameStatus === 'taken' || usernameStatus === 'invalid') {
      toast.error('Fix username issues first');
      return;
    }

    setSaving(true);
    const updates: Partial<Profile> = {
      ...form,
      username: username.trim() || profile.username,
      profile_complete: true,
      ...location,
      preferred_location: [location.city, location.state].filter(Boolean).join(', ') || null,
    };
    const { profile: updated, error } = await updateProfile(profile.user_id, updates);
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success('Profile updated!');
    if (updated) onUpdate(updated);
  }

  const usernameStatusColor = {
    idle: '',
    checking: 'text-amber-400',
    available: 'text-green-400',
    taken: 'text-red-400',
    invalid: 'text-red-400',
  }[usernameStatus];

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">Edit Profile</h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Avatar Upload */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleAvatarTap}
            disabled={uploadingAvatar}
            className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-2xl font-bold flex-shrink-0 glow-blue-sm overflow-hidden disabled:opacity-60 active:scale-95 transition-all"
          >
            {uploadingAvatar ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : localAvatar ? (
              <img src={localAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              initials[0]
            )}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleAvatarChange} />
          <p className="text-[10px] text-[#5C5E72]">Tap to change photo</p>
        </div>

        {/* Username with validation */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Username *</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5E72] text-sm">@</span>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className={`h-10 rounded-xl text-sm pl-7 bg-[#1A1A24] border text-white placeholder-[#8A8B9C] transition-colors ${
                usernameStatus === 'taken' || usernameStatus === 'invalid'
                  ? 'border-red-500/50 focus:border-red-500'
                  : usernameStatus === 'available'
                  ? 'border-green-500/50 focus:border-green-500'
                  : 'border-[#2A2A3A] focus:border-[#3B82F6]/50'
              }`}
              placeholder="username"
              maxLength={20}
            />
          </div>
          {usernameError && <p className={`text-[10px] mt-1 ${usernameStatusColor}`}>{usernameError}</p>}
          {usernameStatus === 'available' && <p className="text-[10px] mt-1 text-green-400">Username available</p>}
          {usernameStatus === 'checking' && <p className="text-[10px] mt-1 text-amber-400">Checking...</p>}
          <p className="text-[9px] text-[#5C5E72] mt-1">3-20 characters, letters, numbers, underscores only</p>
        </div>

        {/* Bio */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Bio</Label>
          <Textarea
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            className="rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50"
            rows={3}
            placeholder="Tell others about yourself..."
          />
        </div>

        {/* Phone */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Phone</Label>
          <Input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50"
            placeholder="+234..."
          />
        </div>

        {/* Occupation */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Occupation</Label>
          <Input
            value={form.occupation}
            onChange={(e) => setForm({ ...form, occupation: e.target.value })}
            className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50"
            placeholder="e.g. Student, Software Developer"
          />
        </div>

        {/* Is Student */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={form.is_student}
            onChange={(e) => setForm({ ...form, is_student: e.target.checked })}
            className="w-5 h-5 rounded border-[#2A2A3A] accent-[#3B82F6] bg-[#1A1A24]"
          />
          <Label className="text-sm text-white">I am a student</Label>
        </div>

        {form.is_student && (
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">School</Label>
            <Input
              value={form.school}
              onChange={(e) => setForm({ ...form, school: e.target.value })}
              className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50"
              placeholder="e.g. University of Lagos"
            />
          </div>
        )}

        {/* Gender */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Gender</Label>
          <select
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none"
          >
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        {/* Budget */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Budget Min (N)</Label>
            <Input
              type="number"
              value={form.budget_min}
              onChange={(e) => setForm({ ...form, budget_min: Number(e.target.value) })}
              className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white focus:border-[#3B82F6]/50"
            />
          </div>
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Budget Max (N)</Label>
            <Input
              type="number"
              value={form.budget_max}
              onChange={(e) => setForm({ ...form, budget_max: Number(e.target.value) })}
              className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white focus:border-[#3B82F6]/50"
            />
          </div>
        </div>

        {/* Location */}
        <div className="glass rounded-2xl p-4">
          <Label className="text-xs text-[#8A8B9C] mb-3 block font-medium">Your Location</Label>
          <LocationSelector value={location} onChange={setLocation} />
        </div>

        <Button
          type="submit"
          disabled={saving || usernameStatus === 'checking' || usernameStatus === 'taken' || usernameStatus === 'invalid'}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white hover:opacity-90 font-semibold shadow-lg shadow-blue-500/20 disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </form>
    </div>
  );
}

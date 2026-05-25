import { useState } from 'react';
import { updateProfile } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface ProfileEditProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
  onBack: () => void;
}

export default function ProfileEdit({ profile, onUpdate, onBack }: ProfileEditProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    avatar_url: profile.avatar_url || '',
    bio: profile.bio || '',
    phone: profile.phone || '',
    occupation: profile.occupation || '',
    is_student: profile.is_student || false,
    school: profile.school || '',
    gender: profile.gender || '',
    budget_min: profile.budget_min || 50000,
    budget_max: profile.budget_max || 500000,
    preferred_location: profile.preferred_location || '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { profile: updated, error } = await updateProfile(profile.user_id, form);
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success('Profile updated!');
    if (updated) onUpdate(updated);
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg></button>
        <h1 className="text-base font-semibold">Edit Profile</h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Avatar */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Profile Photo URL</Label>
          <Input value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="https://..." />
          {form.avatar_url && <img src={form.avatar_url} alt="Preview" className="w-16 h-16 rounded-full object-cover mt-2 border border-[#2A2A3A]" />}
        </div>

        {/* Bio */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Bio</Label>
          <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" rows={3} placeholder="Tell others about yourself..." />
        </div>

        {/* Phone */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Phone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="+234..." />
        </div>

        {/* Occupation */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Occupation</Label>
          <Input value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="e.g. Student, Software Developer" />
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

        {/* School (only if student) */}
        {form.is_student && (
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">School</Label>
            <Input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="e.g. University of Lagos" />
          </div>
        )}

        {/* Gender */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Gender</Label>
          <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none">
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        {/* Budget */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Budget Min (₦)</Label>
            <Input type="number" value={form.budget_min} onChange={(e) => setForm({ ...form, budget_min: Number(e.target.value) })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white focus:border-[#3B82F6]/50" />
          </div>
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Budget Max (₦)</Label>
            <Input type="number" value={form.budget_max} onChange={(e) => setForm({ ...form, budget_max: Number(e.target.value) })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white focus:border-[#3B82F6]/50" />
          </div>
        </div>

        {/* Preferred Location */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Preferred Location</Label>
          <Input value={form.preferred_location} onChange={(e) => setForm({ ...form, preferred_location: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="e.g. Ikeja, Lagos" />
        </div>

        <Button type="submit" disabled={saving} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white hover:opacity-90 font-semibold shadow-lg shadow-blue-500/20">
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </form>
    </div>
  );
}

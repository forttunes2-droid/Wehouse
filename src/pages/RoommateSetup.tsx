import { useState } from 'react';
import { saveRoommatePreferences } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface RoommateSetupProps {
  profile: Profile;
  onComplete: () => void;
}

export default function RoommateSetup({ profile, onComplete }: RoommateSetupProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    gender: '' as 'male' | 'female' | '',
    gender_preference: 'no_preference' as 'male' | 'female' | 'no_preference',
    budget_min: '',
    budget_max: '',
    study_level: '',
    noise_level: 'moderate' as 'quiet' | 'moderate' | 'loud',
    cleanliness: 'moderate' as 'neat' | 'moderate' | 'relaxed',
    sleep_time: '11pm-12am',
    visitors: 'sometimes' as 'rarely' | 'sometimes' | 'often',
    stay_duration: '1_year',
    area_preference: '',
    bio: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.gender) { toast.error('Please select your gender'); return; }
    if (!form.budget_min || !form.budget_max) { toast.error('Please set your budget range'); return; }

    setSaving(true);
    const { error } = await saveRoommatePreferences({
      user_id: profile.user_id,
      auth_id: profile.auth_id,
      gender: form.gender,
      gender_preference: form.gender_preference,
      budget_min: Number(form.budget_min),
      budget_max: Number(form.budget_max),
      study_level: form.study_level,
      noise_level: form.noise_level,
      cleanliness: form.cleanliness,
      sleep_time: form.sleep_time,
      visitors: form.visitors,
      stay_duration: form.stay_duration,
      area_preference: form.area_preference,
      bio: form.bio,
      active: true,
    });
    setSaving(false);

    if (error) {
      toast.error('Save failed: ' + error.message);
      return;
    }
    toast.success('Roommate profile saved!');
    onComplete();
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4">
        <h1 className="text-base font-semibold">Roommate Profile</h1>
        <p className="text-[10px] text-[#8A8B9C]">@{profile.username}</p>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Gender */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Your Gender *</Label>
          <div className="flex gap-3">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setForm({ ...form, gender: g })}
                className={`flex-1 h-10 rounded-xl text-sm font-medium capitalize transition-all ${
                  form.gender === g
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Gender Preference */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Roommate Gender Preference</Label>
          <select
            value={form.gender_preference}
            onChange={(e) => setForm({ ...form, gender_preference: e.target.value as any })}
            className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none transition-colors"
          >
            <option value="no_preference">No Preference</option>
            <option value="male">Male Only</option>
            <option value="female">Female Only</option>
          </select>
        </div>

        {/* Budget */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Budget Min (₦)</Label>
            <Input type="number" value={form.budget_min} onChange={(e) => setForm({ ...form, budget_min: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="50000" required />
          </div>
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Budget Max (₦)</Label>
            <Input type="number" value={form.budget_max} onChange={(e) => setForm({ ...form, budget_max: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="200000" required />
          </div>
        </div>

        {/* Study Level */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Study Level</Label>
          <Input value={form.study_level} onChange={(e) => setForm({ ...form, study_level: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="e.g. Undergraduate Year 2" />
        </div>

        {/* Noise & Cleanliness */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Noise Level</Label>
            <select value={form.noise_level} onChange={(e) => setForm({ ...form, noise_level: e.target.value as any })} className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none">
              <option value="quiet">Quiet</option>
              <option value="moderate">Moderate</option>
              <option value="loud">Loud</option>
            </select>
          </div>
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Cleanliness</Label>
            <select value={form.cleanliness} onChange={(e) => setForm({ ...form, cleanliness: e.target.value as any })} className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none">
              <option value="neat">Neat Freak</option>
              <option value="moderate">Moderate</option>
              <option value="relaxed">Relaxed</option>
            </select>
          </div>
        </div>

        {/* Sleep & Visitors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Sleep Time</Label>
            <select value={form.sleep_time} onChange={(e) => setForm({ ...form, sleep_time: e.target.value })} className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none">
              <option value="9pm-10pm">9-10 PM</option>
              <option value="10pm-11pm">10-11 PM</option>
              <option value="11pm-12am">11-12 AM</option>
              <option value="12am-1am">12-1 AM</option>
              <option value="1am+">After 1 AM</option>
            </select>
          </div>
          <div>
            <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Visitors</Label>
            <select value={form.visitors} onChange={(e) => setForm({ ...form, visitors: e.target.value as any })} className="w-full h-10 rounded-xl border border-[#2A2A3A] px-3 text-sm bg-[#1A1A24] text-white focus:border-[#3B82F6]/50 outline-none">
              <option value="rarely">Rarely</option>
              <option value="sometimes">Sometimes</option>
              <option value="often">Often</option>
            </select>
          </div>
        </div>

        {/* Area */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">Preferred Area</Label>
          <Input value={form.area_preference} onChange={(e) => setForm({ ...form, area_preference: e.target.value })} className="h-10 rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" placeholder="e.g. Ikeja, Yaba" />
        </div>

        {/* Bio */}
        <div>
          <Label className="text-xs text-[#8A8B9C] mb-1.5 block">About You</Label>
          <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="rounded-xl text-sm bg-[#1A1A24] border-[#2A2A3A] text-white placeholder-[#8A8B9C] focus:border-[#3B82F6]/50" rows={3} placeholder="Tell potential roommates about yourself..." />
        </div>

        <Button type="submit" disabled={saving} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white hover:opacity-90 font-semibold shadow-lg shadow-blue-500/20">
          {saving ? 'Saving...' : 'Save & Find Matches'}
        </Button>
      </form>
    </div>
  );
}

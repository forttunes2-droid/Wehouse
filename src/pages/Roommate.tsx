import { useState, useEffect, useCallback } from 'react';
import { saveRoommatePreferences, getRoommatePreferences, findMatches } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface RoommateProps {
  profile: Profile;
}

type View = 'preview' | 'edit' | 'matches';

// ─── PREFERENCE CONFIG ─────────────────────────────

const CLEANLINESS_OPTIONS = [
  { value: 'neat', label: 'Neat Freak', icon: '✨' },
  { value: 'moderate', label: 'Moderate', icon: '👍' },
  { value: 'relaxed', label: 'Relaxed', icon: '😎' },
];

const NOISE_OPTIONS = [
  { value: 'quiet', label: 'Quiet', icon: '🔇' },
  { value: 'moderate', label: 'Moderate', icon: '🔉' },
  { value: 'loud', label: 'Social', icon: '🔊' },
];

const SLEEP_OPTIONS = [
  { value: '9pm-10pm', label: 'Early (9-10pm)' },
  { value: '10pm-11pm', label: 'Normal (10-11pm)' },
  { value: '11pm-12am', label: 'Late (11-12am)' },
  { value: '12am-1am', label: 'Night Owl (12-1am)' },
  { value: '1am+', label: 'Very Late (1am+)' },
];

const VISITOR_OPTIONS = [
  { value: 'rarely', label: 'Rarely' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'often', label: 'Often' },
];

const DURATION_OPTIONS = [
  { value: '3_months', label: '3 Months' },
  { value: '6_months', label: '6 Months' },
  { value: '1_year', label: '1 Year' },
  { value: '1_year+', label: '1+ Years' },
];

const GENDER_PREF_OPTIONS = [
  { value: 'no_preference', label: 'No Preference' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

// ─── MAIN COMPONENT ────────────────────────────────

export default function Roommate({ profile }: RoommateProps) {
  const [view, setView] = useState<View>('preview');
  const [prefs, setPrefs] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    const { prefs: data } = await getRoommatePreferences(profile.user_id);
    setPrefs(data);
    setLoading(false);
  }, [profile.user_id]);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    const { matches: data } = await findMatches(profile.user_id);
    setMatches(data || []);
    setLoading(false);
  }, [profile.user_id]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const handleSave = async (formData: any) => {
    const { error } = await saveRoommatePreferences({
      user_id: profile.user_id,
      auth_id: profile.auth_id,
      ...formData,
      active: true,
    });
    if (error) {
      toast.error('Save failed: ' + error.message);
      return;
    }
    toast.success('Preferences updated!');
    await loadPrefs();
    setView('preview');
  };

  if (loading && view !== 'edit') {
    return <RoommateSkeleton />;
  }

  // No prefs yet → force edit view
  if (!prefs && view !== 'edit') {
    return <EditView onSave={handleSave} onCancel={() => {}} isFirstTime />;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <Toaster position="top-center" richColors />

      {view === 'preview' && <PreviewView profile={profile} prefs={prefs} onChangeView={setView} />}
      {view === 'edit' && <EditView existingPrefs={prefs} onSave={handleSave} onCancel={() => setView('preview')} />}
      {view === 'matches' && <MatchesView matches={matches} loading={loading} onChangeView={setView} onRefresh={loadMatches} />}
    </div>
  );
}

// ─── PREVIEW VIEW ──────────────────────────────────

function PreviewView({ profile, prefs, onChangeView }: { profile: Profile; prefs: any; onChangeView: (v: View) => void }) {
  const budget = prefs ? `N${prefs.budget_min?.toLocaleString()} - N${prefs.budget_max?.toLocaleString()}` : 'Not set';

  const preferenceCards = [
    { label: 'Budget', value: budget, icon: 'N' },
    { label: 'Location', value: prefs?.area_preference || 'Not set', icon: '📍' },
    { label: 'Gender', value: prefs?.gender ? prefs.gender.charAt(0).toUpperCase() + prefs.gender.slice(1) : 'Not set', icon: '👤' },
    { label: 'Preference', value: GENDER_PREF_OPTIONS.find(o => o.value === prefs?.gender_preference)?.label || 'Not set', icon: '🔍' },
    { label: 'Cleanliness', value: CLEANLINESS_OPTIONS.find(o => o.value === prefs?.cleanliness)?.label || 'Not set', icon: '✨' },
    { label: 'Noise Level', value: NOISE_OPTIONS.find(o => o.value === prefs?.noise_level)?.label || 'Not set', icon: '🔊' },
    { label: 'Sleep', value: SLEEP_OPTIONS.find(o => o.value === prefs?.sleep_time)?.label || 'Not set', icon: '🌙' },
    { label: 'Visitors', value: VISITOR_OPTIONS.find(o => o.value === prefs?.visitors)?.label || 'Not set', icon: '🚪' },
    { label: 'Duration', value: DURATION_OPTIONS.find(o => o.value === prefs?.stay_duration)?.label || 'Not set', icon: '📅' },
    { label: 'Occupation', value: prefs?.study_level || 'Not set', icon: '💼' },
  ];

  return (
    <>
      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-white mb-1">Roommate</h1>
          <p className="text-xs text-[#5C5E72]">Your profile and matches</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* My Profile Card */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Your Roommate Profile</h2>
            <button
              onClick={() => onChangeView('edit')}
              className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA] font-medium px-2.5 py-1 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
            >
              Edit
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-lg font-bold glow-blue-sm">
              {(profile.username || profile.email[0]).charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">@{profile.username || 'user'}</div>
              <div className="text-[10px] text-[#5C5E72]">{profile.preferred_location || prefs?.area_preference || 'No location set'}</div>
            </div>
          </div>

          {prefs?.bio && (
            <p className="text-xs text-[#8A8B9C] mb-4 leading-relaxed italic">&ldquo;{prefs.bio}&rdquo;</p>
          )}

          {/* Preferences Grid */}
          <div className="grid grid-cols-2 gap-2">
            {preferenceCards.map((card) => (
              <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3">
                <div className="text-[10px] text-[#5C5E72] mb-0.5">{card.label}</div>
                <div className="text-xs text-white font-medium truncate">{card.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Find Matches Button */}
        <button
          onClick={() => onChangeView('matches')}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          Find Matches
        </button>
      </div>
    </>
  );
}

// ─── EDIT VIEW ─────────────────────────────────────

function EditView({ existingPrefs, onSave, onCancel, isFirstTime }: {
  existingPrefs?: any;
  onSave: (data: any) => void;
  onCancel: () => void;
  isFirstTime?: boolean;
}) {
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    gender: existingPrefs?.gender || '',
    gender_preference: existingPrefs?.gender_preference || 'no_preference',
    budget_min: existingPrefs?.budget_min ? String(existingPrefs.budget_min) : '',
    budget_max: existingPrefs?.budget_max ? String(existingPrefs.budget_max) : '',
    study_level: existingPrefs?.study_level || '',
    noise_level: existingPrefs?.noise_level || 'moderate',
    cleanliness: existingPrefs?.cleanliness || 'moderate',
    sleep_time: existingPrefs?.sleep_time || '10pm-11pm',
    visitors: existingPrefs?.visitors || 'sometimes',
    stay_duration: existingPrefs?.stay_duration || '1_year',
    area_preference: existingPrefs?.area_preference || '',
    bio: existingPrefs?.bio || '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.budget_min || !form.budget_max) {
      toast.error('Set your budget range');
      return;
    }
    setSaving(true);
    await onSave({
      gender: form.gender || 'male',
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
    });
    setSaving(false);
  }

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));

  return (
    <>
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isFirstTime && (
            <button onClick={onCancel} className="text-[#8A8B9C] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
          )}
          <div>
            <h1 className="text-base font-semibold text-white">{isFirstTime ? 'Roommate Setup' : 'Edit Preferences'}</h1>
            <p className="text-[10px] text-[#5C5E72]">{isFirstTime ? 'Quick setup — edit anytime later' : 'Update your preferences'}</p>
          </div>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Budget — Required */}
        <SectionCard title="Budget Range *" desc="Your monthly rent budget">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Min (N)</label>
              <input
                type="number"
                value={form.budget_min}
                onChange={(e) => update('budget_min', e.target.value)}
                placeholder="50000"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Max (N)</label>
              <input
                type="number"
                value={form.budget_max}
                onChange={(e) => update('budget_max', e.target.value)}
                placeholder="200000"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
              />
            </div>
          </div>
        </SectionCard>

        {/* Location */}
        <SectionCard title="Preferred Location" desc="Where do you want to live?" optional>
          <input
            value={form.area_preference}
            onChange={(e) => update('area_preference', e.target.value)}
            placeholder="e.g. Ikeja, Yaba, Lekki"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
        </SectionCard>

        {/* Your Gender */}
        <SectionCard title="Your Gender" desc="Used for matching preferences" optional>
          <div className="flex gap-2">
            {(['male', 'female'] as const).map((g) => (
              <ChipButton key={g} selected={form.gender === g} onClick={() => update('gender', g)}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Gender Preference */}
        <SectionCard title="Roommate Gender" desc="Who would you prefer to live with?" optional>
          <div className="flex gap-2 flex-wrap">
            {GENDER_PREF_OPTIONS.map((opt) => (
              <ChipButton key={opt.value} selected={form.gender_preference === opt.value} onClick={() => update('gender_preference', opt.value)}>
                {opt.label}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Cleanliness */}
        <SectionCard title="Cleanliness" desc="How tidy are you?" optional>
          <div className="flex gap-2 flex-wrap">
            {CLEANLINESS_OPTIONS.map((opt) => (
              <ChipButton key={opt.value} selected={form.cleanliness === opt.value} onClick={() => update('cleanliness', opt.value)}>
                <span className="mr-1">{opt.icon}</span>{opt.label}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Noise Level */}
        <SectionCard title="Noise Level" desc="Your living style" optional>
          <div className="flex gap-2 flex-wrap">
            {NOISE_OPTIONS.map((opt) => (
              <ChipButton key={opt.value} selected={form.noise_level === opt.value} onClick={() => update('noise_level', opt.value)}>
                <span className="mr-1">{opt.icon}</span>{opt.label}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Sleep Schedule */}
        <SectionCard title="Sleep Schedule" desc="When do you usually sleep?" optional>
          <div className="flex gap-2 flex-wrap">
            {SLEEP_OPTIONS.map((opt) => (
              <ChipButton key={opt.value} selected={form.sleep_time === opt.value} onClick={() => update('sleep_time', opt.value)}>
                {opt.label}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Visitors */}
        <SectionCard title="Visitors" desc="How often do you have guests?" optional>
          <div className="flex gap-2 flex-wrap">
            {VISITOR_OPTIONS.map((opt) => (
              <ChipButton key={opt.value} selected={form.visitors === opt.value} onClick={() => update('visitors', opt.value)}>
                {opt.label}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Duration */}
        <SectionCard title="Move-in Duration" desc="How long are you looking to stay?" optional>
          <div className="flex gap-2 flex-wrap">
            {DURATION_OPTIONS.map((opt) => (
              <ChipButton key={opt.value} selected={form.stay_duration === opt.value} onClick={() => update('stay_duration', opt.value)}>
                {opt.label}
              </ChipButton>
            ))}
          </div>
        </SectionCard>

        {/* Occupation */}
        <SectionCard title="Occupation / Study" desc="What do you do?" optional>
          <input
            value={form.study_level}
            onChange={(e) => update('study_level', e.target.value)}
            placeholder="e.g. Software Developer, Student"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
        </SectionCard>

        {/* Bio */}
        <SectionCard title="About You" desc="Tell potential roommates about yourself" optional>
          <textarea
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="Your habits, hobbies, what you're looking for..."
            rows={3}
            className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none"
          />
        </SectionCard>

        {/* Submit */}
        <button
          type="submit"
          disabled={saving}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? 'Saving...' : isFirstTime ? 'Save & Continue' : 'Update Preferences'}
        </button>

        {!isFirstTime && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full h-10 rounded-xl text-sm text-[#5C5E72] hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
      </form>
    </>
  );
}

// ─── MATCHES VIEW ──────────────────────────────────

function MatchesView({ matches, loading, onChangeView, onRefresh }: {
  matches: any[];
  loading: boolean;
  onChangeView: (v: View) => void;
  onRefresh: () => void;
}) {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  function getScoreColor(score: number) {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-red-400';
  }

  function getScoreLabel(score: number) {
    if (score >= 70) return 'High Match';
    if (score >= 40) return 'Medium Match';
    return 'Low Match';
  }

  return (
    <>
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => onChangeView('preview')} className="text-[#8A8B9C] hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-base font-semibold text-white">Matches</h1>
            <p className="text-[10px] text-[#5C5E72]">{matches.length} found</p>
          </div>
        </div>
        <button
          onClick={() => onChangeView('edit')}
          className="text-[10px] text-[#3B82F6] hover:text-[#60A5FA] font-medium px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
        >
          Edit Filters
        </button>
      </header>

      <div className="max-w-lg mx-auto px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-[#12121A] border border-white/[0.04] rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#1A1A24] shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                    <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-1/2" />
                  </div>
                </div>
                <div className="h-2 bg-[#1A1A24] shimmer rounded w-full" />
              </div>
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No matches yet</p>
            <p className="text-xs text-[#8A8B9C]/70 mt-1 mb-4">Update your preferences for better matches</p>
            <button
              onClick={() => onChangeView('edit')}
              className="h-9 px-4 rounded-xl bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-medium hover:bg-[#3B82F6]/20 transition-colors"
            >
              Update Preferences
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {matches.map((m, i) => (
              <div key={i} className="bg-[#12121A] border border-white/[0.04] rounded-2xl p-4 hover:border-[#3B82F6]/20 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#1E3A5F] flex items-center justify-center text-white text-sm font-bold">
                    {(m.profiles?.username || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">@{m.profiles?.username || 'user'}</div>
                    <div className="text-[10px] text-[#8A8B9C] capitalize">{m.gender} · {m.study_level || 'Student'}</div>
                  </div>
                  <div className={`text-white text-[10px] font-bold px-2 py-1 rounded-full ${getScoreColor(m.match_score)}`}>
                    {m.match_score}%
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-[#1A1A24] overflow-hidden">
                    <div className={`h-full rounded-full ${getScoreColor(m.match_score)}`} style={{ width: `${m.match_score}%` }} />
                  </div>
                  <span className="text-[10px] text-[#8A8B9C]">{getScoreLabel(m.match_score)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-[#8A8B9C]">
                  <div><span className="text-white font-medium">Budget:</span> N{m.budget_min?.toLocaleString()}-N{m.budget_max?.toLocaleString()}</div>
                  <div><span className="text-white font-medium">Area:</span> {m.area_preference || 'Any'}</div>
                  <div><span className="text-white font-medium">Clean:</span> {m.cleanliness}</div>
                  <div><span className="text-white font-medium">Noise:</span> {m.noise_level}</div>
                  <div><span className="text-white font-medium">Sleep:</span> {m.sleep_time}</div>
                  <div><span className="text-white font-medium">Visitors:</span> {m.visitors}</div>
                </div>

                {m.bio && <p className="text-[10px] text-[#8A8B9C] mt-2 italic">&ldquo;{m.bio}&rdquo;</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── UI COMPONENTS ─────────────────────────────────

function SectionCard({ title, desc, optional, children }: { title: string; desc: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {optional && <span className="text-[9px] text-[#5C5E72] bg-[#1A1A24] px-1.5 py-0.5 rounded-full">Optional</span>}
        </div>
        <p className="text-[11px] text-[#5C5E72] mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function ChipButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3.5 rounded-xl text-xs font-medium transition-all ${
        selected
          ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
          : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function RoommateSkeleton() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] pb-20">
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <div className="h-7 w-32 rounded-lg shimmer mb-2" />
          <div className="h-4 w-48 rounded shimmer" />
        </div>
      </header>
      <div className="max-w-lg mx-auto px-5 space-y-4">
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 w-40 rounded shimmer" />
            <div className="h-6 w-12 rounded-lg shimmer" />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl shimmer" />
            <div className="space-y-2">
              <div className="h-4 w-24 rounded shimmer" />
              <div className="h-3 w-32 rounded shimmer" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-14 rounded-xl bg-[#1A1A24] shimmer" />)}
          </div>
        </div>
        <div className="h-12 rounded-xl shimmer" />
      </div>
    </div>
  );
}

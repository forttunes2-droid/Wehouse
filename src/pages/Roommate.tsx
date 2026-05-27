import { useState, useEffect, useCallback } from 'react';
import { saveRoommatePreferences, getRoommatePreferences, findMatches } from '@/lib/supabase';
import InstitutionSelector from '@/components/InstitutionSelector';
import RoommateLocationSelector from '@/components/RoommateLocationSelector';
import DualRangeSlider from '@/components/DualRangeSlider';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface RoommateProps {
  profile: Profile;
}

type View = 'preview' | 'edit' | 'matches';

const GENDER_PREF_OPTIONS = [
  { value: 'no_preference', label: 'Any' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

// Budget slider config
const BUDGET_FLOOR = 180000;
const BUDGET_CEILING = 5000000;
const BUDGET_STEP = 10000;

const CLEANLINESS_OPTIONS = [
  { value: 'neat', label: 'Neat', icon: '✨' },
  { value: 'moderate', label: 'Moderate', icon: '👍' },
  { value: 'relaxed', label: 'Relaxed', icon: '😎' },
];

const NOISE_OPTIONS = [
  { value: 'quiet', label: 'Quiet', icon: '🔇' },
  { value: 'moderate', label: 'Moderate', icon: '🔉' },
  { value: 'loud', label: 'Social', icon: '🔊' },
];

const SLEEP_OPTIONS = [
  { value: '9pm-10pm', label: 'Early' },
  { value: '10pm-11pm', label: 'Normal' },
  { value: '11pm-12am', label: 'Late' },
  { value: '12am-1am', label: 'Night Owl' },
];

const VISITOR_OPTIONS = [
  { value: 'rarely', label: 'Rarely' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'often', label: 'Often' },
];

const DURATION_OPTIONS = [
  { value: '3_months', label: '3 Mo' },
  { value: '6_months', label: '6 Mo' },
  { value: '1_year', label: '1 Yr' },
  { value: '1_year+', label: '1+ Yrs' },
];

// ─── MAIN COMPONENT ────────────────────────────────────

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
      area_preference: formData.area_preference || profile.city || '',
      active: true,
    });
    if (error) {
      toast.error('Save failed: ' + error.message);
      return;
    }
    toast.success('Preferences saved!');
    await loadPrefs();
    setView('preview');
  };

  if (loading && view !== 'edit') {
    return <RoommateSkeleton />;
  }

  if (!prefs && view !== 'edit') {
    return <EditView onSave={handleSave} onCancel={() => {}} isFirstTime />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />
      {view === 'preview' && <PreviewView profile={profile} prefs={prefs} onChangeView={setView} />}
      {view === 'edit' && <EditView existingPrefs={prefs} onSave={handleSave} onCancel={() => setView('preview')} />}
      {view === 'matches' && <MatchesView matches={matches} loading={loading} onChangeView={setView} onRefresh={loadMatches} />}
    </div>
  );
}

// ─── PREVIEW VIEW ──────────────────────────────────────

function PreviewView({ profile, prefs, onChangeView }: { profile: Profile; prefs: any; onChangeView: (v: View) => void }) {
  const budget = prefs ? `₦${prefs.budget_min?.toLocaleString()} – ₦${prefs.budget_max?.toLocaleString()}` : 'Not set';

  // Group cards into categories
  const essentialCards = [
    { label: 'Budget', value: budget, icon: '💰' },
    { label: 'Location', value: prefs?.area_preference || 'Not set', icon: '📍' },
    { label: 'Gender', value: prefs?.gender ? prefs.gender.charAt(0).toUpperCase() + prefs.gender.slice(1) : 'Not set', icon: '👤' },
    { label: 'Roommate', value: GENDER_PREF_OPTIONS.find(o => o.value === prefs?.gender_preference)?.label || 'Any', icon: '🔍' },
  ];

  const studentCards = prefs?.school_name ? [
    { label: 'School', value: prefs.school_name, icon: '🎓' },
    { label: 'Campus', value: prefs.campus || 'Main', icon: '🏫' },
    { label: 'Level', value: prefs.level ? `${prefs.level}L` : 'Not set', icon: '📚' },
    { label: 'Department', value: prefs.department || 'Not set', icon: '🔬' },
  ] : [];

  const lifestyleCards = [
    { label: 'Cleanliness', value: CLEANLINESS_OPTIONS.find(o => o.value === prefs?.cleanliness)?.label || 'Moderate', icon: '✨' },
    { label: 'Noise', value: NOISE_OPTIONS.find(o => o.value === prefs?.noise_level)?.label || 'Moderate', icon: '🔊' },
    { label: 'Sleep', value: SLEEP_OPTIONS.find(o => o.value === prefs?.sleep_time)?.label || 'Normal', icon: '🌙' },
    { label: 'Visitors', value: VISITOR_OPTIONS.find(o => o.value === prefs?.visitors)?.label || 'Sometimes', icon: '🚪' },
  ];

  return (
    <>
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <h1 className="text-lg font-bold text-white mb-1">Roommate</h1>
          <p className="text-xs text-[#5C5E72]">Your profile and matches</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Profile Card */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Your Profile</h2>
            <button
              onClick={() => onChangeView('edit')}
              className="text-[10px] text-[#3B82F6] font-semibold px-3 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
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
              <div className="text-[10px] text-[#5C5E72] flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                {profile.city || prefs?.area_preference || 'No location'}
              </div>
            </div>
          </div>

          {prefs?.bio && (
            <p className="text-xs text-[#8A8B9C] mb-4 leading-relaxed italic">&ldquo;{prefs.bio}&rdquo;</p>
          )}

          {/* Essential */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {essentialCards.map(card => (
              <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3">
                <div className="text-[10px] text-[#5C5E72] mb-0.5">{card.label}</div>
                <div className="text-xs text-white font-medium truncate">{card.value}</div>
              </div>
            ))}
          </div>

          {/* Student (if set) */}
          {studentCards.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {studentCards.map(card => (
                <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3 border border-[#3B82F6]/10">
                  <div className="text-[10px] text-[#3B82F6] mb-0.5">{card.label}</div>
                  <div className="text-xs text-white font-medium truncate">{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Lifestyle */}
          <div className="grid grid-cols-2 gap-2">
            {lifestyleCards.map(card => (
              <div key={card.label} className="bg-[#1A1A24] rounded-xl p-3">
                <div className="text-[10px] text-[#5C5E72] mb-0.5">{card.label}</div>
                <div className="text-xs text-white font-medium">{card.value}</div>
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

// ─── COLLAPSIBLE SECTION HELPER ────────────────────────

function CollapsibleSection({ title, subtitle, children, defaultOpen = false }: {
  title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-[10px] text-[#5C5E72] mt-0.5">{subtitle}</p>}
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 animate-fadeIn">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── EDIT VIEW (REDESIGNED — SHORT & ORGANIZED) ────────

function EditView({ existingPrefs, onSave, onCancel, isFirstTime }: {
  existingPrefs?: any;
  onSave: (data: any) => void;
  onCancel: () => void;
  isFirstTime?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [showStudent, setShowStudent] = useState(!!existingPrefs?.school_name);

  const [form, setForm] = useState({
    gender: existingPrefs?.gender || '',
    gender_preference: existingPrefs?.gender_preference || 'no_preference',
    budget_min: existingPrefs?.budget_min || BUDGET_FLOOR,
    budget_max: existingPrefs?.budget_max || 1000000,
    study_level: existingPrefs?.study_level || '',
    noise_level: existingPrefs?.noise_level || 'moderate',
    cleanliness: existingPrefs?.cleanliness || 'moderate',
    sleep_time: existingPrefs?.sleep_time || '10pm-11pm',
    visitors: existingPrefs?.visitors || 'sometimes',
    stay_duration: existingPrefs?.stay_duration || '1_year',
    area_preference: existingPrefs?.area_preference || '',
    preferred_state: existingPrefs?.preferred_state || '',
    preferred_lga: existingPrefs?.preferred_lga || '',
    preferred_area: existingPrefs?.preferred_area || '',
    bio: existingPrefs?.bio || '',
    school_name: existingPrefs?.school_name || '',
    campus: existingPrefs?.campus || '',
    faculty: existingPrefs?.faculty || '',
    department: existingPrefs?.department || '',
    level: existingPrefs?.level || '',
    school_match: existingPrefs?.school_match ?? true,
    campus_match: existingPrefs?.campus_match ?? true,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.budget_min || !form.budget_max) {
      toast.error('Set your budget range');
      return;
    }
    if (form.budget_min < BUDGET_FLOOR) {
      toast.error(`Minimum budget is ₦${BUDGET_FLOOR.toLocaleString()}`);
      return;
    }
    if (form.budget_max <= form.budget_min) {
      toast.error('Maximum budget must be greater than minimum');
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
      area_preference: form.preferred_lga || form.area_preference,
      preferred_state: form.preferred_state || null,
      preferred_lga: form.preferred_lga || null,
      preferred_area: form.preferred_area || null,
      bio: form.bio,
      school_name: showStudent ? (form.school_name || null) : null,
      campus: showStudent ? (form.campus || null) : null,
      faculty: showStudent ? (form.faculty || null) : null,
      department: showStudent ? (form.department || null) : null,
      level: showStudent ? (form.level || null) : null,
      school_match: showStudent ? form.school_match : false,
      campus_match: showStudent ? form.campus_match : false,
    });
    setSaving(false);
  }

  const update = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  return (
    <>
      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          {!isFirstTime && (
            <button onClick={onCancel} className="text-[#8A8B9C] hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
          )}
          <div>
            <h1 className="text-base font-semibold text-white">{isFirstTime ? 'Roommate Setup' : 'Edit Preferences'}</h1>
            <p className="text-[10px] text-[#5C5E72]">{isFirstTime ? 'Quick setup — 3 steps' : 'Update your preferences'}</p>
          </div>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-4">

        {/* ═════ STEP 1: ESSENTIALS (always visible) ═════ */}
        <div className="glass rounded-2xl p-4">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-white">Essentials</h3>
            <p className="text-[10px] text-[#5C5E72] mt-0.5">Required for matching</p>
          </div>

          {/* Budget — Dual Range Slider */}
          <div className="mb-4">
            <label className="text-[10px] text-[#5C5E72] mb-1 block font-medium">Budget Range *</label>
            <DualRangeSlider
              min={form.budget_min}
              max={form.budget_max}
              floor={BUDGET_FLOOR}
              ceiling={BUDGET_CEILING}
              step={BUDGET_STEP}
              onChange={(newMin, newMax) => {
                update('budget_min', newMin);
                update('budget_max', newMax);
              }}
            />
          </div>

          {/* Structured Location — State → LGA → Area */}
          <div className="mb-4">
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Location *</label>
            <RoommateLocationSelector
              value={{
                preferred_state: form.preferred_state,
                preferred_lga: form.preferred_lga,
                preferred_area: form.preferred_area,
              }}
              onChange={(v) => setForm(f => ({ ...f, ...v }))}
            />
          </div>

          {/* Gender */}
          <div className="mb-4">
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Your Gender *</label>
            <div className="flex gap-2">
              {(['male', 'female'] as const).map(g => (
                <Chip key={g} selected={form.gender === g} onClick={() => update('gender', g)}>
                  {g === 'male' ? '👨' : '👩'} {g.charAt(0).toUpperCase() + g.slice(1)}
                </Chip>
              ))}
            </div>
          </div>

          {/* Roommate Gender Preference */}
          <div>
            <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Roommate Gender</label>
            <div className="flex gap-2 flex-wrap">
              {GENDER_PREF_OPTIONS.map(opt => (
                <Chip key={opt.value} selected={form.gender_preference === opt.value} onClick={() => update('gender_preference', opt.value)}>
                  {opt.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {/* ═════ STEP 2: STUDENT INFO (collapsible) ═════ */}
        <div className="glass rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowStudent(!showStudent)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c0 1.66 4 3 9 3s9-1.34 9-3v-5" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Student Info</h3>
                <p className="text-[10px] text-[#5C5E72]">{showStudent ? 'Tap to hide' : 'Add school for better matches'}</p>
              </div>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors relative ${showStudent ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A]'}`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showStudent ? 'translate-x-4.5 left-0' : 'left-0.5'}`} style={{ transform: showStudent ? 'translateX(16px)' : 'translateX(0)' }} />
            </div>
          </button>

          {showStudent && (
            <div className="px-4 pb-4 animate-fadeIn">
              <div className="border-t border-[#1E1E2C] pt-4">
                <InstitutionSelector
                  value={{
                    school_name: form.school_name,
                    campus: form.campus,
                    faculty: form.faculty,
                    department: form.department,
                    level: form.level,
                  }}
                  onChange={(v) => setForm(f => ({ ...f, ...v }))}
                />
                {/* Match preferences */}
                {form.school_name && (
                  <div className="mt-3 pt-3 border-t border-[#1E1E2C] space-y-2">
                    <p className="text-[10px] text-[#5C5E72] font-medium">Match Preferences</p>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.school_match}
                        onChange={(e) => update('school_match', e.target.checked)}
                        className="w-4 h-4 rounded border-[#2A2A3A] bg-[#1A1A24] text-[#3B82F6]"
                      />
                      <span className="text-xs text-[#8A8B9C]">Prefer same school</span>
                    </label>
                    {form.campus && (
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.campus_match}
                          onChange={(e) => update('campus_match', e.target.checked)}
                          className="w-4 h-4 rounded border-[#2A2A3A] bg-[#1A1A24] text-[#3B82F6]"
                        />
                        <span className="text-xs text-[#8A8B9C]">Prefer same campus</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ═════ STEP 3: LIFESTYLE (collapsible) ═════ */}
        <CollapsibleSection title="Lifestyle Preferences" subtitle="Cleanliness, sleep, visitors, duration">
          <div className="space-y-4">
            {/* Cleanliness */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Cleanliness</label>
              <div className="flex gap-2">
                {CLEANLINESS_OPTIONS.map(opt => (
                  <Chip key={opt.value} selected={form.cleanliness === opt.value} onClick={() => update('cleanliness', opt.value)}>
                    {opt.icon} {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Noise */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Noise Level</label>
              <div className="flex gap-2">
                {NOISE_OPTIONS.map(opt => (
                  <Chip key={opt.value} selected={form.noise_level === opt.value} onClick={() => update('noise_level', opt.value)}>
                    {opt.icon} {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Sleep */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Sleep Schedule</label>
              <div className="flex gap-2 flex-wrap">
                {SLEEP_OPTIONS.map(opt => (
                  <Chip key={opt.value} selected={form.sleep_time === opt.value} onClick={() => update('sleep_time', opt.value)}>
                    {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Visitors */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Visitors</label>
              <div className="flex gap-2">
                {VISITOR_OPTIONS.map(opt => (
                  <Chip key={opt.value} selected={form.visitors === opt.value} onClick={() => update('visitors', opt.value)}>
                    {opt.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1.5 block font-medium">Stay Duration</label>
              <div className="flex gap-2">
                {DURATION_OPTIONS.map(opt => (
                  <Chip key={opt.value} selected={form.stay_duration === opt.value} onClick={() => update('stay_duration', opt.value)}>
                    {opt.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* Bio (always visible, compact) */}
        <div className="glass rounded-2xl p-4">
          <label className="text-sm font-semibold text-white mb-1 block">About You</label>
          <p className="text-[10px] text-[#5C5E72] mb-3">Brief intro for potential roommates</p>
          <textarea
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="Your habits, hobbies, what you're looking for..."
            rows={2}
            className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none"
          />
        </div>

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

// ─── MATCHES VIEW ──────────────────────────────────────

function MatchesView({ matches, loading, onChangeView, onRefresh }: {
  matches: any[];
  loading: boolean;
  onChangeView: (v: View) => void;
  onRefresh: () => void;
}) {
  useEffect(() => { onRefresh(); }, [onRefresh]);

  const scoreColor = (s: number) => s >= 70 ? 'bg-green-500' : s >= 40 ? 'bg-amber-500' : 'bg-red-400';
  const scoreLabel = (s: number) => s >= 70 ? 'High' : s >= 40 ? 'Good' : 'Low';

  return (
    <>
      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4 flex items-center justify-between sticky top-0 z-30">
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
          className="text-[10px] text-[#3B82F6] font-medium px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 transition-colors"
        >
          Edit Filters
        </button>
      </header>

      <div className="max-w-lg mx-auto px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-[#12121A] border border-white/[0.04] rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#1A1A24] shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-[#1A1A24] shimmer rounded w-1/3" />
                    <div className="h-2.5 bg-[#1A1A24] shimmer rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[#1A1A24] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <p className="text-sm text-[#8A8B9C]">No matches yet</p>
            <p className="text-xs text-[#8A8B9C]/70 mt-1 mb-4">Update preferences for better matches</p>
            <button onClick={() => onChangeView('edit')} className="h-9 px-4 rounded-xl bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-medium hover:bg-[#3B82F6]/20 transition-colors">
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
                  <div className={`text-white text-[10px] font-bold px-2 py-1 rounded-full ${scoreColor(m.match_score)}`}>
                    {m.match_score}%
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-[#1A1A24] overflow-hidden">
                    <div className={`h-full rounded-full ${scoreColor(m.match_score)}`} style={{ width: `${m.match_score}%` }} />
                  </div>
                  <span className="text-[10px] text-[#8A8B9C]">{scoreLabel(m.match_score)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-[#8A8B9C]">
                  <div><span className="text-white font-medium">Budget:</span> ₦{m.budget_min?.toLocaleString()}-₦{m.budget_max?.toLocaleString()}</div>
                  <div><span className="text-white font-medium">Area:</span> {m.area_preference || 'Any'}</div>
                  <div><span className="text-white font-medium">Clean:</span> {m.cleanliness}</div>
                  <div><span className="text-white font-medium">Noise:</span> {m.noise_level}</div>
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

// ─── UI COMPONENTS ─────────────────────────────────────

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
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
    <div className="min-h-screen bg-transparent pb-20">
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto">
          <div className="h-7 w-32 rounded-lg shimmer mb-2" />
          <div className="h-4 w-48 rounded shimmer" />
        </div>
      </header>
      <div className="max-w-lg mx-auto px-5 space-y-4">
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="h-5 w-40 rounded shimmer" />
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

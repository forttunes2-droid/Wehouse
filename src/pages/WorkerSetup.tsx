import { useState, useRef, useCallback, useEffect } from 'react';
import { updateProfile, uploadAvatar, getServiceCategories, getServiceSubcategories } from '@/lib/supabase';
import LocationSelector from '@/components/LocationSelector';
import { Toaster, toast } from 'sonner';
import type { Profile, ServiceCategory, ServiceSubcategory } from '@/types';

interface WorkerSetupProps {
  profile: Profile;
  onComplete: () => void;
}

export default function WorkerSetup({ profile, onComplete }: WorkerSetupProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);

  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    username: profile.username || '',
    worker_occupation: profile.worker_occupation || '',
    worker_skills: (profile.worker_skills as string[]) || [],
    worker_subcategory: ((profile.worker_skills as string[]) || [])[0] || '',
    worker_price: profile.worker_price || '',
    worker_bio: profile.worker_bio || '',
    bio: profile.bio || '',
    phone: profile.phone || '',
    location: {
      country: profile.country || 'Nigeria',
      state: profile.state || '',
      city: profile.city || '',
      area: profile.area || '',
    },
  });

  // Database-driven categories
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [subcategories, setSubcategories] = useState<ServiceSubcategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    async function load() {
      const { categories: cats } = await getServiceCategories();
      setCategories(cats || []);
      // If profile already has an occupation that matches a category, pre-select it
      if (profile.worker_occupation && cats) {
        const match = cats.find(c => c.name === profile.worker_occupation);
        if (match) {
          setSelectedCategory(match.id);
          const { subcategories: subs } = await getServiceSubcategories(match.id);
          setSubcategories(subs || []);
        }
      }
    }
    load();
  }, [profile.worker_occupation]);

  useEffect(() => {
    if (selectedCategory) {
      getServiceSubcategories(selectedCategory).then(({ subcategories: subs }) => {
        setSubcategories(subs || []);
      });
    } else {
      setSubcategories([]);
    }
  }, [selectedCategory]);

  const handleAvatar = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Select an image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Max 5MB'); return; }
    setUploading(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setUploading(false);
    if (error || !url) { toast.error('Upload failed'); return; }
    setAvatarUrl(url);
    toast.success('Photo uploaded');
  }, [profile.user_id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.worker_occupation) { toast.error('Select your occupation category'); return; }
    if (!form.worker_subcategory) { toast.error('Select your specialty (one only)'); return; }
    if (!form.location.city) { toast.error('Select your city'); return; }

    setSaving(true);
    const priceNum = form.worker_price ? parseInt(form.worker_price as string) || 0 : 0;
    // If worker was already verified, editing resets them to pending (requires re-approval)
    const wasApproved = profile.worker_status === 'approved_for_verification';
    const { error } = await updateProfile(profile.user_id, {
      full_name: form.full_name.trim(),
      username: form.username.trim() || profile.username,
      worker_occupation: form.worker_occupation,
      worker_skills: [form.worker_subcategory], // ONE skill only
      worker_price: priceNum > 0 ? priceNum : null,
      worker_bio: form.worker_bio.trim() || null,
      bio: form.bio.trim() || null,
      phone: form.phone.trim() || null,
      country: form.location.country,
      state: form.location.state,
      city: form.location.city,
      area: form.location.area || null,
      avatar_url: avatarUrl,
      profile_complete: true,
      ...(wasApproved ? { worker_status: 'pending' as const } : {}),
    });
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    toast.success('Profile submitted for review!');
    onComplete();
  }

  const initials = (form.full_name || profile.email[0]).charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <h1 className="text-base font-semibold text-white">Worker Profile Setup</h1>
        <p className="text-[10px] text-[#5C5E72]">Complete your profile for verification</p>
      </header>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto px-5 py-5 space-y-5">
        {/* Status Banner */}
        <div className="glass rounded-2xl p-4 border border-amber-500/10 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-amber-400">Pending Verification</p>
            <p className="text-[11px] text-[#5C5E72] mt-0.5">Your profile will be reviewed by an admin before going public.</p>
          </div>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-2xl font-bold glow-blue-sm overflow-hidden disabled:opacity-60 active:scale-95 transition-all">
            {uploading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : initials}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            </div>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          <p className="text-[10px] text-[#5C5E72]">Tap to add photo</p>
        </div>

        {/* Full Name */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Full Name *</label>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            placeholder="Your full name"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
        </div>

        {/* Username */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Username</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5C5E72] text-sm">@</span>
            <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase() }))}
              placeholder="username"
              className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm pl-7 pr-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
          </div>
        </div>

        {/* Service Category */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Service Category *</label>
          <p className="text-[10px] text-[#5C5E72] mb-2">Select the category that best matches your work</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setForm(f => ({ ...f, worker_occupation: cat.name }));
                }}
                className={`h-9 px-3.5 rounded-xl text-xs font-medium transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                <span className="mr-1">{cat.icon}</span>
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* ONE Subcategory Selection Only */}
        {selectedCategory && subcategories.length > 0 && (
          <div>
            <label className="text-xs text-[#8A8B9C] font-medium mb-2 block">Your Specialty (Select ONE only)</label>
            <p className="text-[10px] text-amber-400 mb-2">A worker can only have ONE specialty. Pick your main skill.</p>
            <div className="flex flex-wrap gap-2">
              {subcategories.map(sub => {
                const isSelected = form.worker_subcategory === sub.name;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      worker_subcategory: isSelected ? '' : sub.name,
                      worker_skills: isSelected ? [] : [sub.name],
                    }))}
                    className={`h-8 px-3 rounded-lg text-[11px] font-medium border transition-all ${
                      isSelected
                        ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white border-[#3B82F6] shadow-lg shadow-blue-500/20'
                        : 'bg-[#1A1A24] border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                    }`}
                  >
                    {isSelected && <span className="mr-1">✓</span>}
                    {sub.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Price */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Your Starting Price (NGN) *</label>
          <input
            value={form.worker_price}
            onChange={e => setForm(f => ({ ...f, worker_price: e.target.value }))}
            placeholder="e.g. 5000 (what you charge per job/hour)"
            type="text"
            inputMode="decimal"
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
          <p className="text-[10px] text-[#5C5E72] mt-1">This is what users see. You can discuss exact pricing in chat.</p>
        </div>

        {/* Bio */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">About Your Services</label>
          <textarea value={form.worker_bio} onChange={e => setForm(f => ({ ...f, worker_bio: e.target.value }))}
            placeholder="Describe your skills and services..."
            rows={3} className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none resize-none" />
        </div>

        {/* Phone */}
        <div>
          <label className="text-xs text-[#8A8B9C] font-medium mb-1.5 block">Phone Number</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="+234..."
            className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none" />
        </div>

        {/* Location */}
        <div className="glass rounded-2xl p-4">
          <label className="text-xs text-[#8A8B9C] font-medium mb-3 block">Your Location *</label>
          <LocationSelector value={form.location} onChange={loc => setForm(f => ({ ...f, location: loc }))} />
        </div>

        <button type="submit" disabled={saving}
          className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40">
          {saving ? 'Submitting...' : 'Submit for Verification'}
        </button>
      </form>
    </div>
  );
}

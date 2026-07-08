import { useState, useRef, useCallback, useEffect } from 'react';
import { updateProfile, uploadAvatar, getServiceCategories, getServiceSubcategories, supabase } from '@/lib/supabase';
import { initializePaystackPopup, generatePaymentReference } from '@/lib/paystack-marketplace';
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
  const [step, setStep] = useState<'form' | 'payment' | 'success'>('form');
  const [paying, setPaying] = useState(false);
  const [verificationFee, setVerificationFee] = useState<number>(5000);

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

  // Load verification fee from platform settings
  useEffect(() => {
    async function loadFee() {
      const { data } = await supabase.rpc('get_setting_v2', { p_key: 'worker_verification_fee' });
      if (data) setVerificationFee(parseInt(data) || 5000);
    }
    loadFee();
  }, []);

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
    // Go to payment step — Pay verification fee for blue tick
    setStep('payment');
  }

  async function handlePaystackPayment() {
    setPaying(true);
    const reference = generatePaymentReference();

    // Get Paystack public key from settings
    const { data: pk } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_public_key' });
    if (!pk) {
      toast.error('Paystack not configured. Contact support.');
      setPaying(false);
      return;
    }

    // Load Paystack script and open payment
    initializePaystackPopup({
      publicKey: pk,
      email: profile.email,
      amountKobo: verificationFee * 100,
      reference,
      metadata: {
        worker_user_id: profile.user_id,
        payment_type: 'worker_verification',
        worker_name: form.full_name || profile.username,
      },
      onSuccess: async (ref: string) => {
        // Payment succeeded — Golden Badge appears
        // Status = 'approved_for_verification' (payment done, NOT approved yet)
        // worker_verified stays FALSE — only admin/creator can set to TRUE
        const { error: updateError } = await supabase.from('profiles').update({
          worker_status: 'approved_for_verification',
          worker_verified: false, // NOT verified yet — admin must approve
          updated_at: new Date().toISOString(),
        }).eq('user_id', profile.user_id);

        if (updateError) {
          toast.error('Payment successful but status update failed. Contact support.');
          setPaying(false);
          return;
        }

        // Record the payment (non-critical)
        try {
          await supabase.rpc('record_worker_verification_payment', {
            p_user_id: profile.user_id,
            p_reference: ref,
            p_amount: verificationFee,
          });
        } catch (_) { /* ignore */ }

        toast.success('Payment successful! Your Golden Verification Badge is now active.');
        setStep('success');
        setPaying(false);
      },
      onCancel: () => {
        toast.info('Payment cancelled. Your profile is saved but not verified yet.');
        setPaying(false);
      },
    });
  }

  function handleSkipPayment() {
    toast.info('You can verify later from your profile.');
    onComplete();
  }

  function handleSuccessDone() {
    onComplete();
  }

  const initials = (form.full_name || profile.email[0]).charAt(0).toUpperCase();

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-transparent pb-20 flex items-center justify-center px-5">
        <Toaster position="top-center" richColors />
        <div className="text-center max-w-sm">
          {/* Golden Badge */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/30">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </div>
          <h2 className="text-lg font-bold text-amber-400 mb-2">Golden Badge Active!</h2>
          <p className="text-sm text-[#5C5E72] mb-1">Your verification payment was successful.</p>
          <p className="text-sm text-[#5C5E72] mb-4">Your Golden Badge proves payment is complete.</p>
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 p-3 mb-4">
            <p className="text-[10px] text-amber-400 leading-relaxed">
              <strong>Next step:</strong> Go to your Worker Dashboard &gt; Verification Status tab.
              Upload your Government ID and Skill Demonstration Video, then click
              &quot;Submit Verification Request&quot; to send your application to WeHouse for review.
            </p>
          </div>
          <button onClick={handleSuccessDone} className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 text-white font-semibold shadow-lg shadow-amber-500/20 hover:opacity-90 transition-opacity">
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      <header className="bg-[#12121A] border-b border-white/[0.06] px-5 py-4">
        <h1 className="text-base font-semibold text-white">
          {step === 'payment' ? 'Verification Payment' : 'Worker Profile Setup'}
        </h1>
        <p className="text-[10px] text-[#5C5E72]">
          {step === 'payment' ? 'Pay verification fee to get your blue tick' : 'Complete your profile for verification'}
        </p>
      </header>

      {/* STEP 2: PAYMENT */}
      {step === 'payment' && (
        <div className="max-w-lg mx-auto px-5 py-8 space-y-5">
          <div className="glass rounded-2xl p-5 text-center border border-blue-500/10">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">Get Verified on WeHouse</h3>
            <p className="text-[11px] text-[#5C5E72] mb-4">Pay the one-time verification fee to get your blue tick. WeHouse will then review your profile.</p>
            <div className="rounded-xl bg-[#1A1A24] p-4 mb-4">
              <p className="text-[10px] text-[#5C5E72]">Verification Fee</p>
              <p className="text-2xl font-bold text-white">N{verificationFee.toLocaleString()}</p>
              <p className="text-[9px] text-[#5C5E72] mt-1">One-time payment · Blue tick included</p>
            </div>
            <button onClick={handlePaystackPayment} disabled={paying} className="w-full h-12 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2">
              {paying ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><path d="M1 10h22" /></svg>Pay with Paystack</>}
            </button>
            <button onClick={handleSkipPayment} disabled={paying} className="w-full mt-3 h-10 rounded-xl bg-[#1A1A24] text-[#5C5E72] text-xs font-medium hover:bg-[#2A2A3A] transition-colors">
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: FORM */}
      {step === 'form' && (
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
      )}
    </div>
  );
}

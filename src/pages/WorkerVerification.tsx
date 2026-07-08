import { useState, useRef, useEffect, useCallback } from 'react';
import type { Profile } from '@/types';
import { supabase } from '@/lib/supabase';
import { initializePaystackPopup, generatePaymentReference } from '@/lib/paystack-marketplace';
import { Toaster, toast } from 'sonner';

interface WorkerVerificationProps {
  profile: Profile;
  onBack: () => void;
}

/*
 * WORKER VERIFICATION FLOW — Constitution Part 3
 * ==============================================
 * pending → payment_success (Golden Badge) → submit_request → under_review → verified/rejected
 *
 * CRITICAL RULES (per Constitution):
 * 1. Payment amount comes from Creator Platform Settings — NOT hardcoded
 * 2. Payment happens BEFORE submission
 * 3. Golden Badge appears immediately after successful Paystack payment
 * 4. Worker must MANUALLY click "Submit Verification Request"
 * 5. Payment does NOT automatically submit the request
 * 6. Payment does NOT automatically approve the worker
 * 7. Only Creator/Admin approval makes the worker public
 */

type VerificationView =
  | 'form'        // Worker fills all required info
  | 'payment'     // Paystack payment step
  | 'submitted'   // Golden Badge + "Submit Verification Request" button
  | 'reviewing'   // Under Review — waiting for admin
  | 'rejected';   // Rejected — show reason, allow re-submit

export default function WorkerVerification({ profile, onBack }: WorkerVerificationProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const idInputRef = useRef<HTMLInputElement>(null);
  const certInputRef = useRef<HTMLInputElement>(null);

  // ── Load verification fee from Creator Platform Settings ──
  const [verificationFee, setVerificationFee] = useState<number>(0);
  const [feeLoading, setFeeLoading] = useState(true);

  useEffect(() => {
    async function loadFee() {
      setFeeLoading(true);
      const { data } = await supabase.rpc('get_setting_v2', { p_key: 'worker_verification_fee' });
      const fee = data ? parseInt(data) : 0;
      setVerificationFee(fee);
      setFeeLoading(false);
    }
    loadFee();
  }, []);

  // ── Determine initial view based on current status ──
  const getInitialView = useCallback((): VerificationView => {
    const status = profile.worker_status;
    if (status === 'profile_under_review') return 'reviewing';
    if (status === 'verified') { onBack(); return 'form'; } // Already verified, go back
    if (status === 'rejected') return 'rejected';
    if (status === 'approved_for_verification') return 'submitted'; // Paid but not submitted
    return 'form'; // pending or null
  }, [profile.worker_status, onBack]);

  const [view, setView] = useState<VerificationView>(getInitialView);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);

  // ── Form state — ALL required fields per Constitution ──
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    avatar_url: profile.avatar_url || '',
    occupation: profile.worker_occupation || '',
    skills: (profile.worker_skills || []).join(', '),
    experience: profile.worker_experience || '',
    service_area: profile.city || '',
    state: profile.state || '',
    bio: profile.worker_bio || profile.bio || '',
    price: profile.worker_price?.toString() || '',
  });

  // ── Document uploads ──
  const [govIdFile, setGovIdFile] = useState<File | null>(null);
  const [govIdUrl, setGovIdUrl] = useState('');
  const [additionalDocs, setAdditionalDocs] = useState<File | null>(null);
  const [additionalDocsUrl, setAdditionalDocsUrl] = useState('');

  // ── Video upload (2-3 minute Skill Demonstration Video) ──
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState(profile.worker_video_url || '');

  // ── Rejection state ──
  const [rejectionReason, setRejectionReason] = useState('');

  // ── Avatar upload ──
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // ── Upload avatar ──
  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Max 5MB'); return; }
    setUploadingAvatar(true);
    const path = `avatars/${profile.user_id}_${Date.now()}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file);
    if (error) { toast.error('Upload failed'); setUploadingAvatar(false); return; }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    setForm(f => ({ ...f, avatar_url: urlData.publicUrl }));
    toast.success('Profile photo uploaded');
    setUploadingAvatar(false);
  }, [profile.user_id]);

  // ── Upload Government ID ──
  const handleGovIdUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Max 10MB'); return; }
    setGovIdFile(file);
    const path = `worker_docs/${profile.user_id}/govid_${Date.now()}`;
    const { error } = await supabase.storage.from('worker_docs').upload(path, file);
    if (error) { toast.error('ID upload failed'); setGovIdFile(null); return; }
    const { data: urlData } = supabase.storage.from('worker_docs').getPublicUrl(path);
    setGovIdUrl(urlData.publicUrl);
    toast.success('Government ID uploaded');
  }, [profile.user_id]);

  // ── Upload Additional Documents ──
  const handleAdditionalDocsUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Max 10MB'); return; }
    setAdditionalDocs(file);
    const path = `worker_docs/${profile.user_id}/cert_${Date.now()}`;
    const { error } = await supabase.storage.from('worker_docs').upload(path, file);
    if (error) { toast.error('Document upload failed'); setAdditionalDocs(null); return; }
    const { data: urlData } = supabase.storage.from('worker_docs').getPublicUrl(path);
    setAdditionalDocsUrl(urlData.publicUrl);
    toast.success('Additional document uploaded');
  }, [profile.user_id]);

  // ── Upload Skill Demonstration Video ──
  const handleVideoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { toast.error('Max 100MB for video'); return; }
    setVideoFile(file);
    const path = `worker_videos/${profile.user_id}/skill_demo_${Date.now()}`;
    const { error } = await supabase.storage.from('worker_docs').upload(path, file);
    if (error) { toast.error('Video upload failed'); setVideoFile(null); return; }
    const { data: urlData } = supabase.storage.from('worker_docs').getPublicUrl(path);
    setVideoUrl(urlData.publicUrl);
    toast.success('Skill demonstration video uploaded');
  }, [profile.user_id]);

  // ── Validate form ──
  function validateForm(): boolean {
    if (!form.full_name.trim()) { toast.error('Full Name is required'); return false; }
    if (!form.avatar_url) { toast.error('Profile Photo is required'); return false; }
    if (!form.occupation) { toast.error('Occupation is required'); return false; }
    if (!form.skills.trim()) { toast.error('Skills are required'); return false; }
    if (!form.experience) { toast.error('Experience is required'); return false; }
    if (!form.service_area) { toast.error('Service Area (City) is required'); return false; }
    if (!form.state) { toast.error('State is required'); return false; }
    if (!govIdUrl && !govIdFile) { toast.error('Government ID is required'); return false; }
    if (!videoUrl && !videoFile) { toast.error('2-3 minute Skill Demonstration Video is required'); return false; }
    return true;
  }

  // ── Save all worker info ──
  async function saveWorkerInfo() {
    if (!validateForm()) return;
    setSubmitting(true);

    const { error } = await supabase.from('profiles').update({
      full_name: form.full_name.trim(),
      avatar_url: form.avatar_url,
      worker_occupation: form.occupation,
      worker_skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
      worker_experience: form.experience,
      city: form.service_area,
      state: form.state,
      worker_bio: form.bio.trim(),
      worker_price: form.price ? parseFloat(form.price) : null,
      worker_video_url: videoUrl,
      // Save government ID reference
      worker_gov_id_url: govIdUrl,
      // Save additional docs reference
      worker_cert_url: additionalDocsUrl,
    }).eq('user_id', profile.user_id);

    setSubmitting(false);
    if (error) { toast.error('Failed to save: ' + error.message); return; }

    toast.success('Profile information saved');
    setView('payment');
  }

  // ── Handle Paystack Payment ──
  async function handlePaystackPayment() {
    if (verificationFee <= 0) {
      toast.error('Verification fee not configured. Contact WeHouse support.');
      return;
    }

    setPaying(true);
    const reference = generatePaymentReference();

    // Get Paystack public key from settings
    const { data: pk } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_public_key' });
    if (!pk) {
      toast.error('Payment system not configured. Contact support.');
      setPaying(false);
      return;
    }

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
        // CRITICAL: Payment successful → Golden Badge appears
        // Status = 'approved_for_verification' (payment done, NOT approved yet)
        // worker_verified stays FALSE — only admin can set to TRUE
        const { error: updateError } = await supabase.from('profiles').update({
          worker_status: 'approved_for_verification',
          worker_verified: false, // NOT verified yet — admin must approve
          updated_at: new Date().toISOString(),
        }).eq('user_id', profile.user_id);

        if (updateError) {
          toast.error('Payment confirmed but status update failed. Contact support.');
          setPaying(false);
          return;
        }

        // Record the payment
        try {
          await supabase.rpc('record_worker_verification_payment', {
            p_user_id: profile.user_id,
            p_reference: ref,
            p_amount: verificationFee,
          });
        } catch (_) { /* non-critical */ }

        toast.success('Payment successful! Your Golden Verification Badge is now active.');
        setView('submitted'); // Show Golden Badge + Submit button
        setPaying(false);
      },
      onCancel: () => {
        toast.info('Payment cancelled. You can retry when ready.');
        setPaying(false);
      },
    });
  }

  // ── Submit Verification Request (MANUAL — per Constitution) ──
  async function handleSubmitVerificationRequest() {
    setSubmitting(true);

    const { error } = await supabase.from('profiles').update({
      worker_status: 'profile_under_review',
      updated_at: new Date().toISOString(),
    }).eq('user_id', profile.user_id);

    if (error) {
      toast.error('Failed to submit: ' + error.message);
      setSubmitting(false);
      return;
    }

    // Notify creator/admin — find creator dynamically, don't hardcode ID
    try {
      const { data: creator } = await supabase.from('profiles')
        .select('user_id')
        .eq('role', 'creator')
        .limit(1)
        .single();
      if (creator?.user_id) {
        await supabase.from('notifications').insert({
          user_id: creator.user_id,
          type: 'verification_issue',
          title: 'Worker Verification Submitted',
          body: `${form.full_name || profile.username} has submitted their verification request for review.`,
          is_read: false,
        });
      }
    } catch (_) { /* non-critical */ }

    setSubmitting(false);
    toast.success('Verification request submitted! WeHouse will review your application.');
    setView('reviewing');
  }

  // ── Handle re-submit after rejection ──
  async function handleResubmit() {
    setSubmitting(true);
    const { error } = await supabase.from('profiles').update({
      worker_status: 'approved_for_verification', // Back to paid state
      updated_at: new Date().toISOString(),
    }).eq('user_id', profile.user_id);
    setSubmitting(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('You can now re-submit your verification request.');
    setView('submitted');
  }

  // ── Load rejection reason ──
  useEffect(() => {
    if (view === 'rejected') {
      (async () => {
        try {
          const { data } = await supabase.from('worker_verification_reviews')
            .select('rejection_reason')
            .eq('worker_id', profile.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (data?.rejection_reason) setRejectionReason(data.rejection_reason);
        } catch (_) { /* ignore */ }
      })();
    }
  }, [view, profile.user_id]);

  const initials = (form.full_name || profile.username || 'W')[0].toUpperCase();

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-[#1A1A24] flex items-center justify-center text-white hover:bg-[#2A2A3A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">Worker Verification</h1>
            <p className="text-[10px] text-[#5C5E72]">
              {view === 'form' && 'Complete all required information'}
              {view === 'payment' && 'Pay verification fee'}
              {view === 'submitted' && 'Golden Badge active — Submit your request'}
              {view === 'reviewing' && 'Under Review — WeHouse is reviewing your application'}
              {view === 'rejected' && 'Rejected — Review feedback and re-submit'}
            </p>
          </div>
        </div>
      </header>

      <div className="px-4 py-6 space-y-5 max-w-lg mx-auto">

        {/* ═══════════════════════════════════════════════════
            VIEW: FORM — All required information
            ═══════════════════════════════════════════════════ */}
        {view === 'form' && (
          <>
            {/* Info Banner */}
            <div className="rounded-2xl p-4 border border-amber-500/20 bg-amber-500/5">
              <p className="text-xs text-amber-400 font-semibold mb-1">Verification Required</p>
              <p className="text-[10px] text-[#5C5E72] leading-relaxed">
                Complete all fields below, upload your documents and skill video, then proceed to payment.
                After payment, your Golden Badge will appear. You must then click &quot;Submit Verification Request&quot;
                to send your application to WeHouse for review.
              </p>
            </div>

            {/* ── Profile Photo ── */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-white text-2xl font-bold overflow-hidden disabled:opacity-60 active:scale-95 transition-all shadow-lg shadow-amber-500/20"
              >
                {uploadingAvatar ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : form.avatar_url ? (
                  <img src={form.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  initials
                )}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                </div>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              <p className="text-[10px] text-[#5C5E72]">Tap to upload Profile Photo *</p>
            </div>

            {/* ── Full Name ── */}
            <div>
              <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">Full Name *</label>
              <input
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full legal name"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-amber-500/50 outline-none"
              />
            </div>

            {/* ── Occupation ── */}
            <div>
              <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">Occupation *</label>
              <select
                value={form.occupation}
                onChange={e => setForm(f => ({ ...f, occupation: e.target.value }))}
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-amber-500/50 appearance-none"
              >
                <option value="">Select your occupation</option>
                <option value="electrician">Electrician</option>
                <option value="plumber">Plumber</option>
                <option value="carpenter">Carpenter</option>
                <option value="cleaner">Cleaner</option>
                <option value="painter">Painter</option>
                <option value="mechanic">Mechanic</option>
                <option value="gardener">Gardener / Landscaper</option>
                <option value="hvac">HVAC Technician</option>
                <option value="welder">Welder</option>
                <option value="tiler">Tiler</option>
                <option value="pop_ceiling">POP Ceiling Installer</option>
                <option value="security">Security Guard</option>
                <option value="driver">Driver</option>
                <option value="chef">Chef / Cook</option>
                <option value="laundry">Laundry Service</option>
                <option value="photographer">Photographer</option>
                <option value="hairdresser">Hairdresser / Barber</option>
                <option value="makeup">Makeup Artist</option>
                <option value="interior">Interior Designer</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* ── Skills ── */}
            <div>
              <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">Skills * (comma separated)</label>
              <input
                value={form.skills}
                onChange={e => setForm(f => ({ ...f, skills: e.target.value }))}
                placeholder="e.g. House Wiring, Circuit Installation, Generator Repair"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-amber-500/50 outline-none"
              />
              <p className="text-[9px] text-[#5C5E72] mt-1">List all skills relevant to your occupation</p>
            </div>

            {/* ── Experience ── */}
            <div>
              <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">Years of Experience *</label>
              <select
                value={form.experience}
                onChange={e => setForm(f => ({ ...f, experience: e.target.value }))}
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 outline-none focus:border-amber-500/50 appearance-none"
              >
                <option value="">Select experience</option>
                <option value="Less than 1 year">Less than 1 year</option>
                <option value="1-2 years">1-2 years</option>
                <option value="3-5 years">3-5 years</option>
                <option value="5-10 years">5-10 years</option>
                <option value="10+ years">10+ years</option>
              </select>
            </div>

            {/* ── Service Area (City + State) ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">Service City *</label>
                <input
                  value={form.service_area}
                  onChange={e => setForm(f => ({ ...f, service_area: e.target.value }))}
                  placeholder="e.g. Ikeja"
                  className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-amber-500/50 outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">State *</label>
                <input
                  value={form.state}
                  onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                  placeholder="e.g. Lagos"
                  className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-amber-500/50 outline-none"
                />
              </div>
            </div>

            {/* ── Service Price ── */}
            <div>
              <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">Starting Price (NGN)</label>
              <input
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="e.g. 5000 (per job or per hour)"
                className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 placeholder-[#5C5E72] focus:border-amber-500/50 outline-none"
              />
            </div>

            {/* ── Bio ── */}
            <div>
              <label className="text-[10px] text-[#8A8B9C] font-medium mb-1.5 block">About Your Services</label>
              <textarea
                value={form.bio}
                onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                placeholder="Describe your experience, the services you offer, and what makes you reliable..."
                rows={4}
                className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 py-3 placeholder-[#5C5E72] focus:border-amber-500/50 outline-none resize-none"
              />
            </div>

            {/* ── Government ID Upload ── */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
              <div>
                <label className="text-xs text-white font-semibold mb-1 block">Government ID *</label>
                <p className="text-[10px] text-[#5C5E72]">
                  Upload a valid government-issued ID: National ID (NIN), Driver&apos;s License,
                  International Passport, or Voter&apos;s Card. This is for identity verification only.
                </p>
              </div>
              <input
                ref={idInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleGovIdUpload}
              />
              <button
                onClick={() => idInputRef.current?.click()}
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs font-medium flex items-center justify-center gap-2 hover:border-amber-500/30 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
                {govIdUrl ? 'Replace Government ID' : 'Upload Government ID'}
              </button>
              {govIdUrl && (
                <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                  Government ID uploaded
                </p>
              )}
            </div>

            {/* ── Additional Documents (optional) ── */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
              <div>
                <label className="text-xs text-white font-semibold mb-1 block">Additional Documents (Optional)</label>
                <p className="text-[10px] text-[#5C5E72]">
                  Professional certificates, trade licenses, or any other supporting documents.
                </p>
              </div>
              <input
                ref={certInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleAdditionalDocsUpload}
              />
              <button
                onClick={() => certInputRef.current?.click()}
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs font-medium flex items-center justify-center gap-2 hover:border-amber-500/30 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
                {additionalDocsUrl ? 'Replace Document' : 'Upload Additional Document'}
              </button>
              {additionalDocsUrl && (
                <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                  Additional document uploaded
                </p>
              )}
            </div>

            {/* ── 2-3 Minute Skill Demonstration Video ── */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
              <div>
                <label className="text-xs text-white font-semibold mb-1 block">2–3 Minute Skill Demonstration Video *</label>
                <p className="text-[10px] text-[#5C5E72] leading-relaxed">
                  Record a video demonstrating your professional skills. This video is ONLY for
                  evaluating your ability — NOT for identity verification.
                </p>
                <p className="text-[9px] text-amber-400 mt-1">
                  Examples: Electrician shows wiring work. Plumber shows pipe fitting.
                  Carpenter shows woodwork. Cleaner shows cleaning technique.
                </p>
              </div>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleVideoUpload}
              />
              <button
                onClick={() => videoInputRef.current?.click()}
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs font-medium flex items-center justify-center gap-2 hover:border-amber-500/30 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                {videoUrl ? 'Replace Video' : 'Upload Skill Demo Video'}
              </button>
              {videoUrl && (
                <div className="space-y-2">
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                    Video uploaded successfully
                  </p>
                  <video src={videoUrl} controls className="w-full rounded-xl max-h-48 object-cover" />
                </div>
              )}
            </div>

            {/* ── Proceed to Payment ── */}
            <button
              onClick={saveWorkerInfo}
              disabled={submitting}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 shadow-lg shadow-amber-500/20"
            >
              {submitting ? 'Saving...' : 'Proceed to Payment'}
            </button>
          </>
        )}

        {/* ═══════════════════════════════════════════════════
            VIEW: PAYMENT — Paystack payment
            ═══════════════════════════════════════════════════ */}
        {view === 'payment' && (
          <>
            <div className="rounded-2xl p-4 border border-emerald-500/20 bg-emerald-500/5">
              <p className="text-xs text-emerald-400 font-semibold mb-1">Verification Payment</p>
              <p className="text-[10px] text-[#5C5E72] leading-relaxed">
                Pay the verification fee via Paystack. This is a one-time payment.
                The amount is set by WeHouse and is non-refundable.
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-700/20 flex items-center justify-center mx-auto mb-3">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              </div>
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wider">Verification Fee</p>
              {feeLoading ? (
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mt-2" />
              ) : (
                <p className="text-3xl font-bold text-white mt-1">N{verificationFee.toLocaleString()}</p>
              )}
              <p className="text-[10px] text-[#5C5E72] mt-1">One-time payment &bull; Non-refundable</p>
              <p className="text-[9px] text-amber-400 mt-2">Amount set by Creator in Platform Settings</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setView('form')}
                className="flex-1 h-11 rounded-xl bg-[#1A1A24] text-white text-sm font-semibold hover:bg-[#2A2A3A] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handlePaystackPayment}
                disabled={paying || feeLoading || verificationFee <= 0}
                className="flex-1 h-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
              >
                {paying ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><path d="M1 10h22" /></svg>
                    Pay with Paystack
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════
            VIEW: SUBMITTED — Golden Badge + Manual Submit
            ═══════════════════════════════════════════════════ */}
        {view === 'submitted' && (
          <>
            {/* Golden Verification Badge */}
            <div className="rounded-2xl p-6 border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-amber-700/5 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-amber-500/30">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              </div>
              <h2 className="text-lg font-bold text-amber-400">Golden Verification Badge</h2>
              <p className="text-[11px] text-[#5C5E72] mt-1">Payment completed successfully</p>
              <p className="text-[9px] text-amber-400/60 mt-2">This badge only confirms payment. It does NOT mean you are approved.</p>
            </div>

            {/* Important Instructions */}
            <div className="rounded-2xl p-4 border border-blue-500/10 bg-blue-500/5">
              <p className="text-xs text-blue-400 font-semibold mb-2">What happens next?</p>
              <ol className="text-[10px] text-[#5C5E72] space-y-1.5 list-decimal list-inside">
                <li>Click <strong className="text-white">Submit Verification Request</strong> below</li>
                <li>WeHouse will review your profile, ID, documents, and skill video</li>
                <li>You will be notified when the review is complete</li>
                <li>If approved, your profile becomes public and customers can hire you</li>
              </ol>
            </div>

            {/* Summary of what will be submitted */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
              <p className="text-xs font-semibold text-white">Review Your Submission</p>
              <InfoRow label="Name" value={form.full_name || profile.full_name || 'Not set'} />
              <InfoRow label="Occupation" value={form.occupation || profile.worker_occupation || 'Not set'} />
              <InfoRow label="Skills" value={form.skills || (profile.worker_skills || []).join(', ') || 'Not set'} />
              <InfoRow label="Experience" value={form.experience || 'Not set'} />
              <InfoRow label="Service Area" value={`${form.service_area || profile.city || ''}, ${form.state || profile.state || ''}`} />
              <InfoRow label="Government ID" value={govIdUrl ? 'Uploaded' : 'Not uploaded'} check={!!govIdUrl} />
              <InfoRow label="Skill Demo Video" value={videoUrl ? 'Uploaded' : 'Not uploaded'} check={!!videoUrl} />
            </div>

            {/* CRITICAL: Submit Verification Request button (MANUAL) */}
            <button
              onClick={handleSubmitVerificationRequest}
              disabled={submitting}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
                  Submit Verification Request
                </>
              )}
            </button>

            <p className="text-[9px] text-[#5C5E72] text-center">
              You can edit your information before submitting. Once submitted, you cannot make changes until the review is complete.
            </p>
          </>
        )}

        {/* ═══════════════════════════════════════════════════
            VIEW: REVIEWING — Under Review
            ═══════════════════════════════════════════════════ */}
        {view === 'reviewing' && (
          <>
            {/* Golden Badge + Under Review Status */}
            <div className="rounded-2xl p-6 border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-violet-700/5 text-center">
              <div className="relative w-16 h-16 mx-auto mb-3">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center border-2 border-[#0A0A0F]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M12 8v4M12 16h.01" /></svg>
                </div>
              </div>
              <h2 className="text-lg font-bold text-white">Under Review</h2>
              <p className="text-[11px] text-[#5C5E72] mt-1">
                Your verification request has been submitted to WeHouse.
              </p>
              <span className="inline-block mt-3 text-[9px] font-bold px-3 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                Golden Badge Active &bull; Under Review
              </span>
            </div>

            {/* What's being reviewed */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
              <p className="text-xs font-semibold text-white">WeHouse is reviewing:</p>
              <ReviewItem icon="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" label="Worker Profile" />
              <ReviewItem icon="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" label="Government ID" />
              <ReviewItem icon="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" label="Uploaded Documents" />
              <ReviewItem icon="M23 7l-7 5 7 5V7z" label="2-3 Minute Skill Demonstration Video" />
            </div>

            {/* Timeline */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
              <p className="text-xs font-semibold text-white mb-3">Your Progress</p>
              <div className="space-y-3">
                <TimelineStep done label="Profile Completed" />
                <TimelineStep done label="Payment Successful" />
                <TimelineStep done label="Verification Request Submitted" />
                <TimelineStep active label="Under Review by WeHouse" />
                <TimelineStep pending label="Approval Decision" />
              </div>
            </div>

            <p className="text-[10px] text-[#5C5E72] text-center">
              Review typically takes 2-3 business days. You will be notified once the review is complete.
            </p>

            <button
              onClick={onBack}
              className="w-full h-10 rounded-xl bg-[#1A1A24] text-white text-xs font-semibold hover:bg-[#2A2A3A] transition-colors"
            >
              Back to Dashboard
            </button>
          </>
        )}

        {/* ═══════════════════════════════════════════════════
            VIEW: REJECTED — Show reason, allow re-submit
            ═══════════════════════════════════════════════════ */}
        {view === 'rejected' && (
          <>
            <div className="rounded-2xl p-6 border border-red-500/20 bg-red-500/5 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
              </div>
              <h2 className="text-lg font-bold text-red-400">Verification Rejected</h2>
              <p className="text-[11px] text-[#5C5E72] mt-1">
                Your verification request was not approved. Review the feedback below.
              </p>
            </div>

            {/* Rejection Reason */}
            {rejectionReason && (
              <div className="rounded-2xl bg-red-500/5 border border-red-500/10 p-4">
                <p className="text-[10px] text-red-400 font-medium mb-1">Rejection Reason</p>
                <p className="text-xs text-white">{rejectionReason}</p>
              </div>
            )}

            {/* Instructions */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
              <p className="text-xs font-semibold text-white mb-2">What to do next</p>
              <ol className="text-[10px] text-[#5C5E72] space-y-1.5 list-decimal list-inside">
                <li>Review the rejection reason above</li>
                <li>Edit the requested information by clicking below</li>
                <li>Re-submit your verification request</li>
              </ol>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setView('form')}
                className="flex-1 h-11 rounded-xl bg-[#1A1A24] text-white text-sm font-semibold hover:bg-[#2A2A3A] transition-colors"
              >
                Edit Information
              </button>
              <button
                onClick={handleResubmit}
                disabled={submitting}
                className="flex-1 h-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {submitting ? 'Processing...' : 'Re-Submit Request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared Components ──

function InfoRow({ label, value, check }: { label: string; value: string; check?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-[#5C5E72]">{label}</span>
      <span className={`text-[10px] font-medium ${check === true ? 'text-emerald-400' : check === false ? 'text-red-400' : 'text-white'}`}>
        {check === true && '✓ '}{value}
      </span>
    </div>
  );
}

function ReviewItem({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
      <span className="text-[10px] text-[#5C5E72]">{label}</span>
    </div>
  );
}

function TimelineStep({ done, active, pending, label }: { done?: boolean; active?: boolean; pending?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
        done ? 'bg-emerald-500' : active ? 'bg-violet-500' : 'bg-[#1A1A24] border border-[#2A2A3A]'
      }`}>
        {done && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>}
        {active && <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
      </div>
      <span className={`text-[10px] ${done ? 'text-emerald-400' : active ? 'text-violet-400' : 'text-[#5C5E72]'}`}>{label}</span>
    </div>
  );
}

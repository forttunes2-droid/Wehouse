import { useState } from 'react';
import type { Profile } from '@/types';
import { supabase } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';

interface WorkerVerificationProps {
  profile: Profile;
  onBack: () => void;
}

const STEPS = [
  { id: 'info', label: 'Basic Info' },
  { id: 'documents', label: 'Documents' },
  { id: 'video', label: 'Video Intro' },
  { id: 'payment', label: 'Payment' },
];

export default function WorkerVerification({ profile, onBack }: WorkerVerificationProps) {
  const [step, setStep] = useState(0);
  const [occupation, setOccupation] = useState(profile.worker_occupation || '');
  const [skills, setSkills] = useState(profile.worker_skills?.join(', ') || '');
  const [price, setPrice] = useState(profile.worker_price?.toString() || '');
  const [bio, setBio] = useState('');
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [certificate, setCertificate] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmitInfo = async () => {
    if (!occupation || !price) { toast.error('Occupation and price are required'); return; }
    setLoading(true);
    const { error } = await supabase.from('profiles').update({
      worker_occupation: occupation,
      worker_skills: skills.split(',').map(s => s.trim()).filter(Boolean),
      worker_price: parseFloat(price),
      bio: bio ? `🛠️STATUS:pending🛠️ ${bio}` : profile.bio,
    }).eq('user_id', profile.user_id);
    setLoading(false);
    if (error) { toast.error('Failed to save'); return; }
    toast.success('Info saved');
    setStep(1);
  };

  const handleSubmitDocuments = async () => {
    if (!idDocument) { toast.error('ID document is required'); return; }
    setLoading(true);
    // Upload ID document
    const idPath = `worker_verification/${profile.user_id}/id_${Date.now()}`;
    const { error: idErr } = await supabase.storage.from('worker_docs').upload(idPath, idDocument);
    if (idErr) { toast.error('Failed to upload ID'); setLoading(false); return; }

    // Upload certificate if provided
    let certPath = null;
    if (certificate) {
      certPath = `worker_verification/${profile.user_id}/cert_${Date.now()}`;
      await supabase.storage.from('worker_docs').upload(certPath, certificate);
    }

    // Save document references
    await supabase.from('worker_verification_docs').upsert({
      user_id: profile.user_id,
      id_document_url: idPath,
      certificate_url: certPath,
      status: 'pending',
    });

    setLoading(false);
    toast.success('Documents uploaded');
    setStep(2);
  };

  const handleSubmitVideo = async () => {
    setLoading(true);
    await supabase.from('profiles').update({
      worker_video_url: videoUrl || null,
    }).eq('user_id', profile.user_id);
    setLoading(false);
    toast.success('Video saved');
    setStep(3);
  };

  const handlePayment = async () => {
    setLoading(true);
    // In real implementation, this would call Paystack
    // For now, simulate payment success
    await supabase.from('profiles').update({
      worker_status: 'verification_paid',
      worker_verified: true,
      bio: profile.bio?.replace('🛠️STATUS:pending🛠️', '🛠️STATUS:verification_paid🛠️') || '🛠️STATUS:verification_paid🛠️',
    }).eq('user_id', profile.user_id);

    // Create notification for creator/admin
    await supabase.from('notifications').insert({
      user_id: 'WHU-0001', // creator
      type: 'verification_issue',
      title: 'Worker Verification Submitted',
      body: `${profile.username || profile.full_name} has completed verification and payment. Review required.`,
      is_read: false,
    });

    setLoading(false);
    toast.success('Payment confirmed! Golden tick activated. Awaiting WeHouse review.');
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-nav overflow-y-auto scrollable-content">
      <Toaster position="top-center" richColors theme="dark" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0A0A0F]/95 backdrop-blur-md border-b border-white/[0.04] px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-[#1A1A24] flex items-center justify-center text-white hover:bg-[#2A2A3A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">Worker Verification</h1>
            <p className="text-[10px] text-[#5C5E72]">Complete to get verified and go public</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 mt-3">
          {STEPS.map((s, i) => (
            <button key={s.id} onClick={() => i < step && setStep(i)} className="flex-1 h-1.5 rounded-full transition-colors" style={{
              background: i <= step ? '#3B82F6' : '#1A1A24',
            }} />
          ))}
        </div>
        <p className="text-[10px] text-[#5C5E72] mt-1">Step {step + 1} of {STEPS.length}: {STEPS[step].label}</p>
      </header>

      <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
        {/* Step 1: Basic Info */}
        {step === 0 && (
          <>
            <div className="glass rounded-2xl p-4 border border-[#3B82F6]/20 bg-[#3B82F6]/5">
              <p className="text-xs text-white font-semibold mb-1">Why verify?</p>
              <p className="text-[10px] text-[#5C5E72]">Verified workers get a golden tick, appear in search results, and can receive bookings. Verification takes 2-3 business days after payment.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Occupation / Primary Service *</label>
                <input value={occupation} onChange={e => setOccupation(e.target.value)} placeholder="e.g. Electrician, Cleaner, Driver"
                  className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Skills (comma separated)</label>
                <input value={skills} onChange={e => setSkills(e.target.value)} placeholder="e.g. Plumbing, Wiring, Repairs"
                  className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">Service Price (N) *</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="5000"
                  className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-[#5C5E72] mb-1 block">About You / Bio</label>
                <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4} placeholder="Tell customers about your experience..."
                  className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 py-2 placeholder-[#3A3A4A] focus:border-[#3B82F6]/50 outline-none resize-none" />
              </div>
            </div>

            <button onClick={handleSubmitInfo} disabled={loading}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
              {loading ? 'Saving...' : 'Continue to Documents'}
            </button>
          </>
        )}

        {/* Step 2: Documents */}
        {step === 1 && (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-white font-semibold mb-2 block">Government ID *</label>
                <p className="text-[10px] text-[#5C5E72] mb-2">Upload a valid government-issued ID (National ID, Driver's License, Passport, Voter's Card)</p>
                <input type="file" accept="image/*,.pdf" onChange={e => setIdDocument(e.target.files?.[0] || null)}
                  className="w-full text-xs text-[#5C5E72] file:mr-3 file:h-9 file:rounded-lg file:bg-[#1A1A24] file:border file:border-[#2A2A3A] file:text-white file:text-xs file:px-3" />
                {idDocument && <p className="text-[10px] text-emerald-400 mt-1">✓ {idDocument.name}</p>}
              </div>

              <div>
                <label className="text-xs text-white font-semibold mb-2 block">Professional Certificate (optional)</label>
                <p className="text-[10px] text-[#5C5E72] mb-2">Upload any professional certification you have</p>
                <input type="file" accept="image/*,.pdf" onChange={e => setCertificate(e.target.files?.[0] || null)}
                  className="w-full text-xs text-[#5C5E72] file:mr-3 file:h-9 file:rounded-lg file:bg-[#1A1A24] file:border file:border-[#2A2A3A] file:text-white file:text-xs file:px-3" />
                {certificate && <p className="text-[10px] text-emerald-400 mt-1">✓ {certificate.name}</p>}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(0)} className="flex-1 h-11 rounded-xl bg-[#1A1A24] text-white text-sm font-semibold hover:bg-[#2A2A3A] transition-colors">Back</button>
              <button onClick={handleSubmitDocuments} disabled={loading}
                className="flex-1 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                {loading ? 'Uploading...' : 'Continue to Video'}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Video Intro */}
        {step === 2 && (
          <>
            <div className="glass rounded-2xl p-4 border border-amber-500/20 bg-amber-500/5">
              <p className="text-xs text-amber-400 font-semibold mb-1">Video Introduction Required</p>
              <p className="text-[10px] text-[#5C5E72]">Record a short video (30-60 seconds) introducing yourself, your skills, and your experience. Upload to YouTube, Google Drive, or any cloud storage and paste the link.</p>
            </div>

            <div>
              <label className="text-[10px] text-[#5C5E72] mb-1 block">Video URL</label>
              <input type="url" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..."
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 focus:border-[#3B82F6]/50 outline-none" />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 h-11 rounded-xl bg-[#1A1A24] text-white text-sm font-semibold hover:bg-[#2A2A3A] transition-colors">Back</button>
              <button onClick={handleSubmitVideo} disabled={loading}
                className="flex-1 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                {loading ? 'Saving...' : 'Continue to Payment'}
              </button>
            </div>
          </>
        )}

        {/* Step 4: Payment */}
        {step === 3 && (
          <>
            <div className="glass rounded-2xl p-4 border border-emerald-500/20 bg-emerald-500/5">
              <p className="text-xs text-emerald-400 font-semibold mb-1">Almost Done!</p>
              <p className="text-[10px] text-[#5C5E72]">Pay the verification fee to activate your golden tick. After payment, WeHouse will review your application within 2-3 business days.</p>
            </div>

            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-[10px] text-[#5C5E72] uppercase tracking-wide">Verification Fee</p>
              <p className="text-3xl font-bold text-white mt-1">₦3,000</p>
              <p className="text-[10px] text-[#5C5E72] mt-1">One-time fee • Non-refundable</p>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 h-11 rounded-xl bg-[#1A1A24] text-white text-sm font-semibold hover:bg-[#2A2A3A] transition-colors">Back</button>
              <button onClick={handlePayment} disabled={loading}
                className="flex-1 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2">
                {loading ? 'Processing...' : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                    Pay with Paystack
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

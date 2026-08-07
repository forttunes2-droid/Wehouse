import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '@/types';
import { supabase, uploadAvatar } from '@/lib/supabase';
import { initializePaystackPopup } from '@/lib/supabase/paystack';
import { Toaster, toast } from 'sonner';

interface WorkerVerificationProps {
  profile: Profile;
  onBack: () => void;
}

type Step = 'form' | 'payment' | 'ready' | 'reviewing' | 'rejected';

export default function WorkerVerification({ profile, onBack }: WorkerVerificationProps) {
  const avatarInput = useRef<HTMLInputElement>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const certificateInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const initialStep: Step = profile.worker_status === 'profile_under_review'
    ? 'reviewing'
    : profile.worker_status === 'verification_paid'
      ? 'ready'
      : profile.worker_status === 'rejected'
        ? 'rejected'
        : 'form';

  const [step, setStep] = useState<Step>(initialStep);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [fee, setFee] = useState(0);
  const [avatar, setAvatar] = useState(profile.avatar_url || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [form, setForm] = useState({
    fullName: profile.full_name || '',
    occupation: profile.worker_occupation || '',
    skills: (profile.worker_skills || []).join(', '),
    experience: profile.worker_experience || '',
    serviceState: '',
    serviceLga: '',
    serviceAreas: '',
    bio: profile.worker_bio || '',
    price: profile.worker_price ? String(profile.worker_price) : '',
  });

  const [govIdPath, setGovIdPath] = useState('');
  const [certificatePath, setCertificatePath] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [videoPreview, setVideoPreview] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    supabase.rpc('get_setting_v2', { p_key: 'worker_verification_fee' })
      .then(({ data }) => setFee(data ? Number(data) : 0));

    supabase.from('worker_service_coverage')
      .select('state,lga,areas')
      .eq('worker_id', profile.user_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setForm((current) => ({
          ...current,
          serviceState: data.state || '',
          serviceLga: data.lga || '',
          serviceAreas: Array.isArray(data.areas) ? data.areas.join(', ') : '',
        }));
      });

    if (profile.worker_status === 'rejected') {
      supabase.from('worker_verification_reviews')
        .select('rejection_reason')
        .eq('worker_id', profile.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => setRejectionReason(data?.rejection_reason || ''));
    }
  }, [profile.user_id, profile.worker_status]);

  useEffect(() => () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
  }, [videoPreview]);

  const initials = useMemo(() => (form.fullName || profile.username || 'W')[0].toUpperCase(), [form.fullName, profile.username]);

  async function uploadPrivate(file: File, kind: 'gov-id' | 'certificate' | 'skill-video') {
    const extension = file.name.split('.').pop() || 'bin';
    const path = `${profile.user_id}/${kind}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from('worker-files').upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function changeAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setUploadingAvatar(false);
    if (error || !url) return toast.error(error?.message || 'Profile photo upload failed');
    setAvatar(url);
    toast.success('Profile photo uploaded');
  }

  async function changeGovId(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('Government ID must be under 10MB');
    try {
      setGovIdPath(await uploadPrivate(file, 'gov-id'));
      toast.success('Government ID uploaded securely');
    } catch (error: any) { toast.error(error.message || 'ID upload failed'); }
  }

  async function changeCertificate(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error('Certificate must be under 10MB');
    try {
      setCertificatePath(await uploadPrivate(file, 'certificate'));
      toast.success('Certificate uploaded securely');
    } catch (error: any) { toast.error(error.message || 'Certificate upload failed'); }
  }

  async function changeVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) return toast.error('Skill video must be under 100MB');
    try {
      const path = await uploadPrivate(file, 'skill-video');
      setVideoPath(path);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoPreview(URL.createObjectURL(file));
      toast.success('Skill video uploaded securely');
    } catch (error: any) { toast.error(error.message || 'Video upload failed'); }
  }

  function validate() {
    if (!form.fullName.trim()) return 'Full name is required';
    if (!avatar) return 'Profile photo is required';
    if (!form.occupation.trim()) return 'Occupation is required';
    if (!form.skills.trim()) return 'At least one skill is required';
    if (!form.experience.trim()) return 'Experience is required';
    if (!form.serviceState.trim() || !form.serviceLga.trim()) return 'Service State and LGA are required';
    if (!govIdPath) return 'Government ID is required';
    if (!videoPath) return 'Skill demonstration video is required';
    return null;
  }

  async function saveVerification() {
    const message = validate();
    if (message) return toast.error(message);
    setSaving(true);
    const { error } = await supabase.rpc('save_my_worker_verification', {
      p_full_name: form.fullName.trim(),
      p_avatar_url: avatar,
      p_occupation: form.occupation.trim(),
      p_skills: form.skills.split(',').map((item) => item.trim()).filter(Boolean),
      p_experience: form.experience.trim(),
      p_service_state: form.serviceState.trim(),
      p_service_lga: form.serviceLga.trim(),
      p_service_areas: form.serviceAreas.split(',').map((item) => item.trim()).filter(Boolean),
      p_bio: form.bio.trim(),
      p_price: form.price ? Math.max(0, Number(form.price)) : 0,
      p_gov_id_path: govIdPath,
      p_certificate_path: certificatePath,
      p_video_path: videoPath,
    });
    setSaving(false);
    if (error) return toast.error(error.message || 'Could not save verification information');
    toast.success('Verification information saved');
    setStep('payment');
  }

  async function pay() {
    if (fee <= 0) return toast.error('Verification fee is not configured');
    setPaying(true);
    const { data: bootstrap, error: bootstrapError } = await supabase.rpc('create_worker_verification_payment');
    if (bootstrapError || !bootstrap?.success) {
      setPaying(false);
      return toast.error(bootstrap?.error || bootstrapError?.message || 'Payment initialization failed');
    }
    const { data: publicKey } = await supabase.rpc('get_setting_v2', { p_key: 'paystack_public_key' });
    if (!publicKey) {
      setPaying(false);
      return toast.error('Payment system is not configured');
    }

    initializePaystackPopup({
      publicKey,
      email: profile.email,
      amountKobo: bootstrap.amount * 100,
      reference: bootstrap.reference,
      metadata: { payment_type: 'worker_verification', worker_id: profile.user_id },
      onSuccess: () => {
        setPaying(false);
        setStep('ready');
        toast.success('Payment confirmed. Submit your verification request.');
      },
      onCancel: () => {
        setPaying(false);
        toast.info('Payment cancelled');
      },
    });
  }

  async function submit() {
    setSaving(true);
    const { error } = await supabase.rpc('submit_my_worker_verification');
    setSaving(false);
    if (error) return toast.error(error.message || 'Submission failed');
    setStep('reviewing');
    toast.success('Verification submitted for review');
  }

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F] pb-24 text-white">
      <Toaster position="top-center" richColors theme="dark" />
      <header className="sticky top-0 z-30 bg-[#0A0A0F]/95 backdrop-blur border-b border-white/[0.05] px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-[#1A1A24] flex items-center justify-center" aria-label="Back">←</button>
        <div><h1 className="text-lg font-bold">Worker Verification</h1><p className="text-[10px] text-[#5C5E72]">Professional details and private verification evidence</p></div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {step === 'form' && (
          <>
            <Notice title="Private verification" text="Government ID, certificates and review video are stored privately. They are not part of your public profile." />
            <Panel>
              <div className="flex items-center gap-4">
                <button onClick={() => avatarInput.current?.click()} className="w-20 h-20 rounded-2xl overflow-hidden bg-amber-500 flex items-center justify-center text-2xl font-bold">
                  {avatar ? <img src={avatar} alt="Profile" className="w-full h-full object-cover" /> : initials}
                </button>
                <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={changeAvatar} />
                <div><p className="text-sm font-semibold">Public profile photo</p><p className="text-[10px] text-[#5C5E72]">{uploadingAvatar ? 'Uploading…' : 'Visible on your approved Worker profile'}</p></div>
              </div>
              <Field label="Full Name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} />
              <Field label="Occupation" value={form.occupation} onChange={(value) => setForm({ ...form, occupation: value })} />
              <Field label="Skills (comma separated)" value={form.skills} onChange={(value) => setForm({ ...form, skills: value })} />
              <Field label="Experience" value={form.experience} onChange={(value) => setForm({ ...form, experience: value })} />
              <Field label="Service State" value={form.serviceState} onChange={(value) => setForm({ ...form, serviceState: value })} />
              <Field label="Service LGA" value={form.serviceLga} onChange={(value) => setForm({ ...form, serviceLga: value })} />
              <Field label="Other service areas (optional, comma separated)" value={form.serviceAreas} onChange={(value) => setForm({ ...form, serviceAreas: value })} />
              <Field label="Starting Price" value={form.price} onChange={(value) => setForm({ ...form, price: value })} inputMode="numeric" />
              <TextArea label="About Your Services" value={form.bio} onChange={(value) => setForm({ ...form, bio: value })} />
            </Panel>

            <Panel>
              <UploadButton label={govIdPath ? 'Government ID uploaded' : 'Upload Government ID'} onClick={() => idInput.current?.click()} complete={!!govIdPath} />
              <input ref={idInput} type="file" accept="image/*,.pdf" className="hidden" onChange={changeGovId} />
              <UploadButton label={certificatePath ? 'Certificate uploaded' : 'Upload Certificate (optional)'} onClick={() => certificateInput.current?.click()} complete={!!certificatePath} />
              <input ref={certificateInput} type="file" accept="image/*,.pdf" className="hidden" onChange={changeCertificate} />
              <UploadButton label={videoPath ? 'Skill video uploaded' : 'Upload 2–3 minute Skill Video'} onClick={() => videoInput.current?.click()} complete={!!videoPath} />
              <input ref={videoInput} type="file" accept="video/*" className="hidden" onChange={changeVideo} />
              {videoPreview && <video src={videoPreview} controls className="w-full rounded-xl max-h-56" />}
            </Panel>
            <Primary label={saving ? 'Saving…' : 'Continue to Payment'} onClick={saveVerification} disabled={saving} />
          </>
        )}

        {step === 'payment' && (
          <Panel>
            <Notice title="Verification fee" text="Payment confirms the verification request fee. It does not approve or publish your Worker profile." />
            <div className="text-center py-5"><p className="text-xs text-[#8A8B9C]">Amount</p><p className="text-3xl font-bold mt-1">₦{fee.toLocaleString()}</p></div>
            <Primary label={paying ? 'Opening Paystack…' : 'Pay with Paystack'} onClick={pay} disabled={paying || fee <= 0} />
            <Secondary label="Back" onClick={() => setStep('form')} />
          </Panel>
        )}

        {step === 'ready' && (
          <Panel>
            <Notice title="Payment confirmed" text="Your Golden Badge confirms payment only. Submit the request so WeHouse can review your information and evidence." />
            <Primary label={saving ? 'Submitting…' : 'Submit Verification Request'} onClick={submit} disabled={saving} />
          </Panel>
        )}

        {step === 'reviewing' && (
          <Panel>
            <div className="text-center py-6"><div className="text-4xl">✓</div><h2 className="text-xl font-bold mt-3">Under Review</h2><p className="text-sm text-[#8A8B9C] mt-2">WeHouse is reviewing your professional profile and private verification evidence. Only approval makes your Worker profile public.</p></div>
            <Secondary label="Back to Dashboard" onClick={onBack} />
          </Panel>
        )}

        {step === 'rejected' && (
          <Panel>
            <Notice title="Verification not approved" text={rejectionReason || 'Review the required information, correct it and submit again.'} danger />
            <Primary label="Edit and Re-submit" onClick={() => setStep('form')} />
          </Panel>
        )}
      </main>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl bg-[#12121A]/75 border border-white/[0.06] p-4 space-y-4">{children}</section>; }
function Notice({ title, text, danger=false }: { title:string; text:string; danger?:boolean }) { return <div className={`rounded-xl border p-3 ${danger?'border-red-500/20 bg-red-500/5':'border-amber-500/20 bg-amber-500/5'}`}><p className={`text-xs font-semibold ${danger?'text-red-300':'text-amber-300'}`}>{title}</p><p className="text-[11px] text-[#8A8B9C] mt-1">{text}</p></div>; }
function Field({ label, value, onChange, inputMode }: { label:string; value:string; onChange:(value:string)=>void; inputMode?:React.HTMLAttributes<HTMLInputElement>['inputMode'] }) { return <label className="block"><span className="text-[11px] text-[#8A8B9C] mb-1 block">{label}</span><input value={value} inputMode={inputMode} onChange={(event)=>onChange(event.target.value)} className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] px-3 text-sm outline-none focus:border-amber-500/50" /></label>; }
function TextArea({ label, value, onChange }: { label:string; value:string; onChange:(value:string)=>void }) { return <label className="block"><span className="text-[11px] text-[#8A8B9C] mb-1 block">{label}</span><textarea rows={4} value={value} onChange={(event)=>onChange(event.target.value)} className="w-full rounded-xl bg-[#1A1A24] border border-[#2A2A3A] p-3 text-sm outline-none resize-none focus:border-amber-500/50" /></label>; }
function UploadButton({ label, onClick, complete }: { label:string; onClick:()=>void; complete:boolean }) { return <button onClick={onClick} className={`w-full h-11 rounded-xl border text-sm font-medium ${complete?'border-emerald-500/30 bg-emerald-500/10 text-emerald-300':'border-[#2A2A3A] bg-[#1A1A24] text-white'}`}>{complete?'✓ ':''}{label}</button>; }
function Primary({ label, onClick, disabled=false }: { label:string; onClick:()=>void; disabled?:boolean }) { return <button onClick={onClick} disabled={disabled} className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 text-white text-sm font-semibold disabled:opacity-40">{label}</button>; }
function Secondary({ label, onClick }: { label:string; onClick:()=>void }) { return <button onClick={onClick} className="w-full h-11 rounded-xl bg-[#1A1A24] text-white text-sm font-semibold">{label}</button>; }

import { useEffect, useRef, useState } from 'react';
import { changePassword, supabase, updatePrivacySettings, updateProfile, uploadAvatar } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface SettingsTabProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
}

type Section = 'profile' | 'privacy' | 'notifications' | 'security' | 'payout' | 'close';

export default function SettingsTab({ profile, onUpdate }: SettingsTabProps) {
  const canUsePayout = profile.role === 'worker' || profile.role === 'property_partner';
  const canClose = profile.role === 'user' || profile.role === 'worker' || profile.role === 'property_partner';
  const [section, setSection] = useState<Section>('profile');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [avatar, setAvatar] = useState(profile.avatar_url || '');
  const [uploading, setUploading] = useState(false);
  const isWorker = profile.role === 'worker';
  const [occupation, setOccupation] = useState(profile.worker_occupation || '');

  const p = profile as any;
  const [privacy, setPrivacy] = useState({
    privacy_profile_visible: profile.privacy_profile_visible !== false,
    privacy_search_visible: profile.privacy_search_visible !== false,
    privacy_activity_visible: profile.privacy_activity_visible !== false,
    privacy_email_visible: p.privacy_email_visible === true,
    privacy_phone_visible: p.privacy_phone_visible === true,
  });
  const [emailNotifs, setEmailNotifs] = useState(p.pref_email_notif !== false);
  const [pushNotifs, setPushNotifs] = useState(p.pref_push_notif !== false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [closeText, setCloseText] = useState('');

  useEffect(() => {
    if (!canUsePayout) return;
    supabase.from('bank_accounts')
      .select('bank_name,bank_code,account_number,account_name')
      .eq('user_id', profile.user_id)
      .eq('is_default', true)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setBankName(data.bank_name || '');
        setBankCode(data.bank_code || '');
        setAccountNumber(data.account_number || '');
        setAccountName(data.account_name || '');
      });
  }, [canUsePayout, profile.user_id]);

  const sections: { id: Section; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'security', label: 'Password' },
    ...(canUsePayout ? [{ id: 'payout' as Section, label: 'Payout Account' }] : []),
    ...(canClose ? [{ id: 'close' as Section, label: 'Close Account' }] : []),
  ];

  async function saveProfile() {
    setSaving(true);
    const updates: any = {
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatar || null,
    };
    if (isWorker && occupation.trim()) updates.worker_occupation = occupation.trim();
    const wasPaid = isWorker && profile.worker_status === 'verification_paid';
    if (wasPaid && (fullName !== profile.full_name || bio !== profile.bio || occupation !== (profile.worker_occupation || ''))) {
      updates.worker_status = 'pending';
      updates.worker_verified = false;
    }
    const { profile: updated, error } = await updateProfile(profile.user_id, updates);
    setSaving(false);
    if (error || !updated) return toast.error(error?.message || 'Failed to save profile');
    onUpdate(updated);
    toast.success('Profile saved');
  }

  async function changeAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setUploading(false);
    if (error || !url) return toast.error(error?.message || 'Avatar upload failed');
    setAvatar(url);
    const { profile: updated, error: updateError } = await updateProfile(profile.user_id, { avatar_url: url });
    if (updateError || !updated) return toast.error(updateError?.message || 'Could not save avatar');
    onUpdate(updated);
    toast.success('Profile photo updated');
  }

  async function savePrivacy() {
    setSaving(true);
    const { profile: updated, error } = await updatePrivacySettings(profile.user_id, privacy as any);
    setSaving(false);
    if (error || !updated) return toast.error(error?.message || 'Failed to save privacy');
    onUpdate(updated);
    toast.success('Privacy saved');
  }

  async function saveNotifications() {
    setSaving(true);
    const { data, error } = await supabase.from('profiles').update({
      pref_email_notif: emailNotifs,
      pref_push_notif: pushNotifs,
      updated_at: new Date().toISOString(),
    }).eq('auth_id', profile.auth_id).select().maybeSingle();
    setSaving(false);
    if (error || !data) return toast.error(error?.message || 'Failed to save notifications');
    onUpdate(data as Profile);
    toast.success('Notification preferences saved');
  }

  async function savePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) return toast.error('Complete all password fields');
    if (newPassword !== confirmPassword) return toast.error('New passwords do not match');
    if (newPassword.length < 8) return toast.error('Password must be at least 8 characters');
    setSaving(true);
    const { error } = await changePassword(currentPassword, newPassword, profile.email);
    setSaving(false);
    if (error) return toast.error(error.message || 'Password change failed');
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    toast.success('Password changed');
  }

  async function savePayout() {
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) return toast.error('Complete all payout fields');
    setSaving(true);
    const { error } = await supabase.rpc('upsert_my_bank_account', {
      p_bank_name: bankName.trim(),
      p_bank_code: bankCode.trim(),
      p_account_number: accountNumber.trim(),
      p_account_name: accountName.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message || 'Failed to save payout account');
    toast.success('Payout account saved');
  }

  async function closeAccount() {
    if (closeText !== 'CLOSE') return toast.error('Type CLOSE to confirm');
    setSaving(true);
    const { error } = await supabase.rpc('delete_user_account', { p_user_id: profile.user_id });
    setSaving(false);
    if (error) return toast.error(error.message || 'Account could not be closed');
    toast.success('Account closed');
    await supabase.auth.signOut({ scope: 'global' });
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors />
      <div><h3 className="text-lg font-bold text-white">Account Settings</h3><p className="text-[11px] text-[#5C5E72]">Personal information is separate from role, permissions and operational assignment.</p></div>
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1 overflow-x-auto scrollbar-hide">
        {sections.map(item => <button key={item.id} onClick={() => setSection(item.id)} className={`flex-shrink-0 px-3 h-8 rounded-lg text-[11px] font-semibold ${section === item.id ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C]'}`}>{item.label}</button>)}
      </div>

      {section === 'profile' && <Panel><div className="space-y-4">{isWorker && profile.worker_status === 'verification_paid' && <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3"><p className="text-[11px] text-amber-400"><strong>Note:</strong> Editing profile will reset status to Awaiting Approval.</p></div>}<div className="flex items-center gap-4"><button onClick={() => fileRef.current?.click()} className="w-16 h-16 rounded-full bg-[#1A1A24] overflow-hidden flex items-center justify-center text-white text-xl font-bold">{avatar ? <img src={avatar} className="w-full h-full object-cover" alt="Profile" /> : (profile.username || 'U')[0].toUpperCase()}</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={changeAvatar} className="hidden" /><div><p className="text-sm text-white font-semibold">@{profile.username}</p><p className="text-[10px] text-[#5C5E72]">{uploading ? 'Uploading…' : `${profile.role} · ${profile.user_id}`}</p></div></div><Field label="Full Name" value={fullName} onChange={setFullName} /><Field label="Phone" value={phone} onChange={setPhone} /><TextArea label="Bio" value={bio} onChange={setBio} />{(profile.role === 'staff' || profile.role === 'admin') && <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300">Your personal profile is editable here. Operational assignment remains controlled separately by Creator.</div>}<Action label="Save Profile" loading={saving} onClick={saveProfile} /></div></Panel>}
      {section === 'privacy' && <Panel><Toggle label="Public Profile" value={privacy.privacy_profile_visible} onChange={v => setPrivacy({ ...privacy, privacy_profile_visible: v })} /><Toggle label="Appear in Search" value={privacy.privacy_search_visible} onChange={v => setPrivacy({ ...privacy, privacy_search_visible: v })} /><Toggle label="Show Activity Status" value={privacy.privacy_activity_visible} onChange={v => setPrivacy({ ...privacy, privacy_activity_visible: v })} /><Toggle label="Show Email" value={privacy.privacy_email_visible} onChange={v => setPrivacy({ ...privacy, privacy_email_visible: v })} /><Toggle label="Show Phone" value={privacy.privacy_phone_visible} onChange={v => setPrivacy({ ...privacy, privacy_phone_visible: v })} /><Action label="Save Privacy" loading={saving} onClick={savePrivacy} /></Panel>}
      {section === 'notifications' && <Panel><Toggle label="Email Notifications" value={emailNotifs} onChange={setEmailNotifs} /><Toggle label="Push Notifications" value={pushNotifs} onChange={setPushNotifs} /><Action label="Save Notifications" loading={saving} onClick={saveNotifications} /></Panel>}
      {section === 'security' && <Panel><Field label="Current Password" value={currentPassword} onChange={setCurrentPassword} type="password" /><Field label="New Password" value={newPassword} onChange={setNewPassword} type="password" /><Field label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} type="password" /><Action label="Change Password" loading={saving} onClick={savePassword} /></Panel>}
      {section === 'payout' && <Panel><p className="text-[11px] text-[#8A8B9C]">Payout information is stored separately from your public profile.</p><Field label="Bank Name" value={bankName} onChange={setBankName} /><Field label="Bank Code (optional)" value={bankCode} onChange={setBankCode} /><Field label="Account Number" value={accountNumber} onChange={setAccountNumber} inputMode="numeric" /><Field label="Account Name" value={accountName} onChange={setAccountName} /><Action label="Save Payout Account" loading={saving} onClick={savePayout} /></Panel>}
      {section === 'close' && <Panel><div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-300">Account closure is checked on the server. Active jobs, escrow, wallet balances or historical partner listings may block closure.</div><Field label="Type CLOSE to confirm" value={closeText} onChange={setCloseText} /><button onClick={closeAccount} disabled={saving || closeText !== 'CLOSE'} className="w-full h-11 rounded-xl bg-red-500 text-white text-sm font-semibold disabled:opacity-40">{saving ? 'Closing…' : 'Close Account'}</button></Panel>}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl bg-[#12121A]/70 border border-white/[0.05] p-4 space-y-4">{children}</div>; }
function Field({ label, value, onChange, type='text', inputMode }: { label:string; value:string; onChange:(v:string)=>void; type?:string; inputMode?:React.HTMLAttributes<HTMLInputElement>['inputMode'] }) { return <label className="block"><span className="text-[11px] text-[#8A8B9C] mb-1 block">{label}</span><input type={type} inputMode={inputMode} value={value} onChange={e=>onChange(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></label>; }
function TextArea({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) { return <label className="block"><span className="text-[11px] text-[#8A8B9C] mb-1 block">{label}</span><textarea rows={3} value={value} onChange={e=>onChange(e.target.value)} className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm p-3 outline-none resize-none focus:border-[#3B82F6]" /></label>; }
function Toggle({ label, value, onChange }: { label:string; value:boolean; onChange:(v:boolean)=>void }) { return <div className="flex items-center justify-between gap-4"><span className="text-sm text-white">{label}</span><button onClick={()=>onChange(!value)} className={`w-11 h-6 rounded-full p-0.5 ${value?'bg-[#3B82F6]':'bg-[#2A2A3A]'}`}><span className={`block w-5 h-5 rounded-full bg-white transition-transform ${value?'translate-x-5':''}`} /></button></div>; }
function Action({ label, loading, onClick }: { label:string; loading:boolean; onClick:()=>void }) { return <button onClick={onClick} disabled={loading} className="w-full h-11 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold disabled:opacity-50">{loading?'Saving…':label}</button>; }

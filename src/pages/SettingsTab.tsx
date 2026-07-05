import { useState, useRef } from 'react';
import { supabase, uploadAvatar, changePassword } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface SettingsTabProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
}

type SettingsSection = 'profile' | 'password' | 'privacy' | 'notifications' | 'bank' | 'subscription' | 'language';

export default function SettingsTab({ profile, onUpdate }: SettingsTabProps) {
  const role = profile.role;
  const isWorker = role === 'worker';
  const isPartner = role === 'property_partner';
  const isUser = role === 'user';

  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile form
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '');
  const [occupation, setOccupation] = useState(profile.worker_occupation || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Password form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  // Privacy settings
  const [isPublic, setIsPublic] = useState(profile.privacy_profile_visible !== false);
  const [showEmail, setShowEmail] = useState(profile.privacy_search_visible !== false);
  const [showPhone, setShowPhone] = useState(profile.privacy_activity_visible || false);

  // Notification preferences
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(true);
  const [smsNotifs, setSmsNotifs] = useState(false);
  const [promoNotifs, setPromoNotifs] = useState(false);

  // Bank account (cast Profile to access bank fields stored in DB)
  const p = profile as any;
  const [bankName, setBankName] = useState(p.bank_name || '');
  const [accountNumber, setAccountNumber] = useState(p.bank_account_number || '');
  const [accountName, setAccountName] = useState(p.bank_account_name || '');

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Build available sections based on role
  const sections: { id: SettingsSection; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: 'Password' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'notifications', label: 'Notifications' },
    ...(isWorker || isPartner ? [{ id: 'bank' as SettingsSection, label: 'Bank Account' }] : []),
    ...(isWorker ? [{ id: 'subscription' as SettingsSection, label: 'Blue Badge' }] : []),
    ...(isUser ? [{ id: 'language' as SettingsSection, label: 'Language' }] : []),
  ];

  async function handleSaveProfile() {
    setSaving(true);
    const updates: any = {
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl || null,
    };
    if (isWorker && occupation.trim()) {
      updates.worker_occupation = occupation.trim();
    }
    const wasVerified = isWorker && profile.worker_status === 'verified';
    if (wasVerified && (fullName !== profile.full_name || bio !== profile.bio || occupation !== (profile.worker_occupation || ''))) {
      updates.worker_status = 'pending';
      updates.worker_verified = false;
    }
    const { error } = await supabase.rpc('worker_update_profile', {
      p_user_id: profile.user_id,
      p_updates: updates,
    });
    setSaving(false);
    if (error) { toast.error('Failed to save: ' + error.message); return; }
    if (wasVerified && updates.worker_status === 'pending') {
      toast.success('Profile saved — awaiting re-approval');
    } else {
      toast.success('Profile saved');
    }
    onUpdate({ ...profile, ...updates });
  }

  async function handleSavePrivacy() {
    setSaving(true);
    const { error } = await supabase.rpc('worker_update_profile', {
      p_user_id: profile.user_id,
      p_updates: { privacy_profile_visible: isPublic, privacy_search_visible: showEmail, privacy_activity_visible: showPhone },
    });
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Privacy settings saved');
    onUpdate({ ...profile, privacy_profile_visible: isPublic, privacy_search_visible: showEmail, privacy_activity_visible: showPhone });
  }

  async function handleSaveNotifications() {
    toast.success('Notification preferences saved');
  }

  async function handleSaveBank() {
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) {
      toast.error('All bank fields are required'); return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('worker_update_profile', {
      p_user_id: profile.user_id,
      p_updates: {
        bank_name: bankName.trim(),
        bank_account_number: accountNumber.trim(),
        bank_account_name: accountName.trim(),
      },
    });
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Bank details saved');
    onUpdate({ ...profile, bank_name: bankName, bank_account_number: accountNumber, bank_account_name: accountName } as Profile);
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setUploadingAvatar(false);
    if (error || !url) { toast.error('Failed to upload avatar'); return; }
    setAvatarUrl(url);
    toast.success('Avatar uploaded');
  }

  async function handleChangePassword() {
    if (!currentPw || !newPw || !confirmPw) { toast.error('All fields are required'); return; }
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setChangingPw(true);
    const { error } = await changePassword(currentPw, newPw, profile.email);
    setChangingPw(false);
    if (error) { toast.error(error.message || 'Failed to change password'); return; }
    toast.success('Password changed successfully');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('delete_user_account', { p_user_id: profile.user_id });
    setSaving(false);
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Account scheduled for deletion');
    setTimeout(() => window.location.reload(), 2000);
  }

  const initials = (profile.full_name || profile.username || profile.email || 'U').charAt(0).toUpperCase();

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors />

      <div><h3 className="text-lg font-bold text-white">Settings</h3><p className="text-[11px] text-[#5C5E72]">Manage your profile and account</p></div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1 overflow-x-auto scrollbar-hide">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`flex-shrink-0 px-3 h-8 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
              activeSection === s.id ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C] hover:text-white'
            }`}>{s.label}</button>
        ))}
      </div>

      {/* ─── PROFILE SECTION ─── */}
      {activeSection === 'profile' && (
        <div className="space-y-4">
          {isWorker && profile.worker_status === 'verified' && (
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
              <p className="text-[11px] text-amber-400"><strong>Note:</strong> Editing profile will reset status to "Awaiting Approval".</p>
            </div>
          )}
          <div className="flex items-center gap-4">
            <div onClick={() => fileInputRef.current?.click()} className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white font-bold text-xl cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0">
              {avatarUrl ? <img src={avatarUrl} alt="avatar" className="w-full h-full rounded-full object-cover" /> : initials}
              {uploadingAvatar && <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center"><svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg></div>}
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#1A1A24] border border-[#2A2A3A] flex items-center justify-center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            <div>
              <p className="text-sm font-semibold text-white">@{profile.username || 'unknown'}</p>
              <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
              <p className="text-[10px] text-[#5C5E72]">Role: {profile.role}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Full Name</label><input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Bio</label><textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 py-2 outline-none focus:border-[#3B82F6] resize-none" /></div>
            {isWorker && <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Occupation</label><input value={occupation} onChange={e => setOccupation(e.target.value)} placeholder="e.g. Electrician" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>}
          </div>
          <SaveButton onClick={handleSaveProfile} saving={saving} label="Save Profile" />
        </div>
      )}

      {/* ─── PASSWORD SECTION ─── */}
      {activeSection === 'password' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Current Password</label><input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">New Password</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Confirm New Password</label><input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <button onClick={handleChangePassword} disabled={changingPw} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">{changingPw ? 'Changing...' : 'Change Password'}</button>
          </div>
        </div>
      )}

      {/* ─── PRIVACY SECTION ─── */}
      {activeSection === 'privacy' && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 space-y-4">
            <ToggleRow label="Public Profile" desc="Allow others to find your profile" enabled={isPublic} onToggle={() => setIsPublic(!isPublic)} />
            <ToggleRow label="Show Email" desc="Display email on your public profile" enabled={showEmail} onToggle={() => setShowEmail(!showEmail)} />
            <ToggleRow label="Show Phone" desc="Display phone on your public profile" enabled={showPhone} onToggle={() => setShowPhone(!showPhone)} />
          </div>
          <SaveButton onClick={handleSavePrivacy} saving={saving} label="Save Privacy Settings" />
          <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4">
            <p className="text-xs font-semibold text-red-400 mb-2">Danger Zone</p>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)} className="w-full h-10 rounded-xl bg-red-500/10 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors">Delete Account</button>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-red-400">This cannot be undone. Type DELETE to confirm.</p>
                <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder="Type DELETE" className="w-full h-9 rounded-lg bg-[#1A1A24] border border-red-500/30 text-white text-xs px-3 outline-none" />
                <div className="flex gap-2">
                  <button onClick={handleDeleteAccount} disabled={saving} className="flex-1 h-9 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50">{saving ? '...' : 'Confirm Delete'}</button>
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }} className="flex-1 h-9 rounded-lg bg-[#1A1A24] text-[#5C5E72] text-xs">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── NOTIFICATIONS SECTION ─── */}
      {activeSection === 'notifications' && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 space-y-4">
            <ToggleRow label="Email Notifications" desc="Receive booking and payment updates via email" enabled={emailNotifs} onToggle={() => setEmailNotifs(!emailNotifs)} />
            <ToggleRow label="Push Notifications" desc="Browser push notifications" enabled={pushNotifs} onToggle={() => setPushNotifs(!pushNotifs)} />
            <ToggleRow label="SMS Notifications" desc="Text message alerts" enabled={smsNotifs} onToggle={() => setSmsNotifs(!smsNotifs)} />
            <ToggleRow label="Promotional Messages" desc="News, offers, and platform updates" enabled={promoNotifs} onToggle={() => setPromoNotifs(!promoNotifs)} />
          </div>
          <SaveButton onClick={handleSaveNotifications} saving={saving} label="Save Preferences" />
        </div>
      )}

      {/* ─── BANK ACCOUNT SECTION ─── */}
      {activeSection === 'bank' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3">
            <p className="text-[11px] text-emerald-400">These details are used for withdrawals. Ensure they are accurate.</p>
          </div>
          <div className="space-y-3">
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Bank Name</label><input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. GTBank" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Account Number</label><input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="10 digit account number" maxLength={10} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
            <div><label className="text-[11px] text-[#8A8B9C] mb-1 block">Account Name</label><input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Name on account" className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]" /></div>
          </div>
          <SaveButton onClick={handleSaveBank} saving={saving} label="Save Bank Details" />
        </div>
      )}

      {/* ─── BLUE BADGE SECTION ─── */}
      {activeSection === 'subscription' && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 1 4.1-.252 3.42 3.42 0 0 0 3.388-3.388 3.42 3.42 0 0 1 2.567-1.932 3.42 3.42 0 0 0 2.568-1.932M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0" /></svg>
            </div>
            <p className="text-sm font-semibold text-white mb-1">Blue Badge Subscription</p>
            <p className="text-[11px] text-[#5C5E72] mb-3">Get verified and appear at the top of search results.</p>
            <p className="text-xs text-[#3B82F6] font-semibold mb-3">N5,000 / month</p>
            <button onClick={() => toast.info('Subscription coming soon — Paystack integration pending')} className="h-10 px-6 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-xs font-semibold hover:opacity-90 transition-opacity">Subscribe Now</button>
          </div>
          <div className="rounded-xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-xs font-semibold text-white mb-2">Benefits</p>
            <ul className="space-y-1.5 text-[11px] text-[#8A8B9C]">
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Priority placement in search</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Verified badge on profile</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Higher trust with customers</li>
              <li className="flex items-center gap-2"><span className="text-emerald-400">✓</span> Analytics dashboard</li>
            </ul>
          </div>
        </div>
      )}

      {/* ─── LANGUAGE SECTION ─── */}
      {activeSection === 'language' && (
        <div className="space-y-4">
          <div className="glass rounded-xl p-4">
            <p className="text-xs font-semibold text-white mb-3">Language</p>
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#1A1A24] border border-[#232330]">
              <div className="flex items-center gap-3"><span className="text-lg">🇬🇧</span><div><p className="text-xs text-white">English</p><p className="text-[10px] text-[#5C5E72]">Default</p></div></div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">Active</span>
            </div>
            <p className="text-[10px] text-[#5C5E72] mt-3">More languages coming soon.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UI Components ──────────────────────────

function ToggleRow({ label, desc, enabled, onToggle }: { label: string; desc: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div><p className="text-xs font-medium text-white">{label}</p><p className="text-[10px] text-[#5C5E72]">{desc}</p></div>
      <button onClick={onToggle} className={`relative w-10 h-5.5 rounded-full transition-colors ${enabled ? 'bg-[#10B981]' : 'bg-[#2A2A3A]'}`}>
        <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function SaveButton({ onClick, saving, label }: { onClick: () => void; saving: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={saving} className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
      {saving ? <span className="flex items-center justify-center gap-2"><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>Saving...</span> : label}
    </button>
  );
}

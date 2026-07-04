import { useState, useRef } from 'react';
import { updateProfile, uploadAvatar, changePassword } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface SettingsTabProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
}

export default function SettingsTab({ profile, onUpdate }: SettingsTabProps) {
  const [activeSection, setActiveSection] = useState<'profile' | 'password'>('profile');
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile form
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Password form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  async function handleSaveProfile() {
    setSaving(true);

    // Build updates
    const updates: any = {
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl || null,
    };

    // If worker was verified, editing profile resets status to pending for re-approval
    const wasVerified = profile.role === 'worker' && profile.worker_status === 'verified';
    if (wasVerified) {
      updates.worker_status = 'pending';
      updates.worker_verified = false;
    }

    const { error } = await updateProfile(profile.user_id, updates);
    setSaving(false);
    if (error) {
      toast.error('Failed to save: ' + error.message);
      return;
    }

    if (wasVerified) {
      toast.success('Profile saved — awaiting re-approval');
      onUpdate({ ...profile, full_name: fullName, phone, bio, avatar_url: avatarUrl, worker_status: 'pending', worker_verified: false });
    } else {
      toast.success('Profile saved');
      onUpdate({ ...profile, full_name: fullName, phone, bio, avatar_url: avatarUrl });
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { url, error } = await uploadAvatar(file, profile.user_id);
    setUploadingAvatar(false);
    if (error || !url) {
      toast.error('Failed to upload avatar');
      return;
    }
    setAvatarUrl(url);
    toast.success('Avatar uploaded');
  }

  async function handleChangePassword() {
    if (!currentPw || !newPw || !confirmPw) {
      toast.error('All fields are required');
      return;
    }
    if (newPw !== confirmPw) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPw.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setChangingPw(true);
    const { error } = await changePassword(currentPw, newPw, profile.email);
    setChangingPw(false);
    if (error) {
      toast.error(error.message || 'Failed to change password');
      return;
    }
    toast.success('Password changed successfully');
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
  }

  const initials = (profile.full_name || profile.username || profile.email || 'U').charAt(0).toUpperCase();

  return (
    <div className="space-y-4">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <div>
        <h3 className="text-lg font-bold text-white">Settings</h3>
        <p className="text-[11px] text-[#5C5E72]">Manage your profile and account</p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-[#1A1A24] rounded-xl p-1">
        <button
          onClick={() => setActiveSection('profile')}
          className={`flex-1 h-8 rounded-lg text-[11px] font-semibold transition-all ${
            activeSection === 'profile' ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C] hover:text-white'
          }`}
        >
          Edit Profile
        </button>
        <button
          onClick={() => setActiveSection('password')}
          className={`flex-1 h-8 rounded-lg text-[11px] font-semibold transition-all ${
            activeSection === 'password' ? 'bg-[#3B82F6] text-white' : 'text-[#8A8B9C] hover:text-white'
          }`}
        >
          Change Password
        </button>
      </div>

      {/* ─── PROFILE SECTION ─── */}
      {activeSection === 'profile' && (
        <div className="space-y-4">
          {/* Warning for verified workers */}
          {profile.role === 'worker' && profile.worker_status === 'verified' && (
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
              <p className="text-[11px] text-amber-400">
                <strong>Note:</strong> Editing your profile will reset your status to "Awaiting Approval". 
                You will not appear in public search until WeHouse re-approves your profile.
              </p>
            </div>
          )}

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white font-bold text-xl cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-full h-full rounded-full object-cover" />
              ) : (
                initials
              )}
              {uploadingAvatar && (
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                  <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                  </svg>
                </div>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#1A1A24] border border-[#2A2A3A] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            <div>
              <p className="text-sm font-semibold text-white">@{profile.username || 'unknown'}</p>
              <p className="text-[10px] text-[#5C5E72]">{profile.email}</p>
              <p className="text-[10px] text-[#5C5E72]">Role: {profile.role}</p>
            </div>
          </div>

          {/* Form fields */}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Full Name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Phone Number</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +234 801 234 5678"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself"
                rows={3}
                className="w-full rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 py-2 outline-none focus:border-[#3B82F6] resize-none"
              />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
                Saving...
              </span>
            ) : (
              'Save Profile'
            )}
          </button>
        </div>
      )}

      {/* ─── PASSWORD SECTION ─── */}
      {activeSection === 'password' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4 space-y-3">
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Current Password</label>
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Enter current password"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#8A8B9C] mb-1 block">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-3 outline-none focus:border-[#3B82F6]"
              />
            </div>
            <button
              onClick={handleChangePassword}
              disabled={changingPw}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {changingPw ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
                  Changing...
                </span>
              ) : (
                'Change Password'
              )}
            </button>
          </div>

          <div className="rounded-2xl bg-[#12121A]/60 border border-white/[0.04] p-4">
            <p className="text-xs font-semibold text-white mb-2">Account Info</p>
            <div className="space-y-2 text-[11px] text-[#8A8B9C]">
              <p>Username: <span className="text-white">@{profile.username || 'N/A'}</span></p>
              <p>Email: <span className="text-white">{profile.email}</span></p>
              <p>Role: <span className="text-white">{profile.role}</span></p>
              <p>Joined: <span className="text-white">{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}</span></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

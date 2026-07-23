import { useRef, useState, useCallback } from 'react';
import { uploadAvatar, updateProfile, removeAvatar } from '@/lib/supabase';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface DashboardProps {
  profile: Profile;
  onLogout: () => void;
  onNavigate?: (page: string) => void;
  onGoToChat?: () => void;
  onGoToProfileEdit?: () => void;
  onGoToAccount?: () => void;
  isAdmin?: boolean;
  onGoToNewListing?: () => void;
}

export default function Dashboard({
  profile,
  onLogout,
  onNavigate,
  onGoToChat,
  onGoToProfileEdit,
  onGoToAccount,
  isAdmin,
  onGoToNewListing,
}: DashboardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const { ask, dialogProps } = useConfirm();
  const [localAvatar, setLocalAvatar] = useState<string | null>(profile.avatar_url);

  const initials = (profile.username || profile.email[0]).toUpperCase();
  const displayName = profile.username || profile.email.split('@')[0];

  // Role classification (use distinct names to avoid conflict with isAdmin prop)
  const isCreatorRole = profile.role === 'creator' || profile.role === 'creator_admin';
  const isAdminRole = profile.role === 'admin';
  const isStaffRole = profile.role === 'staff';
  const isOperator = isCreatorRole || isAdminRole || isStaffRole;
  const accountTitle = isOperator ? 'Account' : 'Profile';

  const handleAvatarTap = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image must be under 5MB');
        return;
      }
      setUploadingAvatar(true);
      const { url, error } = await uploadAvatar(file, profile.user_id);
      setUploadingAvatar(false);
      if (error || !url) {
        toast.error('Upload failed: ' + (error?.message || 'Unknown error'));
        return;
      }
      // Update profile in DB
      const { error: updateErr } = await updateProfile(profile.user_id, { avatar_url: url });
      if (updateErr) {
        toast.error('Failed to save avatar');
        return;
      }
      setLocalAvatar(url);
      toast.success('Photo updated!');
    },
    [profile.user_id]
  );

  const handleRemoveAvatar = async () => {
    const ok = await ask({
      title: 'Remove this photo?',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    toast.loading('Removing...', { id: 'avatar-rm' });
    const { error } = await removeAvatar(profile.user_id);
    toast.dismiss('avatar-rm');
    if (error) {
      toast.error('Failed to remove photo');
      return;
    }
    setLocalAvatar(null);
    toast.success('Photo removed');
  };

  return (
    <div className="min-h-screen bg-transparent pb-24">
      <Toaster position="top-center" richColors />
      <ConfirmDialog {...dialogProps} />

      {/* Header */}
      <header className="bg-gradient-to-b from-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-6">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-bold text-white">{accountTitle}</h1>
            <button
              onClick={onLogout}
              className="text-xs text-[#5C5E72] hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10"
            >
              Logout
            </button>
          </div>

          {/* Profile Card */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-4">
              {/* Avatar - tappable */}
              <button
                onClick={handleAvatarTap}
                disabled={uploadingAvatar}
                className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xl font-bold flex-shrink-0 glow-blue-sm overflow-hidden disabled:opacity-60 transition-all active:scale-95"
              >
                {uploadingAvatar ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : localAvatar ? (
                  <img src={localAvatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  initials[0]
                )}
                {/* Camera overlay */}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white truncate">@{displayName}</h2>
                  {profile.role !== 'user' && (
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                      profile.role === 'creator'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : profile.role === 'admin'
                        ? 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/30'
                        : profile.role === 'staff'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-white/[0.02] text-[#5C5E72] border-white/5'
                    }`}>
                      {profile.role === 'worker' ? 'WORKER' : profile.role.toUpperCase()}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#5C5E72] truncate">{profile.email}</p>
                <p className="text-[10px] text-[#5C5E72] mt-0.5">ID: {profile.user_id}</p>
                {localAvatar && (
                  <button
                    onClick={handleRemoveAvatar}
                    className="text-[10px] text-red-400/70 hover:text-red-400 mt-1 transition-colors"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            {/* Verification - ONLY email (real) */}
            <div className="flex flex-wrap gap-2 mt-4">
              <span
                className={`text-[10px] font-medium px-3 py-1.5 rounded-full border ${
                  profile.email_verified
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-white/[0.02] text-[#5C5E72] border-white/5'
                }`}
              >
                {profile.email_verified && (
                  <svg className="inline w-2.5 h-2.5 mr-1 -mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                Email {profile.email_verified ? 'Verified' : 'Unverified'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-4">
        {/* Quick Actions — role-specific */}
        <div className="grid grid-cols-2 gap-3">
          {/* Add Listing — only for Worker and Property Partner (not Creator/Admin/Staff) */}
          {isAdmin && onGoToNewListing && (profile.role === 'worker' || profile.role === 'property_partner') && (
            <button onClick={onGoToNewListing} className="glass rounded-2xl p-4 flex items-center gap-3 card-hover text-left group border border-green-500/10">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Add Listing</div>
                <div className="text-[10px] text-[#5C5E72]">Post new property</div>
              </div>
            </button>
          )}
          {/* Edit Profile — User and Worker only. Admin/Creator/Staff use their dashboard hubs. */}
          {onGoToProfileEdit && (profile.role === 'user' || profile.role === 'worker' || profile.role === 'property_partner') && (
            <button onClick={onGoToProfileEdit} className="glass rounded-2xl p-4 flex items-center gap-3 card-hover text-left group">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center group-hover:bg-[#3B82F6]/20 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Edit Profile</div>
                <div className="text-[10px] text-[#5C5E72]">Photo, bio, details</div>
              </div>
            </button>
          )}
          {/* Staff — show assigned modules instead of Edit Profile */}
          {profile.role === 'staff' && (
            <div className="glass rounded-2xl p-4 flex items-center gap-3 border border-amber-500/10">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Assigned Modules</div>
                <div className="text-[10px] text-amber-400">View in Staff Hub</div>
              </div>
            </div>
          )}
        </div>

        {/* My Bookings — only for users and workers (the ones who book services) */}
        {onNavigate && (profile.role === 'user' || profile.role === 'worker') && (
          <button
            onClick={() => onNavigate('my_bookings')}
            className="w-full glass rounded-2xl p-4 flex items-center justify-between card-hover group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                  <path d="M20 7h-4V4c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v3H4c-1.103 0-2 .897-2 2v11c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2z" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-white">My Bookings</div>
                <div className="text-[10px] text-[#5C5E72]">View your worker bookings</div>
              </div>
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5C5E72"
              strokeWidth="2"
              className="group-hover:translate-x-0.5 transition-transform"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* My Reservations — only for users (the ones who book hotels) */}
        {onNavigate && profile.role === 'user' && (
          <button
            onClick={() => onNavigate('my_reservations')}
            className="w-full glass rounded-2xl p-4 flex items-center justify-between card-hover group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
                  <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
                  <path d="m2 20h20" />
                  <path d="M12 11v-6" />
                  <path d="M9 11v-2" />
                  <path d="M15 11v-2" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-white">My Reservations</div>
                <div className="text-[10px] text-[#5C5E72]">View your hotel bookings</div>
              </div>
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5C5E72"
              strokeWidth="2"
              className="group-hover:translate-x-0.5 transition-transform"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Account Center — customer feature, hidden for operators */}
        {onGoToAccount && !isOperator && (
          <button
            onClick={onGoToAccount}
            className="w-full glass rounded-2xl p-4 flex items-center justify-between card-hover group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-white">Account Center</div>
                <div className="text-[10px] text-[#5C5E72]">Privacy, security, settings</div>
              </div>
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5C5E72"
              strokeWidth="2"
              className="group-hover:translate-x-0.5 transition-transform"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* About — ONLY for normal users and workers. Admin/Creator/Staff/Partner have dashboard hubs. */}
        {(profile.role === 'user' || profile.role === 'worker' || profile.role === 'property_partner') &&
         (profile.bio || profile.occupation || profile.school || profile.preferred_location || profile.gender) && (
          <div className="glass rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">About</h3>
            {profile.bio && (
              <p className="text-xs text-[#8B8DA0] mb-3 leading-relaxed">
                {profile.bio.replace(/🛠️STATUS:\w+🛠️\s*/g, '').trim() || 'No bio yet'}
              </p>
            )}
            <div className="space-y-2.5">
              {profile.gender && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Gender</span>
                  <span className="text-white capitalize">{profile.gender}</span>
                </div>
              )}
              {profile.occupation && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Occupation</span>
                  <span className="text-white">{profile.occupation}</span>
                </div>
              )}
              {profile.is_student && profile.school && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">School</span>
                  <span className="text-white">{profile.school}</span>
                </div>
              )}
              {profile.preferred_location && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">Location</span>
                  <span className="text-white">{profile.preferred_location}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* OPERATOR-SPECIFIC SECTIONS — NOT for normal users */}
        {isCreatorRole && onNavigate && (
          <>
            {/* Creator: Platform Access */}
            <div className="glass rounded-2xl p-5 border border-purple-500/10">
              <h3 className="text-sm font-semibold text-purple-400 mb-3">Platform Access</h3>
              <p className="text-[10px] text-[#5C5E72] mb-3">Creator has full platform authority. All management systems are accessible.</p>
              <div className="space-y-2">
                {[
                  { label: 'Platform Settings', page: 'creator', desc: 'Configure platform settings', color: 'text-white', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
                  { label: 'Audit & Activity', page: 'analytics', desc: 'View platform activity log', color: 'text-white', icon: 'M18 20V10M12 20V4M6 20v-6' },
                  { label: 'Staff & Admin Management', page: 'management', desc: 'Manage team members', color: 'text-white', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
                ].map(link => (
                  <button
                    key={link.label}
                    onClick={() => onNavigate(link.page)}
                    className="w-full glass rounded-xl p-3 flex items-center justify-between card-hover group border border-white/[0.04]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2"><path d={link.icon} /></svg>
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-semibold text-white">{link.label}</div>
                        <div className="text-[9px] text-[#5C5E72]">{link.desc}</div>
                      </div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5E72" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {isAdminRole && (
          <div className="glass rounded-2xl p-5 border border-[#3B82F6]/10">
            <h3 className="text-sm font-semibold text-[#3B82F6] mb-3">Assignment</h3>
            <div className="space-y-2.5">
              {[
                { label: 'Role', value: 'Admin' },
                { label: 'Branch', value: (profile as any).branch || 'Not assigned' },
                { label: 'State', value: (profile as any).state || 'Not assigned' },
                { label: 'LGA', value: (profile as any).local_government || 'Not assigned' },
              ].map(item => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">{item.label}</span>
                  <span className={item.value === 'Not assigned' ? 'text-amber-400/70' : 'text-white/80 font-medium'}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isStaffRole && (
          <div className="glass rounded-2xl p-5 border border-amber-500/10">
            <h3 className="text-sm font-semibold text-amber-400 mb-3">Work Assignment</h3>
            <div className="space-y-2.5">
              {[
                { label: 'Role', value: 'Staff' },
                { label: 'Branch', value: (profile as any).branch || 'Not assigned' },
                { label: 'State/LGA', value: (profile as any).local_government ? `${(profile as any).state || ''} / ${(profile as any).local_government}` : 'Not assigned' },
                { label: 'Module', value: (profile as any).assigned_module || 'Not assigned' },
                { label: 'Permissions', value: (profile as any).permissions ? 'Configured' : 'Default' },
              ].map(item => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-[#5C5E72]">{item.label}</span>
                  <span className={item.value?.includes('Not') ? 'text-amber-400/70' : 'text-white/80 font-medium'}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Creator / Admin / Staff Dashboard Link */}
        {isOperator && onNavigate && (
          <button
            onClick={() => onNavigate(isStaffRole ? 'staff_dashboard' : isCreatorRole ? 'creator' : 'admin')}
            className="w-full glass rounded-2xl p-4 flex items-center justify-between card-hover group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center glow-blue-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-white">
                  {isCreatorRole ? 'Creator' : isAdminRole ? 'Admin' : 'Staff'} Hub
                </div>
                <div className="text-[10px] text-[#5C5E72]">Manage users, listings, analytics</div>
              </div>
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5C5E72"
              strokeWidth="2"
              className="group-hover:translate-x-0.5 transition-transform"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Account Info */}
        <div className="glass rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Account</h3>
          <div className="space-y-2.5">
            {[
              { label: 'User ID', value: profile.user_id },
              { label: 'Email', value: profile.email },
              { label: 'Role', value: profile.role === 'user' ? 'Member' : profile.role.charAt(0).toUpperCase() + profile.role.slice(1) },
              {
                label: 'Joined',
                value: new Date(profile.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                }),
              },
            ].map((item) => (
              <div key={item.label} className="flex justify-between text-xs">
                <span className="text-[#5C5E72]">{item.label}</span>
                <span className="text-white/80 font-medium">{item.value || <span className="text-[#5C5E72]">—</span>}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

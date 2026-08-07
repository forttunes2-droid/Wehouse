import { useState } from 'react';
import { updatePrivacySettings } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface PrivacySettingsProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
  onBack: () => void;
}

type PrivacyKey = 'privacy_profile_visible' | 'privacy_search_visible' | 'privacy_activity_visible' | 'privacy_email_visible' | 'privacy_phone_visible';

export default function PrivacySettings({ profile, onUpdate, onBack }: PrivacySettingsProps) {
  const p = profile as any;
  const [settings, setSettings] = useState<Record<PrivacyKey, boolean>>({
    privacy_profile_visible: profile.privacy_profile_visible !== false,
    privacy_search_visible: profile.privacy_search_visible !== false,
    privacy_activity_visible: profile.privacy_activity_visible !== false,
    privacy_email_visible: p.privacy_email_visible === true,
    privacy_phone_visible: p.privacy_phone_visible === true,
  });
  const [saving, setSaving] = useState<PrivacyKey | null>(null);

  async function toggle(key: PrivacyKey, value: boolean) {
    const previous = settings;
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaving(key);
    const { profile: updated, error } = await updatePrivacySettings(profile.user_id, { [key]: value } as any);
    setSaving(null);
    if (error || !updated) {
      setSettings(previous);
      toast.error(error?.message || 'Failed to save privacy setting');
      return;
    }
    onUpdate(updated);
    toast.success('Privacy setting saved');
  }

  const rows: { key: PrivacyKey; label: string; description: string }[] = [
    { key: 'privacy_profile_visible', label: 'Public Profile', description: 'Allow other eligible WeHouse users to open your public profile.' },
    { key: 'privacy_search_visible', label: 'Appear in Search', description: 'Allow your profile to appear in relevant discovery and roommate search.' },
    { key: 'privacy_activity_visible', label: 'Show Activity Status', description: 'Allow eligible users to see when you were recently active.' },
    { key: 'privacy_email_visible', label: 'Show Email', description: 'Display your email only where a workflow is allowed to reveal it.' },
    { key: 'privacy_phone_visible', label: 'Show Phone', description: 'Display your phone only where a workflow is allowed to reveal it.' },
  ];

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="text-[#8A8B9C] hover:text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-base font-semibold">Privacy</h1>
      </header>

      <main className="max-w-lg mx-auto px-5 py-5 space-y-5">
        <div className="rounded-2xl border border-[#3B82F6]/15 bg-[#3B82F6]/5 p-4">
          <p className="text-sm font-medium text-white">Clear visibility controls</p>
          <p className="text-[11px] text-[#8A8B9C] mt-1">Each setting has one purpose. Role and workflow security still decide who is eligible to see information.</p>
        </div>

        <div className="glass rounded-2xl px-4 divide-y divide-white/[0.05]">
          {rows.map((row) => (
            <div key={row.key} className="py-4 flex items-center justify-between gap-4">
              <div><p className="text-sm font-medium text-white">{row.label}</p><p className="text-[11px] text-[#5C5E72] mt-0.5">{row.description}</p></div>
              <button
                onClick={() => toggle(row.key, !settings[row.key])}
                disabled={saving === row.key}
                aria-pressed={settings[row.key]}
                className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${settings[row.key] ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A]'} disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings[row.key] ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

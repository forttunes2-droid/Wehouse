import { useState, useCallback } from 'react';
import { updatePrivacySettings } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface PrivacySettingsProps {
  profile: Profile;
  onUpdate: (p: Profile) => void;
  onBack: () => void;
}

interface ToggleProps {
  label: string;
  desc: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  saving?: boolean;
}

function ToggleRow({ label, desc, enabled, onChange, saving }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 pr-4">
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-[11px] text-[#5C5E72] mt-0.5">{desc}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        disabled={saving}
        className={`relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 ${
          enabled ? 'bg-[#3B82F6]' : 'bg-[#2A2A3A]'
        } disabled:opacity-50`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export default function PrivacySettings({ profile, onUpdate, onBack }: PrivacySettingsProps) {
  const [settings, setSettings] = useState({
    privacy_profile_visible: profile.privacy_profile_visible ?? true,
    privacy_search_visible: profile.privacy_search_visible ?? true,
    privacy_activity_visible: profile.privacy_activity_visible ?? true,
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const handleToggle = useCallback(
    async (key: keyof typeof settings, value: boolean) => {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);
      setSavingKey(key);

      const { profile: updated, error } = await updatePrivacySettings(profile.user_id, { [key]: value });
      setSavingKey(null);

      if (error) {
        toast.error('Failed to update');
        setSettings(settings); // revert
        return;
      }
      if (updated) onUpdate(updated);
      toast.success('Setting saved');
    },
    [settings, profile.user_id, onUpdate]
  );

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <header className="bg-[#12121A] border-b border-white/[0.06] text-white px-5 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#8A8B9C] hover:text-white transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">Privacy</h1>
      </header>

      <div className="max-w-lg mx-auto px-5 py-5 space-y-6">
        {/* Info banner */}
        <div className="glass rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Control your visibility</h3>
            <p className="text-[11px] text-[#5C5E72] mt-0.5 leading-relaxed">
              These settings control how other users can find and see your profile on WeHouse.
            </p>
          </div>
        </div>

        {/* Profile Visibility */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-1 px-1">Profile</h3>
          <div className="glass rounded-2xl px-4 divide-y divide-white/[0.04]">
            <ToggleRow
              label="Public Profile"
              desc="Allow others to view your full profile including bio, school, and preferences"
              enabled={settings.privacy_profile_visible}
              onChange={(v) => handleToggle('privacy_profile_visible', v)}
              saving={savingKey === 'privacy_profile_visible'}
            />
            <ToggleRow
              label="Searchable"
              desc="Appear in roommate search results and discovery"
              enabled={settings.privacy_search_visible}
              onChange={(v) => handleToggle('privacy_search_visible', v)}
              saving={savingKey === 'privacy_search_visible'}
            />
          </div>
        </div>

        {/* Activity Visibility */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-1 px-1">Activity</h3>
          <div className="glass rounded-2xl px-4">
            <ToggleRow
              label="Show Activity"
              desc="Allow others to see when you were last active"
              enabled={settings.privacy_activity_visible}
              onChange={(v) => handleToggle('privacy_activity_visible', v)}
              saving={savingKey === 'privacy_activity_visible'}
            />
          </div>
        </div>

        {/* Visibility Summary */}
        <div className="glass rounded-2xl p-4 space-y-2.5">
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-2">Current Status</h3>
          {[
            { label: 'Profile visible', visible: settings.privacy_profile_visible },
            { label: 'Searchable', visible: settings.privacy_search_visible },
            { label: 'Activity visible', visible: settings.privacy_activity_visible },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${item.visible ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-[#8B8DA0]">{item.label}</span>
              <span className={item.visible ? 'text-green-400' : 'text-red-400'}>
                {item.visible ? 'On' : 'Off'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

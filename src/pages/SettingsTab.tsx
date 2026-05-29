import { useState, useEffect } from 'react';
import { getSystemSettings, updateSystemSetting, logAuditAction } from '@/lib/supabase';
import { useCreatorAuth } from '@/hooks/useCreatorAuth';
import type { Profile } from '@/types';
import { toast } from 'sonner';

interface SettingsTabProps {
  profile: Profile;
  isCreator: boolean;
}

interface SettingDef {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: [string, string][];
  creatorOnly?: boolean;
  description?: string;
}

export default function SettingsTab({ profile, isCreator }: SettingsTabProps) {
  const { requestAuth } = useCreatorAuth();
  const [savedSettings, setSavedSettings] = useState<Record<string, string>>({});
  const [pendingSettings, setPendingSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    async function load() {
      const { settings: data } = await getSystemSettings();
      const map: Record<string, string> = {};
      if (data) data.forEach((s: any) => { if (s.value != null) map[s.key] = s.value; });
      if (!map.platform_name) map.platform_name = 'WeHouse';
      if (!map.listing_approval_required) map.listing_approval_required = 'false';
      if (!map.maintenance_mode) map.maintenance_mode = 'false';
      if (!map.registration_open) map.registration_open = 'true';
      if (!map.max_listings_per_user) map.max_listings_per_user = 'unlimited';
      setSavedSettings(map);
      setPendingSettings(map);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const changed = Object.keys(pendingSettings).some(k => pendingSettings[k] !== savedSettings[k]);
    setHasChanges(changed);
  }, [pendingSettings, savedSettings]);

  // Protected save — requires creator auth
  async function handleSaveAll() {
    if (isCreator) {
      // Will show auth modal if needed, then auto-continue after password
      requestAuth(doSave);
      return;
    }
    doSave();
  }

  async function doSave() {
    setSaving(true);
    const keys = Object.keys(pendingSettings).filter(k => pendingSettings[k] !== savedSettings[k]);
    if (keys.length === 0) { toast.info('No changes to save'); setSaving(false); return; }
    let savedCount = 0;
    for (const key of keys) {
      const { error } = await updateSystemSetting(key, pendingSettings[key], profile.user_id);
      if (error) {
        toast.error(`Failed to save "${key}"`);
      } else {
        savedCount++;
        await logAuditAction(profile.user_id, profile.email, 'update_setting', 'setting', key, `${key} = ${pendingSettings[key]}`);
      }
    }
    if (savedCount === keys.length) {
      toast.success(`${savedCount} setting${savedCount > 1 ? 's' : ''} saved`);
      setSavedSettings({ ...pendingSettings });
    } else if (savedCount > 0) {
      toast.warning(`${savedCount}/${keys.length} saved`);
      setSavedSettings({ ...pendingSettings });
    } else {
      toast.error('All saves failed');
    }
    setSaving(false);
  }

  function handleDiscard() {
    setPendingSettings({ ...savedSettings });
    toast.info('Changes discarded');
  }

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const settings: SettingDef[] = [
    { key: 'platform_name', label: 'Platform Name', type: 'text', description: 'The name displayed across the app' },
    { key: 'listing_approval_required', label: 'Require Listing Approval', type: 'select', options: [['false', 'No — Listings go live immediately'], ['true', 'Yes — Require admin approval']], description: 'Control whether new listings need approval' },
    { key: 'maintenance_mode', label: 'Maintenance Mode', type: 'select', options: [['false', 'Off — App is open to everyone'], ['true', 'On — Only creator can access']], creatorOnly: true, description: 'When ON, blocks all non-creator users from logging in' },
    { key: 'registration_open', label: 'Allow New Registrations', type: 'select', options: [['true', 'Yes — Anyone can sign up'], ['false', 'No — New signups blocked']], creatorOnly: true, description: 'Control whether new accounts can be created' },
    { key: 'max_listings_per_user', label: 'Max Listings Per User', type: 'select', options: [['3', '3 listings'], ['5', '5 listings'], ['10', '10 listings'], ['20', '20 listings'], ['unlimited', 'Unlimited']], creatorOnly: true, description: 'Maximum listings a single user can post' },
  ];

  const visible = settings.filter(s => !s.creatorOnly || isCreator);

  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-4 flex items-start gap-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        <div>
          <p className="text-xs text-white font-medium">Platform Settings</p>
          <p className="text-[10px] text-[#5C5E72] mt-0.5">{isCreator ? 'Click Save Changes to apply. Password will be required.' : 'Click Save Changes to apply.'}</p>
        </div>
      </div>

      {visible.map(s => {
        const isChanged = pendingSettings[s.key] !== savedSettings[s.key];
        return (
          <div key={s.key} className={`glass rounded-2xl p-4 transition-colors ${isChanged ? 'border border-[#3B82F6]/30 bg-[#3B82F6]/[0.03]' : s.creatorOnly ? 'border border-purple-500/10' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-[#8B8DA0] font-medium">{s.label}</label>
              {s.creatorOnly && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">CREATOR</span>}
              {isChanged && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">CHANGED</span>}
            </div>
            {s.description && <p className="text-[10px] text-[#5C5E72] mb-2">{s.description}</p>}

            {s.type === 'text' ? (
              <input value={pendingSettings[s.key] || ''} onChange={(e) => setPendingSettings(prev => ({ ...prev, [s.key]: e.target.value }))} className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#232330] text-white text-sm px-4 outline-none focus:border-[#3B82F6]" />
            ) : (
              <select value={pendingSettings[s.key] || ''} onChange={(e) => setPendingSettings(prev => ({ ...prev, [s.key]: e.target.value }))} className={`w-full h-10 rounded-xl border text-white text-sm px-4 outline-none ${isChanged ? 'bg-[#3B82F6]/5 border-[#3B82F6]/30' : 'bg-[#1A1A24] border-[#232330]'}`}>
                {s.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}

            <div className="flex items-center gap-2 mt-2">
              <span className="text-[9px] text-[#5C5E72]">Saved: <span className="text-[#8A8B9C]">{s.type === 'select' ? s.options?.find(o => o[0] === savedSettings[s.key])?.[1] || savedSettings[s.key] : savedSettings[s.key]}</span></span>
              {isChanged && <span className="text-[9px] text-amber-400">--&gt; Pending: {s.type === 'select' ? s.options?.find(o => o[0] === pendingSettings[s.key])?.[1] || pendingSettings[s.key] : pendingSettings[s.key]}</span>}
            </div>
          </div>
        );
      })}

      {hasChanges && (
        <div className="flex gap-3 sticky bottom-4 z-10">
          <button onClick={handleSaveAll} disabled={saving} className="flex-1 h-11 rounded-xl bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving...</> : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>Save Changes</>}
          </button>
          <button onClick={handleDiscard} disabled={saving} className="h-11 px-5 rounded-xl bg-[#1A1A24] border border-[#232330] text-[#8A8B9C] text-sm font-medium hover:text-white transition-colors disabled:opacity-50">Discard</button>
        </div>
      )}
    </div>
  );
}

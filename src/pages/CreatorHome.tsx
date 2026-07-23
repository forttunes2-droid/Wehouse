import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getActivityLabel, getActionVerb, parseAuditDetails, formatActivityItem } from '@/lib/activity-formatter';
import type { Profile } from '@/types';

interface CreatorHomeProps {
  profile: Profile;
  onNavigate: (page: string) => void;
}

interface SummaryStats {
  totalUsers: number;
  newUsersToday: number;
  pendingInspections: number;
  pendingVerifications: number;
  activeListings: number;
  openReports: number;
  totalWorkers: number;
  totalPartners: number;
}

export default function CreatorHome({ profile, onNavigate }: CreatorHomeProps) {
  const [stats, setStats] = useState<SummaryStats>({
    totalUsers: 0, newUsersToday: 0, pendingInspections: 0,
    pendingVerifications: 0, activeListings: 0, openReports: 0,
    totalWorkers: 0, totalPartners: 0,
  });
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSummary();
  }, []);

  async function loadSummary() {
    setLoading(true);
    try {
      // Get today's start
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      // Run all counts in parallel
      const [
        { count: totalUsers },
        { count: newUsersToday },
        { count: pendingInspections },
        { count: pendingVerifications },
        { count: activeListings },
        { count: openReports },
        { count: totalWorkers },
        { count: totalPartners },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { head: true, count: 'exact' }).eq('deleted', false),
        supabase.from('profiles').select('*', { head: true, count: 'exact' }).gte('created_at', todayIso),
        supabase.from('conversations').select('*', { head: true, count: 'exact' }).eq('conversation_type', 'partner_inspection').eq('status', 'pending'),
        supabase.from('worker_verifications').select('*', { head: true, count: 'exact' }).eq('status', 'pending'),
        supabase.from('listings').select('*', { head: true, count: 'exact' }).eq('status', 'active'),
        supabase.from('reports').select('*', { head: true, count: 'exact' }).eq('status', 'open'),
        supabase.from('profiles').select('*', { head: true, count: 'exact' }).eq('role', 'worker'),
        supabase.from('profiles').select('*', { head: true, count: 'exact' }).eq('role', 'property_partner'),
      ]);

      setStats({
        totalUsers: totalUsers || 0,
        newUsersToday: newUsersToday || 0,
        pendingInspections: pendingInspections || 0,
        pendingVerifications: pendingVerifications || 0,
        activeListings: activeListings || 0,
        openReports: openReports || 0,
        totalWorkers: totalWorkers || 0,
        totalPartners: totalPartners || 0,
      });

      // Load recent audit log activity — join with profiles to get username
      const { data: activity } = await supabase
        .from('audit_logs')
        .select(`
          action, target_type, target_id, details, admin_id, created_at,
          profiles:admin_id (username)
        `)
        .order('created_at', { ascending: false })
        .limit(10);
      setRecentActivity(activity || []);
    } catch {
      // Silently fail — show zeros
    }
    setLoading(false);
  }

  // Quick shortcut cards
  const shortcuts = [
    { label: 'Management', icon: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', page: 'management', color: 'from-blue-500 to-blue-600' },
    { label: 'Analytics', icon: 'M18 20V10M12 20V4M6 20v-6', page: 'analytics', color: 'from-emerald-500 to-emerald-600' },
    { label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', page: 'creator', color: 'from-violet-500 to-violet-600' },
    { label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', page: 'creator', color: 'from-amber-500 to-amber-600', action: () => onNavigate('creator') },
  ];

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-transparent flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-transparent pb-nav overflow-y-auto scrollable-content">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#1A1029] via-[#12121A] to-[#0A0A0F] px-5 pt-6 pb-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-[#7C3AED] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">Creator Overview</h1>
              <p className="text-[10px] text-[#5C5E72]">@{profile.username} &middot; {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-5 space-y-5 pb-6">
        {/* ── STATS GRID ── */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Users" value={stats.totalUsers} change={`+${stats.newUsersToday} today`} accent="blue" />
          <StatCard label="Active Listings" value={stats.activeListings} accent="emerald" />
          <StatCard label="Pending Inspections" value={stats.pendingInspections} alert={stats.pendingInspections > 0} accent="amber" />
          <StatCard label="Pending Verifications" value={stats.pendingVerifications} alert={stats.pendingVerifications > 0} accent="violet" />
          <StatCard label="Workers" value={stats.totalWorkers} accent="pink" />
          <StatCard label="Partners" value={stats.totalPartners} accent="indigo" />
          <StatCard label="Open Reports" value={stats.openReports} alert={stats.openReports > 0} accent="red" />
          <StatCard label="Platform Status" value="Active" accent="green" />
        </div>

        {/* ── CRITICAL ALERTS ── */}
        {(stats.pendingInspections > 0 || stats.pendingVerifications > 0 || stats.openReports > 0) && (
          <div className="glass rounded-2xl p-4 border border-amber-500/10 bg-amber-500/[0.02]">
            <h3 className="text-xs font-semibold text-amber-400 mb-3 flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" /></svg>
              Action Required
            </h3>
            <div className="space-y-2">
              {stats.pendingInspections > 0 && (
                <button onClick={() => onNavigate('management')} className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#12121A] hover:bg-[#1A1A24] transition-colors text-left">
                  <span className="text-xs text-white">{stats.pendingInspections} property inspection{stats.pendingInspections > 1 ? 's' : ''} pending</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              )}
              {stats.pendingVerifications > 0 && (
                <button onClick={() => onNavigate('management')} className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#12121A] hover:bg-[#1A1A24] transition-colors text-left">
                  <span className="text-xs text-white">{stats.pendingVerifications} worker verification{stats.pendingVerifications > 1 ? 's' : ''} pending</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              )}
              {stats.openReports > 0 && (
                <button onClick={() => onNavigate('management')} className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#12121A] hover:bg-[#1A1A24] transition-colors text-left">
                  <span className="text-xs text-white">{stats.openReports} open report{stats.openReports > 1 ? 's' : ''}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8A8B9C" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── QUICK SHORTCUTS ── */}
        <div>
          <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3">Quick Access</h3>
          <div className="grid grid-cols-2 gap-3">
            {shortcuts.map((s) => (
              <button
                key={s.label}
                onClick={() => s.action ? s.action() : onNavigate(s.page)}
                className={`glass rounded-2xl p-4 text-left card-hover group bg-gradient-to-br ${s.color} bg-opacity-5 border border-white/[0.04]`}
              >
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center mb-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d={s.icon} />
                  </svg>
                </div>
                <p className="text-xs font-semibold text-white">{s.label}</p>
                <p className="text-[10px] text-[#8A8B9C] mt-0.5">Open {s.label.toLowerCase()}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── RECENT ACTIVITY ── */}
        {recentActivity.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-[#5C5E72] uppercase tracking-wider mb-3">Recent Activity</h3>
            <div className="glass rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
              {recentActivity.map((a, i) => {
                const { title, subtitle, meta } = formatActivityItem(a);
                return (
                  <div key={i} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-[#1A1A24] flex items-center justify-center flex-shrink-0">
                      <ActivityIcon action={a.action} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white truncate">{title}</p>
                      {subtitle && <p className="text-[10px] text-[#8A8B9C]">{subtitle}</p>}
                      <p className="text-[9px] text-[#5C5E72]">{meta}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────

function StatCard({ label, value, change, alert, accent }: {
  label: string; value: string | number; change?: string; alert?: boolean; accent: string;
}) {
  const accentMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/10',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/10',
    pink: 'text-pink-400 bg-pink-500/10 border-pink-500/10',
    indigo: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/10',
    red: 'text-red-400 bg-red-500/10 border-red-500/10',
    green: 'text-green-400 bg-green-500/10 border-green-500/10',
  };
  const classes = accentMap[accent] || accentMap.blue;

  return (
    <div className={`glass rounded-2xl p-4 border ${alert ? 'border-amber-500/20' : 'border-white/[0.04]'}`}>
      <p className="text-[10px] text-[#5C5E72] mb-1">{label}</p>
      <p className={`text-xl font-bold ${classes.split(' ')[0]}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {change && <p className="text-[9px] text-emerald-400 mt-0.5">{change}</p>}
      {alert && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 animate-pulse" />}
    </div>
  );
}

function ActivityIcon({ action }: { action: string }) {
  // Non-interactive status icons — NOT edit buttons
  const color = action === 'UPDATE' ? '#3B82F6' : action === 'INSERT' ? '#10B981' : action === 'DELETE' ? '#EF4444' : '#8A8B9C';
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
      {action === 'UPDATE' ? <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" opacity="0.3" /></> :
       action === 'INSERT' ? <><path d="M12 5v14M5 12h14" /></> :
       action === 'DELETE' ? <><path d="M18 6L6 18M6 6l12 12" /></> :
       <><circle cx="12" cy="12" r="3" /></>}
    </svg>
  );
}

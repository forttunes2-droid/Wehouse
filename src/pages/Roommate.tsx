import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import DualRangeSlider from '@/components/DualRangeSlider';
import {
  checkSearchExpiry,
  getSavedMatchResults,
  refreshRoommateSearch,
  saveRoommatePreferences,
  startRoommateSearch,
  stopRoommateSearch,
  updateMatchStatus,
} from '@/lib/supabase';
import type { Profile, RoommatePreferences } from '@/types';

type Props = { profile: Profile; onGoToChat?: (conversationId: string) => void; onEditProfile?: () => void };
type FormState = {
  gender_preference: 'male' | 'female' | 'no_preference';
  budget_min: number;
  budget_max: number;
  cleanliness: string;
  noise_level: string;
  sleep_time: string;
  visitors: string;
  stay_duration: string;
  area_preference: string;
  bio: string;
  campus: string;
  level: string;
  department: string;
};

const FLOOR = 180000;
const CEILING = 5000000;
const STEP = 10000;
const DEFAULT_FORM: FormState = {
  gender_preference: 'no_preference',
  budget_min: 180000,
  budget_max: 500000,
  cleanliness: 'moderate',
  noise_level: 'moderate',
  sleep_time: '10pm-11pm',
  visitors: 'sometimes',
  stay_duration: '1_year',
  area_preference: '',
  bio: '',
  campus: '',
  level: '',
  department: '',
};

export default function Roommate({ profile, onGoToChat, onEditProfile }: Props) {
  const [prefs, setPrefs] = useState<RoommatePreferences | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  const branch = [profile.state, profile.local_government || profile.city].filter(Boolean).join(' / ');
  const eligible = profile.role === 'user' && Boolean(profile.profile_complete && profile.id_verified && profile.gender && branch);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ prefs: current }, { matches: currentMatches }] = await Promise.all([
      checkSearchExpiry(),
      profile.id_verified ? getSavedMatchResults() : Promise.resolve({ matches: [], error: null }),
    ]);
    setPrefs(current);
    setMatches(currentMatches || []);
    if (current) {
      setForm({
        gender_preference: (current.gender_preference as FormState['gender_preference']) || 'no_preference',
        budget_min: Math.max(FLOOR, Number(current.budget_min || FLOOR)),
        budget_max: Math.max(FLOOR + STEP, Number(current.budget_max || 500000)),
        cleanliness: current.cleanliness || 'moderate',
        noise_level: current.noise_level || 'moderate',
        sleep_time: current.sleep_time || '10pm-11pm',
        visitors: current.visitors || 'sometimes',
        stay_duration: current.stay_duration || '1_year',
        area_preference: current.area_preference || '',
        bio: current.bio || '',
        campus: current.campus || '',
        level: (current as any).level || '',
        department: (current as any).department || '',
      });
    }
    setLoading(false);
  }, [profile.id_verified]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (prefs?.search_status !== 'active' || !prefs.search_expires_at) { setTimeLeft(''); return; }
    const tick = () => {
      const diff = new Date(prefs.search_expires_at as string).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft('Expired'); void load(); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m`);
    };
    tick();
    const timer = window.setInterval(tick, 60000);
    return () => window.clearInterval(timer);
  }, [prefs?.search_status, prefs?.search_expires_at, load]);

  async function save() {
    if (!profile.gender) return toast.error('Add your gender to your profile first');
    setSaving(true);
    const { prefs: saved, error } = await saveRoommatePreferences({
      ...form,
      gender: profile.gender,
      school_name: profile.school || null,
      active: true,
    } as any);
    setSaving(false);
    if (error || !saved) return toast.error(error?.message || 'Could not save roommate preferences');
    setPrefs(saved);
    setEditing(false);
    toast.success('Roommate preferences saved');
  }

  async function start() {
    if (!prefs) { setEditing(true); return; }
    if (!eligible) return toast.error('Complete and verify your profile before starting roommate search');
    setSearching(true);
    const { prefs: active, error } = await startRoommateSearch();
    if (error || !active) { setSearching(false); return toast.error(error?.message || 'Could not start roommate search'); }
    const result = await refreshRoommateSearch();
    setPrefs(active);
    setMatches(result.matches || []);
    setSearching(false);
    toast.success(result.matches?.length ? `${result.matches.length} compatible match${result.matches.length === 1 ? '' : 'es'} found` : 'Search started');
  }

  async function stop() {
    setSearching(true);
    const { prefs: stopped, error } = await stopRoommateSearch();
    setSearching(false);
    if (error) return toast.error(error.message);
    setPrefs(stopped);
    toast.success('Roommate search stopped');
  }

  async function refresh() {
    if (prefs?.search_status !== 'active') return;
    setSearching(true);
    const result = await refreshRoommateSearch();
    setSearching(false);
    if (result.error) return toast.error(result.error.message);
    setMatches(result.matches || []);
  }

  async function setMatch(match: any, status: 'accepted' | 'declined') {
    const { conversationId, error } = await updateMatchStatus(match.id, status);
    if (error) return toast.error(error.message);
    if (conversationId) {
      toast.success('It is a mutual match. Chat is now available.');
      await load();
      if (onGoToChat) onGoToChat(conversationId);
      return;
    }
    await load();
    toast.success(status === 'accepted' ? 'Interest saved. Chat opens only if they accept you too.' : 'Match removed');
  }

  const visibleMatches = useMemo(() => matches.filter(m => m.status !== 'declined'), [matches]);

  if (loading) return <div className="grid min-h-[60vh] place-items-center bg-[#09090D] text-xs text-[#777B8D]">Loading roommate workspace…</div>;

  return (
    <div className="min-h-[100dvh] bg-[#09090D] pb-24 text-white">
      <Toaster position="top-center" richColors />
      <header className="border-b border-white/[0.06] bg-[#0D0E14] px-4 py-5 sm:px-5">
        <div className="mx-auto max-w-5xl">
          <p className="text-[9px] font-bold tracking-[.2em] text-blue-400">ROOMMATE MATCHING</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h1 className="text-xl font-bold">Find a compatible roommate</h1><p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#777B8D]">Verified users are matched inside the same State and Local Government using mutual preferences, budget and lifestyle compatibility.</p></div>
            {prefs && <button onClick={() => setEditing(v => !v)} className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-semibold text-[#C8CAD4]">{editing ? 'Close preferences' : 'Edit preferences'}</button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-5 lg:py-7">
        <section className="grid gap-3 sm:grid-cols-3">
          <StatusCard label="Identity" value={profile.id_verified ? 'Verified' : 'Verification required'} good={Boolean(profile.id_verified)} />
          <StatusCard label="Matching area" value={branch || 'Set State and LGA'} good={Boolean(branch)} />
          <StatusCard label="Search" value={prefs?.search_status === 'active' ? `Active${timeLeft ? ` · ${timeLeft}` : ''}` : labelStatus(prefs?.search_status)} good={prefs?.search_status === 'active'} />
        </section>

        {!eligible && (
          <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-amber-300">Complete your roommate eligibility first</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[#A1A3B1]">Roommate discovery requires a regular User account, completed profile, verified identity, gender, State and Local Government. This prevents unverified profiles from seeing roommate candidates.</p>
            {onEditProfile && <button onClick={onEditProfile} className="mt-3 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-semibold text-[#1A1404]">Open profile</button>}
          </section>
        )}

        {(!prefs || editing) && (
          <PreferencesForm profile={profile} form={form} setForm={setForm} saving={saving} onSave={save} onCancel={prefs ? () => setEditing(false) : undefined} />
        )}

        {prefs && !editing && (
          <>
            <section className="rounded-3xl border border-blue-500/15 bg-gradient-to-br from-blue-500/[0.09] to-[#11131B] p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-blue-300">Your preferences</p><h2 className="mt-2 text-lg font-bold">₦{Number(prefs.budget_min).toLocaleString()} – ₦{Number(prefs.budget_max).toLocaleString()}</h2><p className="mt-1 text-[11px] text-[#777B8D]">{genderLabel(prefs.gender_preference)} roommate · {prefs.cleanliness || 'moderate'} cleanliness · {prefs.noise_level || 'moderate'} environment</p></div>
                <div className="flex flex-wrap gap-2">{prefs.search_status === 'active' ? <><button onClick={() => void refresh()} disabled={searching} className="rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold disabled:opacity-50">{searching ? 'Checking…' : 'Refresh matches'}</button><button onClick={() => void stop()} disabled={searching} className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-semibold text-[#C8CAD4]">Stop search</button></> : <button onClick={() => void start()} disabled={searching || !eligible} className="rounded-xl bg-blue-500 px-5 py-2.5 text-xs font-semibold disabled:opacity-40">{searching ? 'Starting…' : 'Start roommate search'}</button>}</div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3"><div><h2 className="text-base font-bold">Matches</h2><p className="mt-1 text-[10px] text-[#666A7B]">A chat is created only after both users accept the match.</p></div><span className="text-xs font-semibold text-blue-300">{visibleMatches.length}</span></div>
              {visibleMatches.length === 0 ? <Empty title={prefs.search_status === 'active' ? 'No compatible match yet' : 'No saved matches'} text={prefs.search_status === 'active' ? 'Your search remains active. New eligible users in your LGA can appear here.' : 'Start a search when you are ready to find a roommate.'} /> : <div className="grid gap-3 md:grid-cols-2">{visibleMatches.map(match => <MatchCard key={match.id} match={match} onAccept={() => void setMatch(match, 'accepted')} onDecline={() => void setMatch(match, 'declined')} onChat={match.conversation_id && onGoToChat ? () => onGoToChat(match.conversation_id) : undefined} />)}</div>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function PreferencesForm({ profile, form, setForm, saving, onSave, onCancel }: { profile: Profile; form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; saving: boolean; onSave: () => void; onCancel?: () => void }) {
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(current => ({ ...current, [key]: value }));
  return <section className="rounded-3xl border border-white/[0.07] bg-[#11131B] p-4 sm:p-6"><div className="mb-5"><h2 className="text-base font-bold">Roommate preferences</h2><p className="mt-1 text-[10px] text-[#6B6F80]">Your identity, gender and branch location come from your main profile. Only roommate-specific choices live here.</p></div><div className="space-y-6"><Group title="Preferred roommate"><Choice value={form.gender_preference} options={[['no_preference','No preference'],['male','Male'],['female','Female']]} onChange={v => update('gender_preference', v as FormState['gender_preference'])} /></Group><Group title="Housing budget"><DualRangeSlider min={form.budget_min} max={form.budget_max} floor={FLOOR} ceiling={CEILING} step={STEP} onChange={(min,max) => setForm(current => ({ ...current, budget_min:min, budget_max:max }))} /></Group><div className="grid gap-5 sm:grid-cols-2"><Group title="Cleanliness"><Choice value={form.cleanliness} options={[['neat','Neat'],['moderate','Moderate'],['relaxed','Relaxed']]} onChange={v => update('cleanliness',v)} /></Group><Group title="Noise"><Choice value={form.noise_level} options={[['quiet','Quiet'],['moderate','Moderate'],['loud','Social']]} onChange={v => update('noise_level',v)} /></Group><Group title="Sleep time"><Choice value={form.sleep_time} options={[['9pm-10pm','Early'],['10pm-11pm','Normal'],['11pm-12am','Late'],['12am-1am','Night owl']]} onChange={v => update('sleep_time',v)} /></Group><Group title="Visitors"><Choice value={form.visitors} options={[['rarely','Rarely'],['sometimes','Sometimes'],['often','Often']]} onChange={v => update('visitors',v)} /></Group></div><Group title="Expected stay"><Choice value={form.stay_duration} options={[['3_months','3 months'],['6_months','6 months'],['1_year','1 year'],['1_year+','1+ years']]} onChange={v => update('stay_duration',v)} /></Group><div className="grid gap-4 sm:grid-cols-2"><Field label="Preferred area within your LGA (optional)" value={form.area_preference} onChange={v => update('area_preference',v)} placeholder="e.g. Shabu, Bukan Sidi" /><Field label="Campus (optional)" value={form.campus} onChange={v => update('campus',v)} placeholder={profile.school ? `Campus for ${profile.school}` : 'Campus'} /><Field label="Level (optional)" value={form.level} onChange={v => update('level',v)} placeholder="e.g. ND1, 200L" /><Field label="Department (optional)" value={form.department} onChange={v => update('department',v)} placeholder="e.g. Forestry" /></div><label className="block"><span className="mb-1.5 block text-[10px] font-medium text-[#7B7F90]">About your roommate preferences (optional)</span><textarea value={form.bio} onChange={e => update('bio',e.target.value)} rows={4} placeholder="Anything important a compatible roommate should know" className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#181A23] p-3 text-xs outline-none focus:border-blue-500/40" /></label><div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{onCancel && <button onClick={onCancel} className="rounded-xl border border-white/[0.08] px-5 py-3 text-xs font-semibold text-[#AEB1BF]">Cancel</button>}<button onClick={onSave} disabled={saving} className="rounded-xl bg-blue-500 px-6 py-3 text-xs font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save preferences'}</button></div></div></section>;
}

function MatchCard({ match, onAccept, onDecline, onChat }: { match:any; onAccept:()=>void; onDecline:()=>void; onChat?:()=>void }) { const p=match.matched_profile||{}; return <article className="rounded-2xl border border-white/[0.06] bg-[#11131B] p-4"><div className="flex items-start gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-blue-500/15 text-sm font-bold text-blue-300">{p.avatar_url?<img src={p.avatar_url} alt="" className="h-full w-full object-cover"/>:(p.username||'U')[0].toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h3 className="truncate text-sm font-semibold">{p.full_name||`@${p.username||'user'}`}</h3><p className="mt-0.5 text-[10px] text-[#6D7182]">@{p.username||'user'} · {p.city||p.state||'Your LGA'}</p></div><span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300">{match.match_score}%</span></div>{p.school&&<p className="mt-2 text-[10px] text-[#858999]">{p.school}</p>}{p.bio&&<p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-[#737787]">{p.bio}</p>}</div></div><div className="mt-4">{match.conversation_id&&onChat?<button onClick={onChat} className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-[#06120C]">Open roommate chat</button>:match.status==='accepted'?<div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2.5 text-center text-[10px] text-amber-300">Accepted · waiting for them to accept you</div>:<div className="grid grid-cols-2 gap-2"><button onClick={onDecline} className="rounded-xl border border-white/[0.08] px-3 py-2.5 text-[10px] font-semibold text-[#9295A4]">Not interested</button><button onClick={onAccept} className="rounded-xl bg-blue-500 px-3 py-2.5 text-[10px] font-semibold">Interested</button></div>}</div></article>; }
function StatusCard({label,value,good}:{label:string;value:string;good:boolean}){return <div className="rounded-2xl border border-white/[0.06] bg-[#11131B] p-4"><p className="text-[9px] uppercase tracking-wide text-[#626678]">{label}</p><p className={`mt-2 text-xs font-semibold ${good?'text-emerald-300':'text-amber-300'}`}>{value}</p></div>}
function Group({title,children}:{title:string;children:React.ReactNode}){return <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#6F7384]">{title}</p>{children}</div>}
function Choice({value,options,onChange}:{value:string;options:[string,string][];onChange:(v:string)=>void}){return <div className="flex flex-wrap gap-2">{options.map(([id,label])=><button type="button" key={id} onClick={()=>onChange(id)} className={`rounded-xl px-3 py-2 text-[10px] font-semibold ${value===id?'bg-blue-500 text-white':'border border-white/[0.07] bg-[#181A23] text-[#9296A6]'}`}>{label}</button>)}</div>}
function Field({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder?:string}){return <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-[#7B7F90]">{label}</span><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#181A23] px-3 text-xs outline-none focus:border-blue-500/40"/></label>}
function Empty({title,text}:{title:string;text:string}){return <div className="rounded-2xl border border-dashed border-white/[0.08] px-6 py-12 text-center"><p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-relaxed text-[#686C7D]">{text}</p></div>}
function genderLabel(value?:string|null){return value==='male'?'Male':value==='female'?'Female':'Any'}
function labelStatus(value?:string|null){if(value==='expired')return 'Expired';if(value==='stopped')return 'Stopped';return 'Not active'}

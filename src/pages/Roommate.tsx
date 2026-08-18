import { useCallback,useEffect,useState } from 'react';
import { Toaster,toast } from 'sonner';
import { checkSearchExpiry,getSavedMatchResults,refreshRoommateSearch,saveRoommatePreferences,startRoommateSearch,stopRoommateSearch,updateMatchStatus } from '@/lib/supabase';
import RoommatePreferencesPanel from '@/components/RoommatePreferencesPanel';
import DiscoveryShell from '@/components/DiscoveryShell';
import type { Profile,RoommatePreferences } from '@/types';

type Props={profile:Profile;onGoToChat?:(id:string)=>void;onEditProfile?:()=>void};
type Form={gender_preference:string;budget_min:number;budget_max:number;cleanliness:string;noise_level:string;visitors:string;stay_duration:string;area_preference:string;school_name:string;school_match:boolean};
const EMPTY:Form={gender_preference:'no_preference',budget_min:180000,budget_max:500000,cleanliness:'moderate',noise_level:'moderate',visitors:'sometimes',stay_duration:'1_year',area_preference:'',school_name:'',school_match:false};
const MATCH_PAGE_SIZE=24;

export default function RoommateWorkspace({profile,onGoToChat,onEditProfile}:Props){
 const[prefs,setPrefs]=useState<RoommatePreferences|null>(null),[matches,setMatches]=useState<any[]>([]),[hasMore,setHasMore]=useState(false),[form,setForm]=useState<Form>({...EMPTY,school_name:profile.school||''}),[editing,setEditing]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[loadingMore,setLoadingMore]=useState(false);
 const profileReady=profile.role==='user'&&Boolean(profile.profile_complete)&&Boolean(profile.gender)&&Boolean(profile.state);
 const discoveryAllowed=profile.privacy_search_visible!==false&&profile.privacy_profile_visible!==false;
 const canMatch=profileReady&&discoveryAllowed;
 const location=[profile.local_government||profile.city,profile.state].filter(Boolean).join(', ');
 const matchingActive=prefs?.search_status==='active'&&prefs?.active!==false&&discoveryAllowed;
 const matchingLabel=matchingActive?'Active':prefs?'Paused':'Set preferences';

 const load=useCallback(async()=>{setLoading(true);const{prefs:p}=await checkSearchExpiry();let rows:any[]=[];let more=false;if(p?.search_status==='active'&&discoveryAllowed){const result=await getSavedMatchResults(MATCH_PAGE_SIZE,0).catch(()=>({matches:[],hasMore:false,error:null}));rows=result.matches||[];more=Boolean(result.hasMore)}setPrefs(p);setMatches(rows);setHasMore(more);if(p)setForm({gender_preference:p.gender_preference||'no_preference',budget_min:Number(p.budget_min||180000),budget_max:Number(p.budget_max||500000),cleanliness:p.cleanliness||'moderate',noise_level:p.noise_level||'moderate',visitors:p.visitors||'sometimes',stay_duration:p.stay_duration||'1_year',area_preference:'',school_name:p.school_name||profile.school||'',school_match:Boolean(p.school_match)});setLoading(false)},[profile.school,discoveryAllowed]);
 useEffect(()=>{void load()},[load]);

 function applyResult(result:{matches?:any[];hasMore?:boolean}){setMatches(result.matches||[]);setHasMore(Boolean(result.hasMore))}
 async function save(){
  if(!profileReady)return toast.error('Add your gender and State in Personal details first');
  if(!discoveryAllowed)return toast.error('Turn on Roommate discovery and profile visibility in Privacy first');
  if(form.school_match&&!form.school_name.trim())return toast.error('Enter your school first');
  setBusy(true);
  const{prefs:p,error}=await saveRoommatePreferences({...form,gender:profile.gender,active:true} as any);
  if(error||!p){setBusy(false);return toast.error(error?.message||'Could not save preferences')}
  setPrefs(p);setEditing(false);
  if(p.search_status==='active'){
   const result=await refreshRoommateSearch();
   if(!result.error)applyResult(result);
  }
  setBusy(false);
 }
 async function start(){if(!canMatch)return toast.error('Complete your profile and Roommate privacy settings first');setBusy(true);const{prefs:p,error}=await startRoommateSearch();if(error||!p){setBusy(false);return toast.error(error?.message||'Could not start matching')}const result=await refreshRoommateSearch();setBusy(false);setPrefs(p);if(result.error)return toast.error(result.error.message);applyResult(result)}
 async function refresh(){if(busy)return;setBusy(true);const result=await refreshRoommateSearch();setBusy(false);if(result.error)return toast.error(result.error.message);applyResult(result)}
 async function loadMore(){if(loadingMore||!hasMore)return;setLoadingMore(true);const result=await getSavedMatchResults(MATCH_PAGE_SIZE,matches.length);setLoadingMore(false);if(result.error)return toast.error(result.error.message);setMatches(current=>{const seen=new Set(current.map(row=>row.id));return [...current,...result.matches.filter((row:any)=>!seen.has(row.id))]});setHasMore(Boolean(result.hasMore))}
 async function stop(){const{prefs:p,error}=await stopRoommateSearch();if(error)return toast.error(error.message);setPrefs(p);setMatches([]);setHasMore(false);toast.success('Matching paused. Your existing roommate chats are still in Messages.')}
 async function interest(match:any,status:'accepted'|'viewed'){const{conversationId,error}=await updateMatchStatus(match.id,status);if(error)return toast.error(error.message);if(status==='viewed'){setMatches(current=>current.filter(row=>row.id!==match.id));toast.success('Moved down for now. Refresh matches to see this compatible profile again.');return}await load();if(conversationId)onGoToChat?.(conversationId)}
 function navigate(page:string){try{localStorage.setItem('wh_navpage',page);window.history.pushState({page},'',`#${page}`);window.dispatchEvent(new PopStateEvent('popstate',{state:{page}}))}catch{window.location.hash=page}}
 if(loading)return <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F] text-xs text-[#777B8D]">Loading roommates…</div>;

 return <DiscoveryShell active="roommates" title="Roommates" description="Set your preferences and find compatible people in your area." onNavigate={navigate}>
  <Toaster position="top-center" richColors/>
  <main className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
   <header className="border-b border-white/[.07] pb-5">
    <div className="flex items-end justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-violet-300">ROOMMATE DISCOVERY</p><h1 className="mt-2 text-2xl font-bold">Find someone compatible</h1></div><span className={`shrink-0 text-[10px] font-semibold ${matchingActive?'text-emerald-300':'text-[#777D8D]'}`}>{matchingLabel}</span></div>
    <p className="mt-2 text-[10px] text-[#73798A]">{location||'Set your location'} · {prefs?'Preferences saved':'Preferences required'}</p>
   </header>

   {!profileReady&&<section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4"><p className="text-sm font-semibold">Add the basics first</p><p className="mt-1 text-[10px] text-[#9A9EAD]">Roommate matching needs your gender and State so it can apply your preferences correctly.</p>{onEditProfile&&<button onClick={onEditProfile} className="mt-3 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white">Open personal details</button>}</section>}
   {profileReady&&!discoveryAllowed&&<section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4"><p className="text-sm font-semibold">Roommate discovery is private</p><p className="mt-1 text-[10px] text-[#9A9EAD]">Turn on Roommate discovery and profile visibility before your profile can enter matching.</p><button onClick={()=>navigate('privacy')} className="mt-3 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white">Open Privacy</button></section>}

   {(!prefs||editing)?<RoommatePreferencesPanel form={form} setForm={setForm} profileSchool={profile.school} busy={busy} onSave={save} onCancel={prefs?()=>setEditing(false):undefined}/>:<>
    <section className="border-b border-white/[.07] pb-5">
     <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#6F7585]">Your match range</p><p className="mt-1 text-lg font-bold">₦{Number(prefs.budget_min).toLocaleString()} – ₦{Number(prefs.budget_max).toLocaleString()}</p>{prefs.school_match&&<p className="mt-2 text-[10px] text-violet-300">Same school · {prefs.school_name}</p>}</div><span className={`rounded-full px-2.5 py-1 text-[8px] font-bold ${matchingActive?'bg-emerald-500/10 text-emerald-300':'bg-white/[.05] text-[#7B8190]'}`}>{matchingActive?'MATCHING ON':'PAUSED'}</span></div>
     <div className="mt-4 grid grid-cols-2 gap-2 sm:flex"><button onClick={()=>setEditing(true)} className="min-h-11 rounded-xl border border-white/[.08] px-4 text-xs">Edit preferences</button>{matchingActive?<><button onClick={()=>void refresh()} disabled={busy} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs disabled:opacity-40">{busy?'Refreshing…':'Refresh matches'}</button><button onClick={()=>void stop()} className="col-span-2 min-h-11 rounded-xl border border-white/[.08] px-4 text-xs">Pause matching</button></>:<button onClick={()=>void start()} disabled={!canMatch||busy} className="min-h-11 rounded-xl bg-violet-500 px-4 text-xs disabled:opacity-40">{busy?'Resuming…':'Resume matching'}</button>}</div>
    </section>
    {matchingActive?<Matches rows={matches} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} onChat={onGoToChat} onInterest={interest}/>:<section className="py-12 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-violet-500/[.08] text-xl text-violet-300">Ⅱ</div><p className="mt-4 text-base font-semibold">Matching is paused</p><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#686D7E]">Your preferences remain saved and existing conversations stay in Messages. Resume only when you want new profiles.</p></section>}
   </>}
  </main>
 </DiscoveryShell>
}

function matchLabel(score:number){if(score>=85)return'Best';if(score>=70)return'Strong';if(score>=55)return'Good';return'Possible'}
const SCORE_FACTORS=[['Budget',30],['Location',20],['Cleanliness',15],['Noise',15],['Visitors',10],['Stay length',10]] as const;
function Matches({rows,hasMore,loadingMore,onLoadMore,onChat,onInterest}:{rows:any[];hasMore:boolean;loadingMore:boolean;onLoadMore:()=>void;onChat?:((id:string)=>void);onInterest:(row:any,status:'accepted'|'viewed')=>void}){return <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Best matches</h2><p className="mt-1 text-[9px] text-[#6A7080]">Ranked by compatibility. “Skip for now” only moves a profile down until you refresh.</p></div><span className="text-[9px] font-semibold text-violet-300">{rows.length} found</span></div>{rows.length?<><div className="divide-y divide-white/[.065] border-y border-white/[.065]">{rows.map(row=>{const p=row.matched_profile||{},score=Number(row.match_score||0);return <article key={row.id} className="py-4"><div className="flex items-start gap-3">{p.avatar_url?<img src={p.avatar_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover"/>:<div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-violet-500/15 text-lg font-bold text-violet-200">{String(p.full_name||p.username||'W')[0].toUpperCase()}</div>}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold">{p.full_name||`@${p.username||'user'}`}</p><p className="mt-1 truncate text-[9px] text-[#737889]">{[p.city,p.state].filter(Boolean).join(', ')||'Nigeria'}{p.school?` · ${p.school}`:''}</p></div><div className="shrink-0 text-right"><p className="text-xl font-bold text-violet-300">{score}%</p><p className="text-[8px] font-semibold text-[#777D8D]">{matchLabel(score)} match</p></div></div>{p.bio&&<p className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-[#8A90A0]">{p.bio}</p>}</div></div><details className="mt-3 border-y border-white/[.05] py-2"><summary className="cursor-pointer list-none text-[9px] font-semibold text-[#A8ADBA]">Why this score <span className="ml-1 text-violet-300">›</span></summary><div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">{SCORE_FACTORS.map(([name,weight])=>{const key=name==='Stay length'?'stay':name.toLowerCase();const earned=Number(p.score_factors?.[key]||0);return <div key={name} className="flex items-center justify-between border-b border-white/[.04] pb-1 text-[8px]"><span className="text-[#666D7E]">{name}</span><span className="font-semibold text-[#AEB3C0]">{earned} / {weight}</span></div>})}</div><p className="mt-2 text-[8px] leading-relaxed text-[#5F6676]">Your {score}% is the sum of the six values above: overlapping budget, same area and compatible living preferences. Gender and optional same-school rules are eligibility gates, not bonus points.</p></details><div className="mt-3 flex gap-2">{row.conversation_id?<button onClick={()=>onChat?.(row.conversation_id)} className="min-h-11 w-full rounded-xl bg-violet-500 text-xs font-semibold">Open chat</button>:<><button onClick={()=>void onInterest(row,'accepted')} className="min-h-11 flex-1 rounded-xl bg-violet-500 text-xs font-semibold">I’m interested</button><button onClick={()=>void onInterest(row,'viewed')} className="min-h-11 rounded-xl border border-white/[.08] px-4 text-[10px] font-semibold">Skip for now</button></>}</div></article>})}</div>{hasMore&&<div className="mt-4 flex justify-center"><button type="button" disabled={loadingMore} onClick={()=>void onLoadMore()} className="min-h-11 rounded-xl border border-white/[.08] px-5 text-xs font-semibold text-[#D0D4DE] disabled:opacity-50">{loadingMore?'Loading more…':'Show more matches'}</button></div>}</>:<div className="border-y border-white/[.065] px-3 py-12 text-center"><p className="text-sm font-semibold">No compatible matches yet</p><p className="mt-1 text-[10px] text-[#686D7E]">Refresh after compatible active profiles enter your range.</p></div>}</section>}

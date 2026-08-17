import { useCallback,useEffect,useState } from 'react';
import { Toaster,toast } from 'sonner';
import { checkSearchExpiry,getSavedMatchResults,refreshRoommateSearch,saveRoommatePreferences,startRoommateSearch,stopRoommateSearch,updateMatchStatus } from '@/lib/supabase';
import { RoommateInfo } from '@/components/RoommateChoices';
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
 async function interest(match:any,status:'accepted'|'declined'){const{conversationId,error}=await updateMatchStatus(match.id,status);if(error)return toast.error(error.message);await load();if(conversationId)onGoToChat?.(conversationId)}
 function navigate(page:string){try{localStorage.setItem('wh_navpage',page);window.history.pushState({page},'',`#${page}`);window.dispatchEvent(new PopStateEvent('popstate',{state:{page}}))}catch{window.location.hash=page}}
 if(loading)return <div className="grid min-h-[70dvh] place-items-center bg-[#0A0A0F] text-xs text-[#777B8D]">Loading roommates…</div>;

 return <DiscoveryShell active="roommates" title="Roommates" description="Set your preferences and find compatible people in your area." onNavigate={navigate}>
  <Toaster position="top-center" richColors/>
  <main className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
   <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <RoommateInfo label="Location" value={location||'Not set'}/>
    <RoommateInfo label="Matching" value={matchingLabel}/>
    <div className="col-span-2 sm:col-span-1"><RoommateInfo label="Preferences" value={prefs?'Saved':'Not set'}/></div>
   </div>

   {!profileReady&&<section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4"><p className="text-sm font-semibold">Add the basics first</p><p className="mt-1 text-[10px] text-[#9A9EAD]">Roommate matching needs your gender and State so it can apply your preferences correctly.</p>{onEditProfile&&<button onClick={onEditProfile} className="mt-3 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white">Open personal details</button>}</section>}
   {profileReady&&!discoveryAllowed&&<section className="rounded-2xl border border-amber-500/15 bg-amber-500/[.05] p-4"><p className="text-sm font-semibold">Roommate discovery is private</p><p className="mt-1 text-[10px] text-[#9A9EAD]">Turn on Roommate discovery and profile visibility before your profile can enter matching.</p><button onClick={()=>navigate('privacy')} className="mt-3 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold text-white">Open Privacy</button></section>}

   {(!prefs||editing)?<RoommatePreferencesPanel form={form} setForm={setForm} profileSchool={profile.school} busy={busy} onSave={save} onCancel={prefs?()=>setEditing(false):undefined}/>:<>
    <section className="rounded-2xl border border-white/[.07] bg-[#11141C] p-4">
     <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#6F7585]">Your match range</p><p className="mt-1 text-lg font-bold">₦{Number(prefs.budget_min).toLocaleString()} – ₦{Number(prefs.budget_max).toLocaleString()}</p>{prefs.school_match&&<p className="mt-2 text-[10px] text-violet-300">Same school · {prefs.school_name}</p>}</div><span className={`rounded-full px-2.5 py-1 text-[8px] font-bold ${matchingActive?'bg-emerald-500/10 text-emerald-300':'bg-white/[.05] text-[#7B8190]'}`}>{matchingActive?'MATCHING ON':'PAUSED'}</span></div>
     <div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>setEditing(true)} className="rounded-xl border border-white/[.08] px-4 py-2.5 text-xs">Edit preferences</button>{matchingActive?<><button onClick={()=>void refresh()} disabled={busy} className="rounded-xl bg-violet-500 px-4 py-2.5 text-xs disabled:opacity-40">{busy?'Refreshing…':'Refresh matches'}</button><button onClick={()=>void stop()} className="rounded-xl border border-white/[.08] px-4 py-2.5 text-xs">Pause matching</button></>:<button onClick={()=>void start()} disabled={!canMatch||busy} className="rounded-xl bg-violet-500 px-4 py-2.5 text-xs disabled:opacity-40">Resume matching</button>}</div>
    </section>
    {matchingActive?<Matches rows={matches} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} onChat={onGoToChat} onInterest={interest}/>:<section className="rounded-2xl border border-dashed border-white/[.08] p-8 text-center"><p className="text-sm font-semibold">Matching is paused</p><p className="mt-1 text-[10px] text-[#686D7E]">Your preferences are saved. Existing roommate conversations stay in Messages; resume only when you want new matches again.</p></section>}
   </>}
  </main>
 </DiscoveryShell>
}

function matchLabel(score:number){if(score>=75)return'Strong';if(score>=55)return'Good';return'Possible'}
function Matches({rows,hasMore,loadingMore,onLoadMore,onChat,onInterest}:{rows:any[];hasMore:boolean;loadingMore:boolean;onLoadMore:()=>void;onChat?:((id:string)=>void);onInterest:(row:any,status:'accepted'|'declined')=>void}){const visible=rows.filter(row=>row.status!=='declined');return <section><div className="mb-3"><h2 className="text-lg font-bold">Matches</h2><p className="mt-1 text-[9px] text-[#6A7080]">Best compatible active profiles first. More results load only when you ask for them.</p></div>{visible.length?<><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(row=>{const p=row.matched_profile||{},score=Number(row.match_score||0);return <article key={row.id} className="rounded-2xl border border-white/[.07] bg-[#11141C] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{p.full_name||`@${p.username||'user'}`}</p><p className="mt-1 text-[10px] text-[#737889]">{[p.city,p.state].filter(Boolean).join(', ')||'Nigeria'}</p>{p.school&&<p className="mt-1 text-[9px] text-violet-300/80">{p.school}</p>}</div><div className="text-right"><span className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-300">{score}%</span><p className="mt-1 text-[8px] font-semibold text-[#777D8D]">{matchLabel(score)} match</p></div></div><div className="mt-4 flex gap-2">{row.conversation_id?<button onClick={()=>onChat?.(row.conversation_id)} className="w-full rounded-xl bg-violet-500 py-2.5 text-xs">Chat</button>:<><button onClick={()=>void onInterest(row,'accepted')} className="flex-1 rounded-xl bg-violet-500 py-2.5 text-xs">Interested</button><button onClick={()=>void onInterest(row,'declined')} className="rounded-xl border border-white/[.08] px-4 text-xs">Skip</button></>}</div></article>})}</div>{hasMore&&<div className="mt-4 flex justify-center"><button type="button" disabled={loadingMore} onClick={()=>void onLoadMore()} className="min-h-11 rounded-xl border border-white/[.08] bg-white/[.025] px-5 text-xs font-semibold text-[#D0D4DE] disabled:opacity-50">{loadingMore?'Loading more…':'Show more matches'}</button></div>}</>:<div className="rounded-2xl border border-dashed border-white/[.08] p-10 text-center"><p className="text-sm font-semibold">No compatible matches yet</p><p className="mt-1 text-[10px] text-[#686D7E]">We’ll show people here as compatible active profiles become available.</p></div>}</section>}

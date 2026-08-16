import { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import WorkerIdentityCheck from '@/components/WorkerIdentityCheck';
import WorkerReadinessTest from '@/components/WorkerReadinessTest';
import WorkerVerificationChecklist from '@/components/WorkerVerificationChecklist';
import { supabase } from '@/lib/supabase';
import { verifyPaymentWithRetry } from '@/lib/supabase/payment-verify';
import type { Profile } from '@/types';

type Props = { profile: Profile; onBack: () => void };
type Activation = {
  worker_status: string; live: boolean; profile_complete: boolean; payment_confirmed?: boolean; gold_badge?: boolean;
  identity_status: string; identity_passed: boolean; test_passed: boolean; evidence_saved: boolean; submitted: boolean; rejection_reason: string | null;
};
const EMPTY: Activation = { worker_status:'pending',live:false,profile_complete:false,payment_confirmed:false,gold_badge:false,identity_status:'not_started',identity_passed:false,test_passed:false,evidence_saved:false,submitted:false,rejection_reason:null };
const REF_KEY='wh_worker_verification_payment_ref';

export default function WorkerVerificationPhase4({profile,onBack}:Props){
  const videoInput=useRef<HTMLInputElement>(null), certificateInput=useRef<HTMLInputElement>(null);
  const [a,setA]=useState<Activation>(EMPTY),[fee,setFee]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [videoPath,setVideoPath]=useState(''),[certificatePath,setCertificatePath]=useState(''),[preview,setPreview]=useState('');

  async function refresh(){
    const [activation,setting]=await Promise.all([supabase.rpc('get_my_worker_activation'),supabase.rpc('get_setting_v2',{p_key:'worker_verification_fee'})]);
    if(activation.error) toast.error(activation.error.message); else setA({...EMPTY,...(activation.data||{})} as Activation);
    const raw:any=setting.data; setFee(Number(Array.isArray(raw)?raw[0]?.value:raw?.value??raw??0)); setLoading(false);
  }
  useEffect(()=>{void refresh()},[profile.user_id]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
  useEffect(()=>{let dead=false;void(async()=>{let ref='';try{ref=localStorage.getItem(REF_KEY)||''}catch{}if(!ref)return;const result=await verifyPaymentWithRetry(ref,{purpose:'worker_verification'});if(dead)return;if(result.success){try{localStorage.removeItem(REF_KEY)}catch{}toast.success('Onboarding payment confirmed');await refresh()}})();return()=>{dead=true}},[]);

  const paid=Boolean(a.payment_confirmed??a.gold_badge), complete=a.identity_passed&&paid&&a.test_passed&&a.evidence_saved;
  const reviewing=a.worker_status==='profile_under_review'||a.submitted, live=a.live||a.worker_status==='verified';

  function openProfile(){try{sessionStorage.setItem('wh_worker_setup_return','verification');localStorage.setItem('wh_navpage','worker_setup');window.history.replaceState({page:'worker_setup'},'','#worker_setup')}catch{}window.location.reload()}
  async function pay(){if(fee<=0)return toast.error('Onboarding fee is not configured');setBusy(true);try{const boot=await supabase.rpc('create_worker_verification_payment');if(boot.error||!boot.data?.success)throw new Error(boot.data?.error||boot.error?.message||'Payment could not start');const reference=String(boot.data.reference||'');const init=await supabase.functions.invoke('worker-verification-payment-init',{body:{reference}});if(init.error)throw init.error;if(init.data?.already_paid){await refresh();setBusy(false);return}if(!init.data?.authorization_url)throw new Error(init.data?.error||'Paystack could not start');try{localStorage.setItem(REF_KEY,reference)}catch{}window.location.assign(String(init.data.authorization_url))}catch(e:any){toast.error(e?.message||'Payment could not start');setBusy(false)}}
  async function upload(file:File,bucket:'worker-certificates'|'worker-verification-videos',kind:string){const ext=file.name.split('.').pop()||'bin',path=`${profile.user_id}/${kind}-${Date.now()}.${ext}`;const result=await supabase.storage.from(bucket).upload(path,file,{contentType:file.type||undefined});if(result.error)throw result.error;return path}
  async function chooseVideo(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('video/'))return toast.error('Choose a video file');if(file.size>50*1024*1024)return toast.error('Skill video must be under 50MB');try{const path=await upload(file,'worker-verification-videos','skill-video');setVideoPath(path);if(preview)URL.revokeObjectURL(preview);setPreview(URL.createObjectURL(file));toast.success('Skill video added')}catch(err:any){toast.error(err?.message||'Video upload failed')}}
  async function chooseCertificate(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;if(file.size>10*1024*1024)return toast.error('Certificate must be under 10MB');try{setCertificatePath(await upload(file,'worker-certificates','certificate'));toast.success('Certificate added')}catch(err:any){toast.error(err?.message||'Certificate upload failed')}}
  async function saveEvidence(){if(!videoPath)return toast.error('Add a skill demonstration video');setBusy(true);const result=await supabase.rpc('save_my_worker_professional_evidence',{p_certificate_path:certificatePath||null,p_video_path:videoPath});setBusy(false);if(result.error)return toast.error(result.error.message);await refresh()}
  async function submit(){setBusy(true);const result=await supabase.rpc('submit_my_worker_verification');setBusy(false);if(result.error)return toast.error(result.error.message);toast.success('Sent to WeHouse review');await refresh()}

  if(loading)return <Shell><div className="grid min-h-[60dvh] place-items-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/></div></Shell>;
  return <Shell><Toaster position="top-center" richColors theme="dark"/><header className="border-b border-white/[.06] px-4 py-4"><div className="mx-auto flex max-w-2xl items-center gap-3"><button onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.07]">←</button><div><p className="text-[9px] font-bold tracking-[.18em] text-violet-300">WEHOUSE · WORKER</p><h1 className="mt-1 text-lg font-bold">Work verification</h1></div></div></header><main className="mx-auto max-w-2xl space-y-3 px-4 py-4">
    <Progress profile={a.profile_complete} verification={complete} review={live}/>
    {a.profile_complete&&!reviewing&&!live&&<WorkerVerificationChecklist identityPassed={a.identity_passed} paymentConfirmed={paid} readinessPassed={a.test_passed} skillVideoSaved={a.evidence_saved}/>} 
    {a.rejection_reason&&<Card eyebrow="REVIEW FEEDBACK" title="Changes needed" text={a.rejection_reason}/>} 
    {live?<Card eyebrow="LIVE" title="Your services are public" text="Your professional profile is available to customers."><Button label="Back to dashboard" onClick={onBack}/></Card>
    :reviewing?<Card eyebrow="3 · WEHOUSE REVIEW" title="Review in progress" text="WeHouse is reviewing your professional evidence."><Status text="Your profile stays private until approval"/><Button label="Back to dashboard" onClick={onBack} secondary/></Card>
    :!a.profile_complete?<Card eyebrow="1 · WORK PROFILE" title="Complete your work profile" text="Add your service, experience, price and work location."><Button label="Complete work profile" onClick={openProfile}/></Card>
    :!a.identity_passed?<WorkerIdentityCheck profile={profile} status={a.identity_status} onSaved={refresh}/>
    :!paid?<Card eyebrow="2 · WORK VERIFICATION" title="Complete onboarding payment" text="One-time Worker onboarding fee."><Status text="Private face check complete" good/><div className="flex items-center justify-between rounded-xl border border-white/[.07] bg-black/10 px-4 py-3"><span className="text-[10px] text-[#717888]">Onboarding fee</span><strong>₦{fee.toLocaleString()}</strong></div><Button label={busy?'Opening Paystack…':'Continue to Paystack'} onClick={()=>void pay()} disabled={busy||fee<=0}/></Card>
    :!a.test_passed?<Card eyebrow="2 · WORK VERIFICATION" title="Complete readiness test" text="Pass the short test. Your skill video comes next."><Status text="Onboarding payment confirmed" good/><WorkerReadinessTest onPassed={refresh}/></Card>
    :!a.evidence_saved?<Card eyebrow="2 · WORK VERIFICATION" title="Add your skill video" text="Upload one short demonstration for private review."><Status text="Readiness test complete" good/><Upload label={certificatePath?'Certificate added':'Certificate · optional'} done={!!certificatePath} onClick={()=>certificateInput.current?.click()}/><input ref={certificateInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={chooseCertificate}/><Upload label={videoPath?'Skill video added':'Skill demonstration video · required'} done={!!videoPath} onClick={()=>videoInput.current?.click()}/><input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={chooseVideo}/>{preview&&<video src={preview} controls playsInline className="max-h-64 w-full rounded-2xl bg-black object-contain"/>}<Button label={busy?'Saving…':'Save skill evidence'} onClick={()=>void saveEvidence()} disabled={busy||!videoPath}/></Card>
    :<Card eyebrow="3 · WEHOUSE REVIEW" title="Ready for review" text="Your setup is complete."><Button label={busy?'Submitting…':'Submit to WeHouse'} onClick={()=>void submit()} disabled={busy}/></Card>}
  </main></Shell>
}

function Shell({children}:{children:React.ReactNode}){return <div className="min-h-[100dvh] bg-[#0A0A0F] pb-8 text-white">{children}</div>}
function Card({eyebrow,title,text,children}:{eyebrow:string;title:string;text:string;children?:React.ReactNode}){return <section className="space-y-3 rounded-2xl border border-white/[.07] bg-[#11151D] p-4"><div><p className="text-[8px] font-bold tracking-[.16em] text-violet-300">{eyebrow}</p><h2 className="mt-1 text-lg font-bold">{title}</h2><p className="mt-1 text-[10px] leading-relaxed text-[#747B8B]">{text}</p></div>{children}</section>}
function Button({label,onClick,disabled=false,secondary=false}:{label:string;onClick:()=>void;disabled?:boolean;secondary?:boolean}){return <button onClick={onClick} disabled={disabled} className={`h-12 w-full rounded-xl text-xs font-semibold disabled:opacity-40 ${secondary?'border border-white/[.08]':'bg-violet-500'}`}>{label}</button>}
function Status({text,good=false}:{text:string;good?:boolean}){return <div className={`rounded-xl border px-3 py-2.5 text-[9px] ${good?'border-emerald-500/15 bg-emerald-500/[.05] text-emerald-300':'border-white/[.06] text-[#737A8A]'}`}>{text}</div>}
function Upload({label,done,onClick}:{label:string;done:boolean;onClick:()=>void}){return <button onClick={onClick} className={`flex h-12 w-full items-center justify-between rounded-xl border px-4 text-xs ${done?'border-emerald-500/20 text-emerald-300':'border-white/[.08] text-[#A2A7B3]'}`}><span>{label}</span><span>{done?'✓':'+'}</span></button>}
function Progress({profile,verification,review}:{profile:boolean;verification:boolean;review:boolean}){const items=[['Work profile',profile],['Work verification',verification],['WeHouse review',review]] as const;return <section className="grid grid-cols-3 gap-2 rounded-2xl border border-white/[.06] bg-[#0F131A] p-3">{items.map(([label,done],i)=><div key={label} className={`rounded-xl border px-2 py-3 text-center ${done?'border-emerald-500/15 bg-emerald-500/[.05]':'border-white/[.05]'}`}><span className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-[9px] font-bold ${done?'bg-emerald-500 text-[#04120A]':'bg-white/[.05] text-[#656C7B]'}`}>{done?'✓':i+1}</span><p className={`mt-2 text-[8px] ${done?'text-emerald-300':'text-[#676E7E]'}`}>{label}</p></div>)}</section>}

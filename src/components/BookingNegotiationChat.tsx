import { useEffect,useRef,useState } from 'react';
import { getBookingMessages,sendBookingMessage,uploadBookingChatAttachment,workerAcceptBooking,workerStartJob,workerMarkComplete,customerConfirmCompletion,customerRaiseDispute,cancelBooking,getBookingDetails,createWorkerBookingPayment,BOOKING_STATUS_LABELS,markBookingMessagesRead,hideBookingConversation } from '@/lib/supabase/worker-bookings';
import { initializePaystackPopup } from '@/lib/supabase/paystack';
import { chatPresenceLabel } from '@/lib/supabase/presence';
import useChatPresence from '@/hooks/useChatPresence';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';
import { toast } from 'sonner';

type Props={conversationId:string;bookingId:string;profile:Profile;isWorker:boolean;onClose:()=>void};
const MAX_FILES=6,MAX_FILE_SIZE=25*1024*1024;
export default function BookingNegotiationChat({conversationId,bookingId,profile,isWorker,onClose}:Props){
 const[messages,setMessages]=useState<any[]>([]),[booking,setBooking]=useState<any>(null),[input,setInput]=useState(''),[loading,setLoading]=useState(true),[acceptAmount,setAcceptAmount]=useState(''),[acceptDate,setAcceptDate]=useState(''),[showAcceptForm,setShowAcceptForm]=useState(false),[disputeReason,setDisputeReason]=useState(''),[showDisputeForm,setShowDisputeForm]=useState(false),[cancelReason,setCancelReason]=useState(''),[showCancelForm,setShowCancelForm]=useState(false),[paying,setPaying]=useState(false),[sending,setSending]=useState(false),[files,setFiles]=useState<File[]>([]),[recording,setRecording]=useState(false),[menuOpen,setMenuOpen]=useState(false),[profileOpen,setProfileOpen]=useState(false),[peerProfile,setPeerProfile]=useState<any>(null),[confirmDelete,setConfirmDelete]=useState(false);
 const bottomRef=useRef<HTMLDivElement>(null),fileInputRef=useRef<HTMLInputElement>(null),mediaRef=useRef<MediaRecorder|null>(null),chunksRef=useRef<Blob[]>([]),recordStartedRef=useRef(0);
 const peerId=booking?(isWorker?booking.user_id:booking.worker_id):null;
 const presence=useChatPresence(peerId);
 const presenceText=chatPresenceLabel(presence);
 useEffect(()=>{void loadAll()},[conversationId,bookingId]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'})},[messages.length,files.length]);
 useEffect(()=>()=>{if(mediaRef.current?.state==='recording')mediaRef.current.stop()},[]);
 useEffect(()=>{document.body.classList.add('wehouse-conversation-open');window.dispatchEvent(new CustomEvent('wehouse:conversation-open',{detail:{open:true}}));return()=>{document.body.classList.remove('wehouse-conversation-open');window.dispatchEvent(new CustomEvent('wehouse:conversation-open',{detail:{open:false}}))}},[]);
 useEffect(()=>{const channel=supabase.channel(`booking-chat-live:${conversationId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'booking_messages',filter:`conversation_id=eq.${conversationId}`},()=>void loadAll(true)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'booking_messages',filter:`conversation_id=eq.${conversationId}`},()=>void loadAll(true)).subscribe();return()=>{void supabase.removeChannel(channel)}},[conversationId,bookingId]);
 async function loadAll(quiet=false){if(!quiet)setLoading(true);const[msgRes,bookingRes]=await Promise.all([getBookingMessages(conversationId),getBookingDetails(bookingId)]);setMessages(msgRes.messages||[]);setBooking(bookingRes.booking);await markBookingMessagesRead(conversationId);if(!quiet)setLoading(false)}
 function openSupport(){setMenuOpen(false);window.dispatchEvent(new CustomEvent('openSupportChat',{detail:{category:'worker_booking',subject:`Worker booking ${booking?.booking_code||''}`.trim(),contextType:'worker_booking',contextId:bookingId,contextSnapshot:{booking_code:booking?.booking_code||null,service_type:booking?.service_type||null,status:booking?.status||null,scheduled_date:booking?.scheduled_date||null,agreed_amount:booking?.negotiated_amount||booking?.agreed_amount||null,address:booking?.address||null,worker_id:booking?.worker_id||null,customer_id:booking?.user_id||null}}}))}
 function chooseFiles(list:FileList|null){if(!list)return;const incoming=Array.from(list).filter(file=>{if(file.size>MAX_FILE_SIZE){toast.error(`${file.name} is larger than 25MB`);return false}return true});setFiles(current=>{const next=[...current,...incoming].slice(0,MAX_FILES);if(current.length+incoming.length>MAX_FILES)toast.error('You can send up to 6 files at once');return next});if(fileInputRef.current)fileInputRef.current.value=''}
 async function handleSend(){if(sending||(!input.trim()&&!files.length))return;setSending(true);const paths:string[]=[];try{for(const file of files){const{path,error}=await uploadBookingChatAttachment(file,conversationId);if(error||!path)throw new Error(error?.message||`Could not upload ${file.name}`);paths.push(path)}const{error}=await sendBookingMessage(conversationId,input.trim(),paths);if(error)throw error;setInput('');setFiles([]);await loadAll(true)}catch(e:any){if(paths.length)await supabase.storage.from('chat-files').remove(paths);toast.error(e?.message||'Message could not be sent')}finally{setSending(false)}}
 async function toggleVoice(){if(recording){mediaRef.current?.stop();return}if(files.length>=MAX_FILES)return toast.error('Remove a file before recording a voice note');try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunksRef.current=[];recordStartedRef.current=Date.now();recorder.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data)};recorder.onstop=()=>{const type=recorder.mimeType||'audio/webm',blob=new Blob(chunksRef.current,{type}),ext=type.includes('mp4')?'m4a':'webm',elapsed=Math.max(1,Math.round((Date.now()-recordStartedRef.current)/1000));setFiles(current=>[...current,new File([blob],`voice-${Date.now()}-${elapsed}s.${ext}`,{type})].slice(0,MAX_FILES));stream.getTracks().forEach(t=>t.stop());setRecording(false)};mediaRef.current=recorder;recorder.start(250);setRecording(true)}catch{toast.error('Microphone permission is required for voice messages')}}
 async function openPeerProfile(){const{data,error}=await supabase.rpc('get_allowed_conversation_profile',{p_context_type:'worker_booking',p_context_id:bookingId});if(error)return toast.error('Profile could not be opened');setPeerProfile(data||null);setProfileOpen(true)}
 async function deleteFromMessages(){const{hidden,error}=await hideBookingConversation(conversationId);if(error||!hidden)return toast.error(error?.message||'Could not remove conversation');toast.success('Conversation removed from your Messages');setConfirmDelete(false);setMenuOpen(false);onClose()}
 async function handleWorkerAccept(){const amount=Number(acceptAmount.replace(/[^0-9]/g,''));if(!amount||amount<=0)return toast.error('Enter a valid amount');if(!acceptDate)return toast.error('Pick a schedule date');const{success,error}=await workerAcceptBooking(bookingId,amount,acceptDate);if(error||!success)return toast.error(error?.message||'Booking could not be accepted');toast.success('Booking accepted. The customer can now pay.');setShowAcceptForm(false);void loadAll(true)}
 async function handleWorkerStart(){const{success,error}=await workerStartJob(bookingId);if(error||!success)return toast.error(error?.message||'Job could not be started');toast.success('Job started');void loadAll(true)}
 async function handleWorkerComplete(){const{success,error}=await workerMarkComplete(bookingId);if(error||!success)return toast.error(error?.message||'Job could not be completed');toast.success('Marked complete. Waiting for customer confirmation.');void loadAll(true)}
 async function handleCustomerConfirm(){const{success,error}=await customerConfirmCompletion(bookingId);if(error||!success)return toast.error(error?.message||'Completion could not be confirmed');toast.success('Job confirmed. Payment released to the Worker.');void loadAll(true)}
 async function handleCustomerDispute(){if(!disputeReason.trim())return toast.error('Enter a reason');const{success,error}=await customerRaiseDispute(bookingId,disputeReason.trim());if(error||!success)return toast.error(error?.message||'Dispute could not be raised');toast.success('Dispute sent to WeHouse for review');setShowDisputeForm(false);void loadAll(true)}
 async function handleCancel(){if(!cancelReason.trim())return toast.error('Enter a reason');const{success,error}=await cancelBooking(bookingId,cancelReason.trim());if(error||!success)return toast.error(error?.message||'Booking could not be cancelled');toast.success('Booking cancelled');setShowCancelForm(false);void loadAll(true)}
 async function handleCustomerPay(){setPaying(true);try{const{result:bootstrap,error:bootstrapErr}=await createWorkerBookingPayment(bookingId);if(bootstrapErr||!bootstrap?.success){setPaying(false);return toast.error(bootstrap?.error||'Payment initialization failed')}const reference=bootstrap.reference as string,amount=bootstrap.amount as number;const{data:pk}=await supabase.rpc('get_setting_v2',{p_key:'paystack_public_key'});if(!pk){setPaying(false);return toast.error('Paystack not configured')}initializePaystackPopup({publicKey:pk,email:profile.email,amountKobo:Math.round(amount*100),reference,metadata:{payment_type:'worker_booking',expected_amount:amount,booking_id:bookingId},onSuccess:async()=>{const{verifyPaymentWithRetry}=await import('@/lib/supabase/payment-verify');const result=await verifyPaymentWithRetry(reference,{purpose:'worker_booking',expected_amount:amount});if(result.success)toast.success('Payment successful. The Worker can now start the job.');else if(result.requires_review)toast.error('Payment was received but needs WeHouse review. Do not pay again.');else toast.error(result.error||'Payment verification failed');setPaying(false);void loadAll(true)},onCancel:()=>{toast.info('Payment cancelled');setPaying(false)},onError:(message)=>{toast.error(message);setPaying(false)}})}catch(e:any){setPaying(false);toast.error(e?.message||'Payment failed')}}
 const statusInfo=booking?.status?BOOKING_STATUS_LABELS[booking.status]:null,paymentReview=booking?.payment_review_required===true,openConversation=['booking_requested','negotiating','waiting_payment','confirmed','in_progress','completed_pending_approval','disputed'].includes(booking?.status),peerName=isWorker?(booking?.customer_username?`@${booking.customer_username}`:booking?.user_name||'Customer'):booking?.worker_name||'Worker',peerAvatar=isWorker?booking?.user_avatar:booking?.worker_avatar;
 if(loading)return <div className="fixed inset-0 z-50 grid place-items-center bg-[#0A0A0F]">
<div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/>
</div>;
 return <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-[#0A0A0F] text-white">
  <header className="relative shrink-0 border-b border-white/[.06] bg-[#11131A]/97 px-3 py-2.5 backdrop-blur-xl sm:px-4">
<div className="mx-auto flex max-w-4xl items-center gap-2.5">
<button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#8E93A3] hover:bg-white/[.05]" aria-label="Back">←</button>
<button onClick={()=>void openPeerProfile()} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left active:bg-white/[.04]">
<ChatAvatar name={peerName} src={peerAvatar}/>
<div className="min-w-0 flex-1">
<div className="flex min-w-0 items-center gap-2">
<p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{peerName}</p>{statusInfo&&<span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[7px] ${statusInfo.color}`}>{statusInfo.label}</span>}</div>
<p className={`mt-0.5 truncate text-[9px] ${presence?.online?'text-emerald-300':'text-[#676D7D]'}`}>{presenceText||`${booking?.service_type||'Worker booking'} · #${booking?.booking_code||''}`}</p>
</div>
</button>
<button onClick={()=>setMenuOpen(value=>!value)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl text-[#8E93A3] hover:bg-white/[.05]" aria-label="Conversation options">⋯</button>
</div>{menuOpen&&<div className="absolute right-3 top-[3.65rem] z-30 w-56 overflow-hidden rounded-2xl border border-white/[.08] bg-[#171B24] p-1.5 shadow-2xl">
<button onClick={openSupport} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-violet-300 hover:bg-violet-500/[.06]">
<span>?</span>
<span>WeHouse Support</span>
</button>
<button onClick={()=>{setMenuOpen(false);setConfirmDelete(true)}} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[11px] text-red-300 hover:bg-red-500/[.07]">
<span>⌫</span>
<span>Delete from my Messages</span>
</button>
</div>}
   {booking&&<div className="mx-auto mt-3 max-w-4xl rounded-2xl border border-white/[.06] bg-white/[.025] p-3">
<div className="mb-2 flex items-center justify-between">
<p className="text-[9px] font-semibold uppercase tracking-wide text-[#656A7A]">Job progress</p>{Number(booking.negotiated_amount||0)>0&&<p className="text-xs font-bold">₦{Number(booking.negotiated_amount).toLocaleString()}</p>}</div>
<div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]">
<div className="h-full rounded-full bg-violet-500" style={{width:getProgressWidth(booking.status)}}/>
</div>
<p className="mt-1 text-[9px] leading-relaxed text-[#686C7D]">{statusInfo?.description}</p>{paymentReview&&<div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-3 py-2">
<p className="text-[9px] font-semibold text-amber-300">Payment review required</p>
<p className="mt-1 text-[9px] leading-relaxed text-[#8A8190]">Paystack verified a payment, but this booking could not finish payment processing automatically. Do not pay or cancel again. WeHouse must review it first.</p>
</div>}<div className="mt-2 flex flex-wrap gap-1.5">{isWorker&&['booking_requested','negotiating'].includes(booking.status)&&<button onClick={()=>setShowAcceptForm(v=>!v)} className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-semibold text-emerald-300">Accept booking</button>}{isWorker&&booking.status==='confirmed'&&<button onClick={()=>void handleWorkerStart()} className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-[9px] font-semibold text-blue-300">Start job</button>}{isWorker&&booking.status==='in_progress'&&<button onClick={()=>void handleWorkerComplete()} className="rounded-lg bg-violet-500/10 px-3 py-1.5 text-[9px] font-semibold text-violet-300">Mark complete</button>}{!isWorker&&!paymentReview&&booking.status==='waiting_payment'&&<button onClick={()=>void handleCustomerPay()} disabled={paying} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-50">{paying?'Processing…':`Pay ₦${Number(booking.negotiated_amount||0).toLocaleString()}`}</button>}{!isWorker&&booking.status==='completed_pending_approval'&&<button onClick={()=>void handleCustomerConfirm()} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[9px] font-semibold">Confirm completion</button>}{!isWorker&&['confirmed','in_progress','completed_pending_approval'].includes(booking.status)&&<button onClick={()=>setShowDisputeForm(v=>!v)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[9px] font-semibold text-red-300">Raise dispute</button>}{!paymentReview&&['booking_requested','negotiating','waiting_payment'].includes(booking.status)&&<button onClick={()=>setShowCancelForm(v=>!v)} className="rounded-lg bg-white/[.04] px-3 py-1.5 text-[9px] text-[#858999]">Cancel</button>}</div>{showAcceptForm&&<div className="mt-2 space-y-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[.035] p-2">
<input inputMode="numeric" value={acceptAmount} onChange={e=>setAcceptAmount(e.target.value.replace(/[^0-9]/g,''))} placeholder="Agreed price (₦)" className="h-9 w-full rounded-lg border border-white/[.07] bg-[#181A23] px-3 text-xs outline-none"/>
<input type="date" value={acceptDate} onChange={e=>setAcceptDate(e.target.value)} className="h-9 w-full rounded-lg border border-white/[.07] bg-[#181A23] px-3 text-xs outline-none"/>
<button onClick={()=>void handleWorkerAccept()} className="h-9 w-full rounded-lg bg-emerald-500 text-[10px] font-semibold">Confirm & accept</button>
</div>}{showDisputeForm&&<div className="mt-2 space-y-2 rounded-xl border border-red-500/15 bg-red-500/[.035] p-2">
<textarea value={disputeReason} onChange={e=>setDisputeReason(e.target.value)} rows={2} placeholder="What went wrong?" className="w-full resize-none rounded-lg border border-white/[.07] bg-[#181A23] p-2 text-xs outline-none"/>
<button onClick={()=>void handleCustomerDispute()} className="h-9 w-full rounded-lg bg-red-500 text-[10px] font-semibold">Submit dispute</button>
</div>}{showCancelForm&&<div className="mt-2 space-y-2 rounded-xl border border-white/[.07] bg-white/[.025] p-2">
<textarea value={cancelReason} onChange={e=>setCancelReason(e.target.value)} rows={2} placeholder="Reason for cancellation" className="w-full resize-none rounded-lg border border-white/[.07] bg-[#181A23] p-2 text-xs outline-none"/>
<div className="grid grid-cols-2 gap-2">
<button onClick={()=>setShowCancelForm(false)} className="h-9 rounded-lg bg-white/[.04] text-[10px]">Keep booking</button>
<button onClick={()=>void handleCancel()} className="h-9 rounded-lg bg-red-500/10 text-[10px] font-semibold text-red-300">Cancel booking</button>
</div>
</div>}</div>}
  </header>
  <main className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(124,58,237,.045),transparent_32%)] px-3 py-4 sm:px-4">
<div className="mx-auto max-w-4xl space-y-3">{booking&&<section className="rounded-2xl border border-violet-500/10 bg-violet-500/[.035] p-3">
<div className="flex items-center justify-between gap-3">
<p className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">About this job</p>
<button onClick={openSupport} className="text-[9px] font-semibold text-violet-300">Need WeHouse?</button>
</div>{isWorker&&booking?.customer_username&&<p className="mt-2 text-[10px] font-medium text-violet-300">Customer · @{booking.customer_username}</p>}<p className="mt-2 text-xs leading-relaxed">{booking.description||'No description provided'}</p>{booking.address&&<p className="mt-1 text-[10px] text-[#626678]">{booking.address}</p>}{booking.scheduled_date&&<p className="mt-1 text-[10px] text-emerald-300">Scheduled · {new Date(booking.scheduled_date).toLocaleDateString()}</p>}</section>}
   {messages.map((msg,index)=>{const mine=msg.sender_id===profile.user_id,prev=messages[index-1],showDay=!prev||new Date(prev.created_at).toDateString()!==new Date(msg.created_at).toDateString();return <div key={msg.id}>{showDay&&<DaySeparator value={msg.created_at}/>}<div className={`flex ${mine?'justify-end':'justify-start'}`}>
<div className={`max-w-[86%] overflow-hidden rounded-[20px] px-3.5 py-2.5 sm:max-w-[72%] ${mine?'rounded-br-md bg-violet-500':'rounded-bl-md border border-white/[.05] bg-[#161922]'}`}>{!mine&&<p className="mb-1 text-[9px] font-semibold text-violet-300">{msg.sender_name||'Job participant'}</p>}{msg.attachments?.map((url:string,i:number)=>
<BookingAttachment key={`${msg.id}-${i}`} url={url}/>)}{msg.content&&<MessageContent content={msg.content}/>}<p className={`mt-1 text-[8px] ${mine?'text-violet-100/70':'text-[#5C6070]'}`}>{new Date(msg.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}{mine&&<span className={msg.is_read?'ml-1 font-bold text-cyan-200':'ml-1 text-violet-100/50'}>{msg.is_read?'✓✓':'✓'}</span>}</p>
</div>
</div></div>})}<div ref={bottomRef}/>
</div>
</main>
  <footer className="chat-input-container shrink-0 border-t border-white/[.06] bg-[#11131A]/98 px-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">{openConversation?<div className="mx-auto max-w-4xl">{files.length>0&&<div className="mb-2 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">{files.map((file,index)=>
<div key={`${file.name}-${index}`} className="flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[.05] px-3 py-2">
<p className="max-w-40 truncate text-[9px] text-violet-200">{file.type.startsWith('audio/')?'🎤 Voice note':file.name}</p>
<button onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))} className="text-[#8B90A0]">×</button>
</div>)}</div>}<div className="flex items-end gap-2">
<button onClick={()=>fileInputRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-lg text-[#858A9B]">＋</button>
<input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,audio/*,video/mp4" className="hidden" onChange={e=>chooseFiles(e.target.files)}/>
<button onClick={()=>void toggleVoice()} aria-label={recording?'Stop voice recording':'Record voice message'} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording?'bg-red-500 text-white':'border border-white/[.07] bg-white/[.035] text-[#858A9B]'}`}>
<Mic/>
</button>
<div className="flex min-h-11 flex-1 items-end rounded-[22px] border border-white/[.07] bg-[#1A1A24] px-3 py-1.5 focus-within:border-violet-500/40">
<textarea rows={1} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void handleSend()}}} placeholder="Message about this job…" className="max-h-24 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px] outline-none"/>
</div>
<button onClick={()=>void handleSend()} disabled={sending||(!input.trim()&&!files.length)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.05] disabled:text-[#626879]">{sending?'…':'➤'}</button>
</div>{recording&&<p className="mt-2 text-center text-[9px] text-red-300">Recording voice… tap the microphone again to stop</p>}<p className="mt-2 text-center text-[8px] text-[#505565]">Private job conversation · photos and voice notes supported · WeHouse Support is separate</p>
</div>:<div className="mx-auto flex max-w-4xl items-center justify-between gap-3 py-2">
<p className="text-[10px] text-[#656A7A]">This job conversation is closed.</p>
<button onClick={openSupport} className="text-[10px] font-semibold text-violet-300">Human Support</button>
</div>}</footer>
  {profileOpen&&<ConversationIdentitySheet profile={peerProfile} booking={booking} isWorker={isWorker} name={peerName} avatar={peerAvatar} presence={presenceText||''} onClose={()=>setProfileOpen(false)}/>} 
  {confirmDelete&&<DeleteSheet onCancel={()=>setConfirmDelete(false)} onDelete={()=>void deleteFromMessages()}/>} 
 </div>
}
function ChatAvatar({name,src}:{name:string;src?:string|null}){return <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500/15 text-sm font-bold text-violet-300">{src?<img src={src} alt="" className="h-full w-full object-cover"/>:(name||'W')[0].toUpperCase()}</div>}
function ConversationIdentitySheet({profile,booking,isWorker,name,avatar,presence,onClose}:{profile:any;booking:any;isWorker:boolean;name:string;avatar?:string|null;presence:string;onClose:()=>void}){const viewingWorker=!isWorker,displayName=profile?.full_name||name,details=viewingWorker?[['Rating',profile?.rating!=null?`${Number(profile.rating).toFixed(1)} ★ · ${Number(profile.review_count||0)} reviews`:null],['Service',profile?.worker_occupation||booking?.service_type],['Experience',profile?.worker_experience],['Price',profile?.worker_price?`₦${Number(profile.worker_price).toLocaleString()}`:null],['Location',[profile?.lga,profile?.state].filter(Boolean).join(', ')],['Verified',profile?.worker_verified?'Verified WeHouse Worker':null]]:[['School',profile?.school],['Location',[profile?.city,profile?.state].filter(Boolean).join(', ')]];return <div className="fixed inset-0 z-[75] flex items-end bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center" onClick={onClose}><section className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[32px] bg-[#11151D] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:max-w-sm sm:rounded-[32px]" onClick={e=>e.stopPropagation()}><div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15"/><div className="mx-auto w-fit"><ChatAvatar name={displayName} src={profile?.avatar_url||avatar}/></div><h2 className="mt-3 text-center text-xl font-bold">{displayName}</h2>{profile?.username&&<p className="mt-1 text-center text-[9px] text-[#747B8B]">@{profile.username}</p>}<p className="mt-1 text-center text-[10px] text-emerald-300">{presence||'WeHouse conversation'}</p>{(profile?.worker_bio||profile?.bio)&&<p className="mx-auto mt-4 max-w-xs text-center text-[11px] leading-5 text-[#B5BAC6]">{profile.worker_bio||profile.bio}</p>}<div className="mt-6 divide-y divide-white/[.06] border-y border-white/[.06]">{details.filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([label,value])=><div key={String(label)} className="flex items-center justify-between gap-5 py-3.5"><span className="text-[9px] text-[#707788]">{label}</span><span className="text-right text-[11px] font-semibold text-[#E4E6EC]">{value}</span></div>)}</div>{viewingWorker&&Array.isArray(profile?.worker_skills)&&profile.worker_skills.length>0&&<div className="mt-4 flex flex-wrap justify-center gap-1.5">{profile.worker_skills.slice(0,8).map((skill:string)=><span key={skill} className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[9px] text-violet-200">{skill}</span>)}</div>}<button onClick={onClose} className="mt-5 h-12 w-full rounded-2xl bg-violet-500 text-xs font-semibold">Back to conversation</button></section></div>}
function DaySeparator({value}:{value:string}){const date=new Date(value),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);const label=date.toDateString()===today.toDateString()?'Today':date.toDateString()===yesterday.toDateString()?'Yesterday':date.toLocaleDateString([],{day:'numeric',month:'short',year:date.getFullYear()===today.getFullYear()?undefined:'numeric'});return <div className="flex items-center gap-3 py-3"><span className="h-px flex-1 bg-white/[.05]"/><span className="text-[8px] font-semibold text-[#697080]">{label}</span><span className="h-px flex-1 bg-white/[.05]"/></div>}
function DeleteSheet({onCancel,onDelete}:{onCancel:()=>void;onDelete:()=>void}){return <div className="fixed inset-0 z-[70] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center" onClick={onCancel}>
<section className="w-full rounded-3xl border border-white/[.08] bg-[#151922] p-5 sm:max-w-sm" onClick={event=>event.stopPropagation()}>
<h2 className="text-base font-bold">Delete this chat from your Messages?</h2>
<p className="mt-2 text-[10px] leading-5 text-[#767C8C]">The booking and its audit history stay intact, and the other participant keeps their copy. A new message can make this chat appear again.</p>
<div className="mt-5 grid grid-cols-2 gap-2">
<button onClick={onCancel} className="h-11 rounded-xl border border-white/[.08] text-[11px] font-semibold text-[#A4A9B7]">Keep</button>
<button onClick={onDelete} className="h-11 rounded-xl bg-red-500 text-[11px] font-semibold text-white">Delete</button>
</div>
</section>
</div>}
function MessageContent({content}:{content:string}){if(isImage(content))return <img src={content} alt="Shared" className="mb-1 max-h-72 max-w-full cursor-pointer rounded-xl object-contain" onClick={()=>window.open(content,'_blank')}/>;return <p className="whitespace-pre-wrap text-xs leading-relaxed">{content}</p>}
function BookingAttachment({url}:{url:string}){if(isImage(url))return <img src={url} alt="Attachment" className="mb-2 max-h-72 max-w-full cursor-pointer rounded-xl object-contain" onClick={()=>window.open(url,'_blank')}/>;if(isAudio(url))return <audio controls preload="metadata" src={url} className="mb-2 h-9 max-w-full"/>;if(isVideo(url))return <video controls preload="metadata" src={url} className="mb-2 max-h-72 max-w-full rounded-xl"/>;return <a href={url} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-xl border border-white/[.08] bg-black/10 px-3 py-2 text-[10px] font-semibold text-violet-100">
<span>📎</span>
<span>Open attachment</span>
</a>}
function isImage(v:string){return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(v)}function isAudio(v:string){return /\.(mp3|wav|webm|m4a|ogg)(\?|$)/i.test(v)}function isVideo(v:string){return /\.(mp4|mov)(\?|$)/i.test(v)}
function Mic(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<rect x="9" y="2" width="6" height="12" rx="3"/>
<path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>
</svg>}
function getProgressWidth(status:string){const progress:Record<string,string>={booking_requested:'15%',negotiating:'30%',waiting_payment:'45%',confirmed:'60%',in_progress:'75%',completed_pending_approval:'85%',approved_released:'100%',completed:'100%',disputed:'90%',cancelled:'0%',refunded:'0%'};return progress[status]||'0%'}

import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { deleteRoommateChatAttachment,getConversations,getMessages,getRoommateConversationPeople,hideRoommateConversation,markMessagesSeen,sendMessage,uploadRoommateChatAttachment } from '@/lib/supabase/chat';
import { BOOKING_STATUS_LABELS,getCommunicationBookingConversations } from '@/lib/supabase/worker-bookings';
import { getCallCapabilities,launchPrivateCall } from '@/lib/private-calls';
import { chatPresenceLabel } from '@/lib/supabase/presence';
import useChatPresence from '@/hooks/useChatPresence';
import BookingNegotiationChat from '@/components/BookingNegotiationChat';
import OfficialChannel from '@/components/OfficialChannel';
import OfficialEntryCard from '@/components/OfficialEntryCard';
import SupportEntryCard from '@/components/SupportEntryCard';
import AssistantEntryCard from '@/components/AssistantEntryCard';
import WeHouseAssistantScreen from '@/components/WeHouseAssistantScreen';
import type { Profile } from '@/types';

type Props={profile:Profile;onNavigate:(page:string)=>void;conversationId?:string|null};
type Person={user_id?:string;name:string;avatar:string|null};
type WorkerConversation={conversation_id:string;booking_id:string;booking_code:string;booking_status:string;service_type:string;other_person_name:string;other_person_avatar:string|null;last_message:string|null;last_message_time:string|null;unread_count:number;updated_at:string};
type InboxItem={kind:'roommate';id:string;time:string;row:any}|{kind:'worker';id:string;time:string;row:WorkerConversation};
const MAX_FILES=6,MAX_FILE_SIZE=25*1024*1024;

export default function ChatPhase10Modern({profile,onNavigate:_onNavigate,conversationId}:Props){
 const[roommates,setRoommates]=useState<any[]>([]),[workers,setWorkers]=useState<WorkerConversation[]>([]),[people,setPeople]=useState<Record<string,Person>>({}),[loading,setLoading]=useState(true),[active,setActive]=useState<any|null>(null),[worker,setWorker]=useState<{conversationId:string;bookingId:string}|null>(null),[official,setOfficial]=useState(false),[assistant,setAssistant]=useState(false),[messages,setMessages]=useState<any[]>([]),[input,setInput]=useState(''),[files,setFiles]=useState<File[]>([]),[sending,setSending]=useState(false),[recording,setRecording]=useState(false),[recordSeconds,setRecordSeconds]=useState(0),[more,setMore]=useState(false),[profileOpen,setProfileOpen]=useState(false),[editing,setEditing]=useState<string|null>(null),[editText,setEditText]=useState(''),[editWindow,setEditWindow]=useState(10),[now,setNow]=useState(Date.now());
 const[peerProfile,setPeerProfile]=useState<any>(null);
 const fileRef=useRef<HTMLInputElement>(null),inputRef=useRef<HTMLTextAreaElement>(null),bottomRef=useRef<HTMLDivElement>(null),recorderRef=useRef<MediaRecorder|null>(null),chunksRef=useRef<Blob[]>([]),recordStartedRef=useRef(0);
 const otherId=useCallback((row:any)=>row.participant_a===profile.user_id?row.participant_b:row.participant_a,[profile.user_id]);
 const unread=useCallback((row:any)=>Number(row.participant_a===profile.user_id?row.unread_a:row.unread_b)||0,[profile.user_id]);
 const peerId=active?otherId(active):null,presence=useChatPresence(peerId),presenceText=chatPresenceLabel(presence);
 const loadInbox=useCallback(async(quiet=false)=>{if(!quiet)setLoading(true);const[a,b,c]=await Promise.all([getConversations(profile.user_id),getRoommateConversationPeople(),getCommunicationBookingConversations(profile.user_id)]);if(a.error&&!quiet)toast.error(a.error.message||'Unable to load conversations');if(c.error&&!quiet)toast.error(c.error.message||'Unable to load Worker conversations');setRoommates((a.conversations||[]).filter((row:any)=>row.conversation_type==='roommate'));setPeople(b.people||{});setWorkers((c.conversations||[]) as WorkerConversation[]);setLoading(false);return(a.conversations||[]).filter((row:any)=>row.conversation_type==='roommate')},[profile.user_id]);
 const loadMessages=useCallback(async(id:string)=>{const result=await getMessages(id);if(result.error)return toast.error(result.error.message||'Unable to open conversation');setMessages(result.messages||[]);await markMessagesSeen(id)},[]);
 useEffect(()=>{void loadInbox()},[loadInbox]);
 useEffect(()=>{void supabase.rpc('get_setting_v2',{p_key:'message_edit_window_minutes'}).then(({data})=>{const raw:any=data,value=Number(Array.isArray(raw)?raw[0]?.value:raw?.value??raw);if(Number.isFinite(value)&&value>0)setEditWindow(value)})},[]);
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),15000);return()=>window.clearInterval(timer)},[]);
 useEffect(()=>{if(!conversationId)return;const route=(window.location.hash||'').replace(/^#/,'').split('?')[0];if(route!=='chat')return;void(async()=>{const rows=await loadInbox(true);const found=rows.find((row:any)=>row.id===conversationId);if(found)setActive(found)})()},[conversationId,loadInbox]);
 useEffect(()=>{if(!active){setMessages([]);setFiles([]);setInput('');setMore(false);setEditing(null);return}void loadMessages(active.id);const channel=supabase.channel(`roommate-modern:${active.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${active.id}`},()=>{void loadMessages(active.id);void loadInbox(true)}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:`conversation_id=eq.${active.id}`},()=>void loadMessages(active.id)).subscribe();return()=>{void supabase.removeChannel(channel)}},[active?.id,loadInbox,loadMessages]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth',block:'end'})},[messages.length,files.length,editing]);
 useEffect(()=>{if(!recording){setRecordSeconds(0);return}const timer=window.setInterval(()=>setRecordSeconds(value=>value+1),1000);return()=>window.clearInterval(timer)},[recording]);
 useEffect(()=>()=>{if(recorderRef.current?.state==='recording')recorderRef.current.stop()},[]);
 useEffect(()=>{const open=Boolean(active||worker||official||assistant);document.body.classList.toggle('wehouse-conversation-open',open);window.dispatchEvent(new CustomEvent('wehouse:conversation-open',{detail:{open}}));return()=>{document.body.classList.remove('wehouse-conversation-open');if(open)window.dispatchEvent(new CustomEvent('wehouse:conversation-open',{detail:{open:false}}))}},[active,worker,official,assistant]);
 async function openRoommate(row:any){setActive(row);await loadMessages(row.id);requestAnimationFrame(()=>inputRef.current?.focus())}
 function chooseFiles(list:FileList|null){if(!list)return;const incoming=Array.from(list).filter(file=>{if(!file.type.startsWith('image/')){toast.error('Roommate chat supports photos and voice notes');return false}if(file.size>MAX_FILE_SIZE){toast.error(`${file.name} is larger than 25MB`);return false}return true});setFiles(current=>[...current,...incoming].slice(0,MAX_FILES));if(fileRef.current)fileRef.current.value=''}
 async function voice(){if(recording){recorderRef.current?.stop();return}if(files.length>=MAX_FILES)return toast.error('Remove an attachment before recording');try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type)),recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunksRef.current=[];recordStartedRef.current=Date.now();recorder.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data)};recorder.onstop=()=>{const type=recorder.mimeType||'audio/webm',blob=new Blob(chunksRef.current,{type}),ext=type.includes('mp4')?'m4a':'webm',elapsed=Math.max(1,Math.round((Date.now()-recordStartedRef.current)/1000));setFiles(current=>[...current,new File([blob],`voice-${Date.now()}-${elapsed}s.${ext}`,{type})].slice(0,MAX_FILES));stream.getTracks().forEach(track=>track.stop());setRecording(false)};recorderRef.current=recorder;recorder.start(250);setRecording(true)}catch{toast.error('Microphone permission is required')}}
 async function startCall(type:'audio'|'video'){if(!active)return;const{capabilities,error}=await getCallCapabilities('roommate',active.id);if(error||!capabilities)return toast.error(error?.message||'Call is not available');if(type==='audio'&&!capabilities.allow_audio_calls)return toast.error('This person has disabled audio calls');if(type==='video'&&!capabilities.allow_video_calls)return toast.error('This person has disabled video calls');launchPrivateCall('roommate',active.id,type)}
 async function openPeerProfile(){if(!active)return;const{data,error}=await supabase.rpc('get_allowed_conversation_profile',{p_context_type:'roommate',p_context_id:active.id});if(error)return toast.error('Profile could not be opened');setPeerProfile(data||null);setProfileOpen(true)}
 async function send(){if(!active||sending||(!input.trim()&&!files.length))return;setSending(true);const paths:string[]=[],types:string[]=[];try{for(const file of files){const up=await uploadRoommateChatAttachment(file,active.id);if(up.error||!up.path)throw new Error(up.error?.message||'Upload failed');paths.push(up.path);types.push(up.type||file.type)}const result=await sendMessage(active.id,input.trim(),paths,types);if(result.error||!result.message)throw new Error(result.error?.message||'Message failed');setInput('');setFiles([]);await loadMessages(active.id);void loadInbox(true)}catch(error:any){for(const path of paths)await deleteRoommateChatAttachment(path);toast.error(error?.message||'Message failed')}finally{setSending(false)}}
 async function saveEdit(id:string){const text=editText.trim();if(!text)return toast.error('Message cannot be empty');const{error}=await supabase.rpc('edit_my_roommate_message',{p_message_id:id,p_content:text});if(error)return toast.error(error.message);setEditing(null);setEditText('');await loadMessages(active.id);void loadInbox(true)}
 async function remove(){if(!active)return;const{hidden,error}=await hideRoommateConversation(active.id);if(error||!hidden)return toast.error(error?.message||'Could not remove chat');setActive(null);setMore(false);toast.success('Conversation removed from Messages');void loadInbox(true)}
 const items=useMemo<InboxItem[]>(()=>[...roommates.map(row=>({kind:'roommate' as const,id:`r:${row.id}`,time:row.last_message_at||row.created_at,row})),...workers.map(row=>({kind:'worker' as const,id:`w:${row.conversation_id}`,time:row.last_message_time||row.updated_at,row}))].sort((a,b)=>new Date(b.time||0).getTime()-new Date(a.time||0).getTime()),[roommates,workers]);
 const totalUnread=roommates.reduce((sum,row)=>sum+unread(row),0)+workers.reduce((sum,row)=>sum+Number(row.unread_count||0),0);
 if(assistant)return <WeHouseAssistantScreen profile={profile} onBack={()=>setAssistant(false)}/>;
 if(official)return <OfficialChannel profile={profile} onBack={()=>setOfficial(false)}/>;
 if(worker)return <BookingNegotiationChat conversationId={worker.conversationId} bookingId={worker.bookingId} profile={profile} isWorker={profile.role==='worker'} onClose={()=>{setWorker(null);void loadInbox(true)}}/>;
 if(active){const person=people[otherId(active)];return <div className="fixed inset-0 z-[60] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0A0C11] text-white lg:left-auto lg:w-[calc(100%-240px)]">
<header className="shrink-0 border-b border-white/[.055] bg-[#0D1016]/97 px-2 pb-2 pt-[max(.55rem,env(safe-area-inset-top))] backdrop-blur-xl">
<div className="mx-auto flex max-w-3xl items-center gap-1">
<button onClick={()=>setActive(null)} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-[#A3A8B6]">‹</button>
<button onClick={()=>void openPeerProfile()} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left active:bg-white/[.04]">
<Avatar person={person}/>
<div className="min-w-0 flex-1">
<p className="truncate text-[13px] font-semibold">{person?.name||'Roommate'}</p>
<p className={`mt-0.5 truncate text-[8px] ${presence?.online?'text-emerald-300':'text-[#656C7C]'}`}>{presenceText||'Roommate chat'}</p>
</div>
</button>
<Round label="Audio call" onClick={()=>void startCall('audio')}>
<Phone/>
</Round>
<Round label="Video call" onClick={()=>void startCall('video')}>
<Video/>
</Round>
<div className="relative">
<Round label="More" onClick={()=>setMore(v=>!v)}>
<More/>
</Round>{more&&<div className="absolute right-0 top-11 z-30 w-52 rounded-2xl border border-white/[.08] bg-[#171B23] p-1 shadow-2xl">
<button onClick={()=>void remove()} className="w-full rounded-xl px-3 py-3 text-left text-[10px] text-red-300">Remove from my Messages</button>
</div>}</div>
</div>
</header>
<main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3 sm:px-4">
<div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end">
<div className="pb-4 pt-6 text-center">
<div className="mx-auto mb-2 w-fit">
<Avatar person={person} large/>
</div>
<p className="text-xs font-semibold">{person?.name||'Roommate'}</p>
<p className="mt-1 text-[8px] text-[#5F6677]">Matched on WeHouse</p>
</div>
<div className="space-y-0.5">{messages.map((msg:any,index:number)=>{const mine=msg.sender_id===profile.user_id,prev=messages[index-1],next=messages[index+1],start=!prev||prev.sender_id!==msg.sender_id,end=!next||next.sender_id!==msg.sender_id,canEdit=mine&&!msg.attachments?.length&&Boolean(msg.content)&&now-new Date(msg.created_at).getTime()<=editWindow*60000,showDay=!prev||new Date(prev.created_at).toDateString()!==new Date(msg.created_at).toDateString();return <div key={msg.id}>{showDay&&<DaySeparator value={msg.created_at}/>}<Bubble msg={msg} mine={mine} start={start} end={end} editing={editing===msg.id} editText={editText} canEdit={canEdit} startEdit={()=>{setEditing(msg.id);setEditText(msg.content||'')}} changeEdit={setEditText} cancelEdit={()=>{setEditing(null);setEditText('')}} saveEdit={()=>void saveEdit(String(msg.id))}/></div>})}<div ref={bottomRef}/>
</div>
</div>
</main>
<footer className="shrink-0 border-t border-white/[.055] bg-[#0D1016]/98 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-4">
<div className="mx-auto max-w-3xl">{files.length>0&&<div className="mb-2 flex gap-2 overflow-x-auto">{files.map((file,index)=>
<div key={`${file.name}-${index}`} className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#171B23]">{file.type.startsWith('image/')?<img src={URL.createObjectURL(file)} alt="Selected" className="h-full w-full object-cover"/>:<span>🎙</span>}<button onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-[9px]">×</button>
</div>)}</div>}{recording&&<div className="mb-2 flex items-center gap-2 px-2 text-[9px] text-red-300">
<span className="h-2 w-2 animate-pulse rounded-full bg-red-400"/>Recording {duration(recordSeconds)}</div>}<div className="flex items-end gap-1.5">
<button onClick={()=>fileRef.current?.click()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#9298A8]" aria-label="Add photo">
<Plus/>
</button>
<input ref={fileRef} type="file" multiple accept="image/*" className="hidden" onChange={e=>chooseFiles(e.target.files)}/>
<button onClick={()=>void voice()} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${recording?'bg-red-500/15 text-red-300':'text-[#9298A8]'}`} aria-label="Voice note">
<Mic/>
</button>
<div className="min-h-10 flex-1 rounded-[22px] border border-white/[.07] bg-[#181C24] px-3 py-1 focus-within:border-violet-500/30">
<textarea ref={inputRef} rows={1} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="Message" className="max-h-28 min-h-8 w-full resize-none bg-transparent py-1.5 text-[13px] leading-5 outline-none placeholder:text-[#5D6474]"/>
</div>
<button onClick={()=>void send()} disabled={sending||(!input.trim()&&!files.length)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500 disabled:bg-white/[.055] disabled:text-[#565D6D]" aria-label="Send">
<Send/>
</button>
</div>
</div>
</footer>
{profileOpen&&<div className="fixed inset-0 z-[80] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center" onClick={()=>setProfileOpen(false)}>
<section onClick={e=>e.stopPropagation()} className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[30px] bg-[#11151D] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:max-w-sm sm:rounded-[30px]">
<div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15"/>
<div className="mx-auto h-20 w-20 overflow-hidden rounded-full bg-violet-500/15">{peerProfile?.avatar_url?<img src={peerProfile.avatar_url} alt="" className="h-full w-full object-cover"/>:<div className="grid h-full place-items-center text-xl font-bold text-violet-300">{(peerProfile?.full_name||person?.name||'R')[0]}</div>}</div>
<h2 className="mt-3 text-center text-lg font-bold">{peerProfile?.full_name||person?.name||'Roommate'}</h2>
{peerProfile?.username&&<p className="mt-1 text-center text-[9px] text-[#777E8E]">@{peerProfile.username}</p>}
<p className={`mt-1 text-center text-[10px] ${presence?.online?'text-emerald-300':'text-[#737A8A]'}`}>{presenceText||'Roommate connection'}</p>
{peerProfile?.bio&&<p className="mx-auto mt-4 max-w-xs text-center text-[11px] leading-5 text-[#B5BAC6]">{peerProfile.bio}</p>}
<div className="mt-5 divide-y divide-white/[.06] border-y border-white/[.06]">{[
 ['School',peerProfile?.school],
 ['Location',[peerProfile?.lga,peerProfile?.state].filter(Boolean).join(', ')],
 ['Age',peerProfile?.roommate?.age],
 ['Budget',peerProfile?.roommate?.budget_min||peerProfile?.roommate?.budget_max?`₦${Number(peerProfile?.roommate?.budget_min||0).toLocaleString()} – ₦${Number(peerProfile?.roommate?.budget_max||0).toLocaleString()}`:null],
 ['Preferred area',peerProfile?.roommate?.area],
 ['Personality',peerProfile?.roommate?.personality_type],
 ['Stay',peerProfile?.roommate?.stay_duration],
].filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([label,value])=><div key={String(label)} className="flex items-center justify-between gap-5 py-3.5"><span className="text-[9px] text-[#6F7686]">{label}</span><span className="text-right text-[11px] font-semibold text-[#E1E4EA]">{value}</span></div>)}</div>
<div className="mt-4 grid grid-cols-2 gap-2">
<button onClick={()=>{setProfileOpen(false);void startCall('audio')}} className="h-11 rounded-xl border border-white/[.07] bg-white/[.035] text-xs font-semibold">Audio call</button>
<button onClick={()=>{setProfileOpen(false);void startCall('video')}} className="h-11 rounded-xl bg-violet-500 text-xs font-semibold">Video call</button>
</div>
<button onClick={()=>setProfileOpen(false)} className="mt-2 h-11 w-full rounded-xl text-xs text-[#8B92A2]">Close</button>
</section>
</div>}
</div>}
 return <div className="min-h-[100dvh] bg-[#090B10] pb-24 text-white">
<header className="sticky top-0 z-20 border-b border-white/[.05] bg-[#090B10]/96 px-4 pb-3 pt-[max(.8rem,env(safe-area-inset-top))] backdrop-blur-xl">
<div className="mx-auto flex max-w-3xl items-center justify-between">
<div>
<h1 className="text-[22px] font-bold tracking-tight">Messages</h1>
<p className="mt-0.5 text-[9px] text-[#626979]">Your WeHouse conversations</p>
</div>{totalUnread>0&&<span className="grid h-7 min-w-7 place-items-center rounded-full bg-violet-500 px-2 text-[9px] font-bold">{totalUnread>99?'99+':totalUnread}</span>}</div>
</header>
<main className="mx-auto max-w-3xl px-2 py-3 sm:px-4">
<section className="overflow-hidden rounded-2xl border border-white/[.055] bg-[#10131A]">
<AssistantEntryCard onOpen={()=>setAssistant(true)}/>
<Divider/>
<OfficialEntryCard profile={profile} compact onOpen={()=>setOfficial(true)}/>
<Divider/>
<SupportEntryCard profile={profile} compact />
</section>
<p className="px-2 pb-2 pt-5 text-[9px] font-bold uppercase tracking-[.12em] text-[#62697A]">Chats</p>{loading?<Loading/>:items.length===0?<div className="px-6 py-16 text-center">
<div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/[.035] text-[#757C8D]">
<Chat/>
</div>
<p className="mt-4 text-sm font-semibold">No chats yet</p>
<p className="mt-1 text-[9px] text-[#606777]">Roommate and Worker conversations will appear here.</p>
</div>:<section className="overflow-hidden rounded-2xl border border-white/[.055] bg-[#10131A]">{items.map((item,index)=>
<div key={item.id}>{index>0&&<Divider/>}{item.kind==='roommate'?<RoommateRow row={item.row} person={people[otherId(item.row)]} count={unread(item.row)} open={()=>void openRoommate(item.row)}/>:<WorkerRow row={item.row} open={()=>setWorker({conversationId:item.row.conversation_id,bookingId:item.row.booking_id})}/>}</div>)}</section>}</main>
</div>
}

function Bubble({msg,mine,start,end,editing,editText,canEdit,startEdit,changeEdit,cancelEdit,saveEdit}:any){const attachments=msg.attachments||[],types=msg.attachment_types||[];if(editing)return <div className="my-2 flex justify-end">
<div className="w-[84%] max-w-md rounded-2xl bg-[#171B23] p-2">
<textarea autoFocus value={editText} onChange={e=>changeEdit(e.target.value)} className="min-h-14 w-full resize-none bg-transparent p-2 text-xs outline-none"/>
<div className="flex justify-end gap-2">
<button onClick={cancelEdit} className="px-3 py-2 text-[9px] text-[#818797]">Cancel</button>
<button onClick={saveEdit} className="rounded-lg bg-violet-500 px-3 py-2 text-[9px] font-semibold">Save</button>
</div>
</div>
</div>;const radius=mine?`${start?'rounded-t-[18px]':'rounded-tl-[18px]'} ${end?'rounded-b-[18px] rounded-br-[5px]':'rounded-b-[18px]'}`:`${start?'rounded-t-[18px]':'rounded-tr-[18px]'} ${end?'rounded-b-[18px] rounded-bl-[5px]':'rounded-b-[18px]'}`;return <div className={`group flex ${mine?'justify-end':'justify-start'} ${start?'mt-2':'mt-[2px]'}`}>
<div className="max-w-[82%] sm:max-w-[72%]">{attachments.length>0&&<div className={`mb-0.5 overflow-hidden rounded-[18px] ${attachments.length>1?'grid grid-cols-2 gap-0.5':''}`}>{attachments.map((url:string,i:number)=>types[i]?.startsWith('audio/')?<div key={url} className={`min-w-56 p-2 ${mine?'bg-violet-500':'bg-[#191D25]'}`}>
<VoicePlayer url={url}/>
</div>:<a key={url} href={url} target="_blank" rel="noreferrer">
<img src={url} alt="Chat attachment" className={`max-h-72 w-full object-cover ${attachments.length>1?'aspect-square':''}`}/>
</a>)}</div>}{msg.content&&<div className={`px-3 py-2 text-[12px] leading-[1.42] ${radius} ${mine?'bg-violet-500':'bg-[#191D25]'}`}>
<p className="whitespace-pre-wrap break-words">{msg.content}</p>
<div className={`mt-1 flex justify-end gap-1 text-[7px] ${mine?'text-violet-100/65':'text-[#676E7F]'}`}>
<span>{time(msg.created_at)}</span>{msg.edited_at&&<span>· edited</span>}{mine&&<span className={msg.is_read?'font-bold text-cyan-200':'text-violet-100/55'}>{msg.is_read?'✓✓':'✓'}</span>}</div>
</div>}{canEdit&&<button onClick={startEdit} className="ml-auto mt-1 hidden px-1 text-[7px] text-[#626979] group-hover:block">Edit</button>}</div>
</div>}
function RoommateRow({row,person,count,open}:any){return <button onClick={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-white/[.035]">
<Avatar person={person}/>
<div className="min-w-0 flex-1">
<div className="flex items-center justify-between gap-3">
<p className={`truncate text-[13px] ${count?'font-bold':'font-semibold'}`}>{person?.name||'Roommate'}</p>
<span className={`text-[8px] ${count?'text-violet-300':'text-[#565D6D]'}`}>{inboxTime(row.last_message_at||row.created_at)}</span>
</div>
<div className="mt-1 flex items-center gap-2">
<p className={`min-w-0 flex-1 truncate text-[9px] ${count?'text-[#BCC0CB]':'text-[#666D7E]'}`}>{row.last_message||'Start your conversation'}</p>{count>0&&<span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{count>9?'9+':count}</span>}</div>
</div>
</button>}
function WorkerRow({row,open}:any){return <button onClick={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-white/[.035]">
<Avatar person={{name:row.other_person_name,avatar:row.other_person_avatar}}/>
<div className="min-w-0 flex-1">
<div className="flex justify-between gap-3">
<p className={`truncate text-[13px] ${row.unread_count?'font-bold':'font-semibold'}`}>{row.other_person_name||'Worker'}</p>
<span className="text-[8px] text-[#565D6D]">{inboxTime(row.last_message_time||row.updated_at)}</span>
</div>
<div className="mt-1 flex items-center gap-2">
<p className="min-w-0 flex-1 truncate text-[9px] text-[#666D7E]">{row.last_message||`${row.service_type} · ${BOOKING_STATUS_LABELS[row.booking_status as keyof typeof BOOKING_STATUS_LABELS]||String(row.booking_status).replace(/_/g,' ')}`}</p>{Number(row.unread_count)>0&&<span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold">{row.unread_count}</span>}</div>
</div>
</button>}
function Avatar({person,large=false}:{person?:Person;large?:boolean}){const initials=(person?.name||'R').split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();return <div className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#202531] font-bold text-[#D9DCE4] ${large?'h-16 w-16 text-base':'h-11 w-11 text-xs'}`}>{person?.avatar?<img src={person.avatar} alt="" className="h-full w-full object-cover"/>:initials}</div>}
function Divider(){return <div className="ml-[4.25rem] h-px bg-white/[.05]"/>}
function DaySeparator({value}:{value:string}){const date=new Date(value),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);const label=date.toDateString()===today.toDateString()?'Today':date.toDateString()===yesterday.toDateString()?'Yesterday':date.toLocaleDateString([],{day:'numeric',month:'short',year:date.getFullYear()===today.getFullYear()?undefined:'numeric'});return <div className="flex items-center gap-3 py-4"><span className="h-px flex-1 bg-white/[.05]"/><span className="text-[8px] font-semibold text-[#697080]">{label}</span><span className="h-px flex-1 bg-white/[.05]"/></div>}
function Round({label,onClick,children}:any){return <button onClick={onClick} aria-label={label} className="grid h-9 w-9 place-items-center rounded-full text-[#9FA5B4]">{children}</button>}
function Loading(){return <div className="grid min-h-48 place-items-center">
<div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"/>
</div>}
function time(v:string){return v?new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}
function inboxTime(v:string){if(!v)return'';const d=new Date(v),n=new Date();return d.toDateString()===n.toDateString()?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{month:'short',day:'numeric'})}
function duration(s:number){return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
function VoicePlayer({url}:{url:string}){const audioRef=useRef<HTMLAudioElement>(null),[playing,setPlaying]=useState(false),[at,setAt]=useState(0);const encoded=decodeURIComponent(url),match=encoded.match(/-(\d+)s\.(?:webm|m4a|mp4|ogg)(?:\?|$)/i),recorded=match?Number(match[1]):0,total=recorded||Math.max(0,Number(audioRef.current?.duration)||0);function toggle(){const audio=audioRef.current;if(!audio)return;if(audio.paused){void audio.play();setPlaying(true)}else{audio.pause();setPlaying(false)}}return <div className="flex min-w-52 items-center gap-3 rounded-2xl bg-black/10 px-2.5 py-2"><audio ref={audioRef} src={url} preload="metadata" onTimeUpdate={e=>setAt((e.currentTarget as HTMLAudioElement).currentTime)} onEnded={()=>{setPlaying(false);setAt(0)}}/><button onClick={toggle} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-sm">{playing?'Ⅱ':'▶'}</button><div className="min-w-0 flex-1"><div className="h-1.5 overflow-hidden rounded-full bg-black/20"><div className="h-full rounded-full bg-white/80" style={{width:`${total?Math.min(100,(at/total)*100):0}%`}}/></div><p className="mt-1 text-[8px] text-white/70">{duration(Math.floor(at))} / {duration(Math.round(total))}</p></div></div>}
function Phone(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
<path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.8 12.8 0 0 0 .62 2.63 2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.9Z"/>
</svg>}
function Video(){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
<rect x="3" y="6" width="13" height="12" rx="2"/>
<path d="m16 10 5-3v10l-5-3"/>
</svg>}
function More(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
<circle cx="5" cy="12" r="1.5"/>
<circle cx="12" cy="12" r="1.5"/>
<circle cx="19" cy="12" r="1.5"/>
</svg>}
function Plus(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
<path d="M12 5v14M5 12h14"/>
</svg>}
function Mic(){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
<rect x="9" y="2" width="6" height="12" rx="3"/>
<path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>
</svg>}
function Send(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<path d="m4 4 16 8-16 8 3-8-3-8Z"/>
<path d="M7 12h13"/>
</svg>}
function Chat(){return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>
</svg>}

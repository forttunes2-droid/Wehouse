// Actual production attachment and bubble components; synthetic transport only.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Send } from 'lucide-react';
import RoommateBubble from '../../src/components/RoommateMessageBubble';
import PropertyShareDialog from '../../src/components/PropertyShareDialog';
import SharedPropertyCard, { PropertyDraftAttachment } from '../../src/components/SharedPropertyCard';
import MessageMedia, { PendingMessageMedia } from '../../src/components/MessageMedia';
import HotelSpecialRequest from '../../src/components/HotelSpecialRequest';
import { pendingPropertyShare, clearPropertyShare, propertyShareMessage } from '../../src/lib/propertyShare';
import '../../src/index.css';
const house = {kind:'listing' as const, id:'long-home'};
const image = 'https://assets.wehouse.test/home.svg';
const initialMode = (window as any).__attachmentMode || 'shared';
const message = (content:string,id='message') => ({id,sender_id:'qa-ada',conversation_id:'chat-ada',content,created_at:'2026-09-23T09:10:00Z',seen:true});
function Fixture() {
  const [mode,setMode]=useState(initialMode), [property,setProperty]=useState<any>(initialMode === 'draft' ? house : null), [note,setNote]=useState(''), [sent,setSent]=useState<string[]>([]), [files,setFiles]=useState<File[]>([]);
  const open = (page:string,id:string)=>{(window as any).__opened={page,id};};
  const action = ()=>{(window as any).__actions=((window as any).__actions||0)+1;};
  const reply = ()=>{(window as any).__replies=((window as any).__replies||0)+1;};
  const onSend = ()=>{ if (!property && !note.trim()) return; const content=property?propertyShareMessage(property,note):note;setSent(current=>[...current,content]);(window as any).__sent=[...sent,content];clearPropertyShare('qa-personal','chat-ada');setProperty(null);setNote('');};
  (window as any).__reopenPicker=()=>{setMode('picker');setProperty(null);setNote('');};
  (window as any).__files=()=>setFiles([new File([new Uint8Array([137,80,78,71])],'room-photo.png',{type:'image/png'}),new File(['test'],'voice.webm',{type:'audio/webm'})]);
  return <div className="mx-auto flex h-[100dvh] max-w-3xl flex-col bg-[#090B10] text-white">
    <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3"><ArrowLeft size={20} /><span className="grid h-10 w-10 place-items-center rounded-full bg-violet-500/20 text-violet-200">A</span><span><strong className="block text-sm">Ada Example</strong><small className="block text-xs text-[#A5AAB8]">Your connection</small></span></header>
    <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5">
      {mode==='picker' && <PropertyShareDialog userId="qa-personal" property={house} title="Courtyard Long Let" onClose={()=>setMode('empty')} onConversation={id=>{(window as any).__conversation=id;setProperty(pendingPropertyShare('qa-personal',id));setMode('draft');}} />}
      {mode==='shared' && <><RoommateBubble msg={message(propertyShareMessage(house,'This is the place I mentioned.')) as any} mine={false} onOpenActions={action} onTapReaction={action} onReply={reply} onOpenProperty={open} /><RoommateBubble msg={{...message('I like the location. Let us check the rooms.','followup'),sender_id:'qa-personal'} as any} mine onOpenActions={action} onTapReaction={action} onReply={reply} onOpenProperty={open} /></>}
      {mode==='gallery' && <><RoommateBubble msg={{...message('Here are the room photos.'),attachments:[image,image+'?v=2',image+'?v=3',image+'?v=4',image+'?v=5'],attachment_types:Array(5).fill('image/png')} as any} mine={false} onOpenActions={action} onTapReaction={action} onReply={reply} onOpenProperty={open} /><MessageMedia items={[{url:'https://assets.wehouse.test/test-voice.wav',type:'audio/wav'},{url:'https://assets.wehouse.test/lease.pdf',type:'application/pdf'},{url:'javascript:alert(1)',type:'application/pdf'}]} /></>}
      {mode==='request' && <><HotelSpecialRequest request={'Please arrange a quiet room.\nI may arrive at 6 pm.'} inConversation /><RoommateBubble msg={message('We have noted your quiet-room request.') as any} mine={false} onOpenActions={action} onTapReaction={action} onReply={reply} onOpenProperty={open} /></>}
      {(mode==='unavailable'||mode==='error') && <SharedPropertyCard property={{kind:'listing',id:mode==='unavailable'?'unavailable-home':'long-home'}} onOpen={open} />}
      {mode==='hotel' && <SharedPropertyCard property={{kind:'hotel',id:'7'}} onOpen={open} />}
      {sent.map((content,index)=><RoommateBubble key={index} msg={{...message(content,'sent-'+index),sender_id:'qa-personal'} as any} mine onOpenActions={action} onTapReaction={action} onReply={reply} onOpenProperty={open} />)}
    </main>
    <footer className="shrink-0 border-t border-white/10 bg-[#10131B] p-3">
      {property && <PropertyDraftAttachment property={property} onRemove={()=>setProperty(null)} />}
      <PendingMessageMedia files={files} onRemove={index=>setFiles(current=>current.filter((_,i)=>i!==index))}/>
      <div className="flex items-end gap-2"><textarea aria-label="Message" placeholder="Message" rows={1} className="min-h-11 min-w-0 flex-1 resize-none rounded-3xl border border-white/10 bg-[#181B24] px-4 py-3 text-sm" value={note} onChange={event=>setNote(event.target.value)}/><button type="button" aria-label="Send message" disabled={!property&&!note.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-violet-500 disabled:opacity-40" onClick={onSend}><Send size={19} /></button></div>
    </footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);

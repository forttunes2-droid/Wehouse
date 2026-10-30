import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import PropertyMediaCarousel from '../../src/components/PropertyMediaCarousel';
import RoommateBubble from '../../src/components/RoommateMessageBubble';
import {propertyShareMessage} from '../../src/lib/propertyShare';
import {publicPropertyDestination} from '../../src/lib/publicPropertyDestination';
import type {Message} from '../../src/types';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
function Fixture(){
 const [record,setRecord]=useState(false),[opened,setOpened]=useState('');
 return <main className="min-h-screen bg-[var(--wh-bg)] text-[var(--wh-text)]"><PropertyMediaCarousel title={record?'Another property':'Gallery property'} images={Array.from({length:record?2:3},(_,i)=>`${location.origin}/gallery-photo-${record?'other':'first'}-${i}.svg`)}/><button onClick={()=>setRecord(v=>!v)}>Change property</button><output aria-label="Opened shared item">{opened}</output>
 {([false,true]).flatMap(mine=>(['listing','hotel'] as const).map(kind=><section key={`${mine}:${kind}`} data-testid={`${mine?'sent':'received'}-${kind}`} className="p-4"><RoommateBubble mine={mine} msg={{id:`${mine}:${kind}`,sender_id:mine?'me':'peer',content:propertyShareMessage({kind,id:kind==='hotel'?'42':mine?'shared-home':'public-home-reference'}),created_at:'2026-10-26T12:00:00Z'} as Message} onOpenActions={()=>{}} onTapReaction={()=>{}} onReply={()=>{}} onOpenProperty={(page,id)=>setOpened(JSON.stringify(publicPropertyDestination(page,id)))}/></section>))}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

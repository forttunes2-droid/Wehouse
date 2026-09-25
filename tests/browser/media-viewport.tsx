import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import MediaViewer from '@/components/MediaViewer';
function Fixture(){
 const [open,setOpen]=useState(false);
 const setup = window as unknown as { __mediaMode?: string; __galleryVideo?: string };
 const items = setup.__mediaMode === 'mixed' ? [
   {url:'https://assets.wehouse.test/one.jpg',kind:'image' as const},
   {url:setup.__galleryVideo || '',kind:'video' as const},
   {url:'https://assets.wehouse.test/broken.jpg',kind:'image' as const},
   {url:'https://assets.wehouse.test/two.jpg',kind:'image' as const},
 ] : [{url:'https://assets.wehouse.test/one.jpg',kind:'image' as const},{url:'https://assets.wehouse.test/two.jpg',kind:'image' as const}];
 // Reproduce a keyboard action in the first committed frame, before the next
 // animation frame. The app must not depend on a delayed focus task to close.
 (window as unknown as {__openWithImmediateEscape:()=>void}).__openWithImmediateEscape=()=>{
   flushSync(()=>setOpen(true));
   document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 };
 return <><main className="min-h-[2000px] bg-red-900 p-5 text-white"><h1>Account behind the viewer</h1><button onClick={()=>setOpen(true)} className="min-h-12 bg-violet-500 px-4">View profile photo</button><button className="mt-96 block">Must not receive taps</button></main>{open&&<MediaViewer title="Profile photo" items={items} onClose={()=>setOpen(false)}/>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

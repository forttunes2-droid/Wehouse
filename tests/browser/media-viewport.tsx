import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import MediaViewer from '@/components/MediaViewer';
function Fixture(){
 const [open,setOpen]=useState(false);
 return <><main className="min-h-[2000px] bg-red-900 p-5 text-white"><h1>Account behind the viewer</h1><button onClick={()=>setOpen(true)} className="min-h-12 bg-violet-500 px-4">View profile photo</button><button className="mt-96 block">Must not receive taps</button></main>{open&&<MediaViewer title="Profile photo" items={[{url:'https://assets.wehouse.test/one.jpg',kind:'image'},{url:'https://assets.wehouse.test/two.jpg',kind:'image'}]} onClose={()=>setOpen(false)}/>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

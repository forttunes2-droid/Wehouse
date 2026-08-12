import { useEffect,useState } from 'react';
import { getSupportAttachmentUrl } from '@/lib/supabase/support';

type Props={path:string;type?:string;className?:string};
export default function SecureSupportAttachment({path,type='',className=''}:Props){
 const[url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let alive=true;setFailed(false);setUrl(null);void getSupportAttachmentUrl(path).then(({url,error})=>{if(!alive)return;if(error||!url)setFailed(true);else setUrl(url)});return()=>{alive=false}},[path]);
 if(failed)return <div className={`mb-2 rounded-lg bg-red-500/[.05] px-3 py-2 text-[9px] text-red-300 ${className}`}>Attachment unavailable</div>;
 if(!url)return <div className={`mb-2 rounded-lg bg-black/15 px-3 py-2 text-[9px] text-[#858A99] ${className}`}>Loading attachment…</div>;
 if(type.startsWith('audio/'))return <audio controls preload="metadata" src={url} className={`mb-2 max-w-full ${className}`}/>;
 if(type.startsWith('image/'))return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Support attachment" className={`mb-2 max-h-56 rounded-xl object-cover ${className}`}/></a>;
 return <a href={url} target="_blank" rel="noreferrer" className={`mb-2 block rounded-lg bg-black/20 px-3 py-2 text-[10px] underline ${className}`}>Open attachment</a>;
}

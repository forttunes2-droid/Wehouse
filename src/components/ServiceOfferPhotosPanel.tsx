import {useEffect,useRef,useState} from 'react';
import {Button} from './ui/button';
import {getServiceOfferPhotos,removeUnusedServicePhotos,saveServiceOfferPhotos,servicePhotoUrls,uploadServiceOfferPhoto,type ServicePhotoGallery} from '@/lib/serviceOfferPhotos';

export default function ServiceOfferPhotosPanel({serviceId,workerId,name,onBusyChange}:{serviceId:string;workerId:string;name:string;onBusyChange?:(busy:boolean)=>void}){
 const [gallery,setGallery]=useState<ServicePhotoGallery|null>(null),[urls,setUrls]=useState<Record<string,string>>({}),[caption,setCaption]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0),[progress,setProgress]=useState<number|null>(null);
 const lock=useRef(false),generation=useRef(0);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 useEffect(()=>{
  const request=++generation.current;setLoading(true);setGallery(null);setUrls({});
  void getServiceOfferPhotos(serviceId,workerId).then(async row=>{if(request!==generation.current)return;setGallery(row);const signed=await servicePhotoUrls(row.photos.map(p=>p.preview));if(request===generation.current)setUrls(signed);}).catch(cause=>{if(request===generation.current)setError(message(cause));}).finally(()=>{if(request===generation.current)setLoading(false);});
  return()=>{generation.current++;};
 },[serviceId,workerId,attempt]);
 async function act(work:()=>Promise<unknown>,success:string){
  if(lock.current||!gallery)return;lock.current=true;setBusy(true);setError('');setNotice('');const request=generation.current;
  try{await work();if(request===generation.current){setNotice(success);setCaption('');}}
  catch(cause){if(request===generation.current)setError(message(cause));}
  finally{lock.current=false;if(request===generation.current){setBusy(false);setProgress(null);setAttempt(n=>n+1);}}
 }
 return <section aria-label={`${name} photos`} className="space-y-4">
  <div><h3 className="font-semibold">{name}</h3><p className="mt-1 text-sm leading-6 text-[var(--wh-text-secondary)]">Use photos that represent this service. The first photo is its cover. Showcase posts and activity photos are separate.</p></div>
  {loading&&<p role="status">Loading service photos…</p>}
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
  <div className="grid gap-3 sm:grid-cols-3">{gallery?.photos.map((photo,index)=><article key={photo.id} className="overflow-hidden rounded-xl border border-[var(--wh-border)]">
   {urls[photo.preview]?<img src={urls[photo.preview]} alt={photo.caption} className="aspect-[4/3] w-full object-cover" onError={()=>setUrls(previous=>({...previous,[photo.preview]:''}))}/>:<div className="grid aspect-[4/3] place-items-center bg-[var(--wh-elevated)] text-sm text-[var(--wh-text-secondary)]">Preview unavailable</div>}
   <div className="space-y-2 p-3"><p className="break-words text-sm">{photo.caption}</p>{index===0&&<p className="text-xs font-semibold text-[var(--wh-accent-text)]">Cover photo</p>}<div className="flex flex-wrap gap-2">{index>0&&<Button type="button" variant="outline" disabled={busy||loading} onClick={()=>void act(()=>saveServiceOfferPhotos(gallery,[photo,...gallery.photos.filter(p=>p.id!==photo.id)],workerId),'Cover photo updated.')}>Use as cover</Button>}<Button type="button" variant="outline" disabled={busy||loading} onClick={()=>void act(()=>saveServiceOfferPhotos(gallery,gallery.photos.filter(p=>p.id!==photo.id),workerId),'Photo removed from this service.')}>Remove</Button></div></div>
  </article>)}</div>
  {gallery&&gallery.photos.length<3&&<div className="space-y-3"><label className="block space-y-2 text-sm"><span>Describe this photo</span><input value={caption} maxLength={140} disabled={busy||loading} onChange={e=>setCaption(e.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3"/></label><label className={`inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white ${busy||loading||!caption.trim()?'opacity-50':''}`}>Add service photo<input type="file" aria-label="Add service photo" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy||loading||!caption.trim()} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void act(()=>uploadServiceOfferPhoto(gallery,workerId,file,caption,setProgress),'Service photo saved.');}}/></label><p className="text-xs leading-5 text-[var(--wh-text-muted)]">Up to 3 photos per service. JPG, PNG or WebP up to 10 MB; photos and small previews are compressed before upload. Upload only images you have permission to use.</p></div>}
  {progress!==null&&<p role="status" className="text-sm">Uploading photo: {progress}%</p>}
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||loading} onClick={()=>setAttempt(n=>n+1)}>Refresh photos</Button>{Boolean(gallery?.unused.length)&&<Button type="button" variant="outline" disabled={busy||loading} onClick={()=>void act(()=>removeUnusedServicePhotos(gallery!.unused),'Unused service uploads removed. Saved photos were kept.')}>Remove unused uploads</Button>}</div>
 </section>;
}
function message(cause:unknown){return cause instanceof Error?cause.message:(cause as {message?:string})?.message||'The photo action could not be confirmed. Refresh before retrying.';}

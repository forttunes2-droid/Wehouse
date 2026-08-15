import { useEffect, useRef, useState } from 'react';
import { createListing, uploadListingImage, uploadListingVideo, checkDuplicateListing, supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import LocationSelector from '@/legacy/LocationSelector';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface CreateListingProps { profile: Profile; onBack: () => void; onSuccess?: () => void }
type PartnerOption = { user_id: string; username: string | null; full_name: string | null };
type LocalMedia = { file: File; preview: string };

const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp']);
const VIDEO_TYPES = new Set(['video/mp4','video/quicktime','video/webm']);

export default function CreateListing({ profile, onBack, onSuccess }: CreateListingProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<LocalMedia[]>([]);
  const [videos, setVideos] = useState<LocalMedia[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [assignedPartnerId, setAssignedPartnerId] = useState('');
  const [form, setForm] = useState({ title:'',description:'',price:'',currency:'NGN',address:'',property_type:'apartment' as 'apartment'|'hotel',sub_type:'long_stay' as 'short_let'|'long_stay',bedrooms:'1',bathrooms:'1',contact_phone:profile.phone||'',security_deposit_amount:'',amenities:[] as string[] });
  const [location,setLocation]=useState({country:profile.country||'Nigeria',state:profile.state||'',city:profile.city||'',area:profile.area||''});

  useEffect(()=>{ void (async()=>{ const {data}=await supabase.from('profiles').select('user_id,username,full_name').eq('role','property_partner').eq('deleted',false).eq('suspended',false).eq('banned',false).order('username'); setPartners(data||[]); })(); },[]);
  useEffect(()=>()=>{ [...images,...videos].forEach(item=>URL.revokeObjectURL(item.preview)); },[images,videos]);

  function addImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const accepted: LocalMedia[] = [];
    for (const file of files) {
      if (!IMAGE_TYPES.has(file.type)) { toast.error(`${file.name}: use JPG, PNG or WebP`); continue; }
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name}: image must be under 10MB`); continue; }
      accepted.push({ file, preview: URL.createObjectURL(file) });
    }
    setImages(current => {
      const remaining = Math.max(0, 7 - current.length);
      if (accepted.length > remaining) toast.error('Maximum 7 images');
      accepted.slice(remaining).forEach(item => URL.revokeObjectURL(item.preview));
      return [...current, ...accepted.slice(0, remaining)];
    });
  }

  function addVideos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const accepted: LocalMedia[] = [];
    for (const file of files) {
      if (!VIDEO_TYPES.has(file.type)) { toast.error(`${file.name}: use MP4, MOV or WebM`); continue; }
      if (file.size > 50 * 1024 * 1024) { toast.error(`${file.name}: video must be under 50MB`); continue; }
      accepted.push({ file, preview: URL.createObjectURL(file) });
    }
    setVideos(current => {
      const remaining = Math.max(0, 3 - current.length);
      if (accepted.length > remaining) toast.error('Maximum 3 videos');
      accepted.slice(remaining).forEach(item => URL.revokeObjectURL(item.preview));
      return [...current, ...accepted.slice(0, remaining)];
    });
  }

  function removeImage(index: number) { setImages(current => { const item=current[index]; if(item)URL.revokeObjectURL(item.preview); return current.filter((_,i)=>i!==index); }); }
  function removeVideo(index: number) { setVideos(current => { const item=current[index]; if(item)URL.revokeObjectURL(item.preview); return current.filter((_,i)=>i!==index); }); }

  function pathFromPublicUrl(url: string, bucket: string) {
    const marker = `/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    return index >= 0 ? decodeURIComponent(url.slice(index + marker.length)) : '';
  }

  async function cleanupUploaded(uploaded: Array<{ bucket: 'listing-images'|'listing-videos'; path: string }>) {
    const grouped = new Map<string,string[]>();
    for (const item of uploaded) {
      if (!item.path) continue;
      grouped.set(item.bucket,[...(grouped.get(item.bucket)||[]),item.path]);
    }
    await Promise.all([...grouped.entries()].map(([bucket,paths])=>supabase.storage.from(bucket).remove(paths)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || Number(form.price) <= 0 || !location.state || !location.city) return toast.error('Title, valid price, State and LGA are required');
    if (!images.length) return toast.error('Add at least one clear property image');

    const owner = assignedPartnerId || profile.user_id;
    const duplicate = await checkDuplicateListing(form.title, form.address, location.city, location.state, owner);
    if (duplicate.titleMatch) return toast.error('A very similar active listing already exists in this location');
    if (duplicate.recentPost) return toast.error('This owner already has a recent listing in this LGA');

    setSaving(true);
    const batch = `submission-${profile.user_id}-${crypto.randomUUID()}`;
    const uploaded: Array<{ bucket: 'listing-images'|'listing-videos'; path: string }> = [];
    try {
      const imageUrls: string[] = [];
      for (const item of images) {
        const result = await uploadListingImage(item.file, batch);
        if (result.error || !result.url) throw new Error(result.error?.message || `Could not upload ${item.file.name}`);
        imageUrls.push(result.url);
        uploaded.push({ bucket: 'listing-images', path: pathFromPublicUrl(result.url,'listing-images') });
      }

      const videoUrls: string[] = [];
      for (const item of videos) {
        const result = await uploadListingVideo(item.file, batch);
        if (result.error || !result.url) throw new Error(result.error?.message || `Could not upload ${item.file.name}`);
        videoUrls.push(result.url);
        uploaded.push({ bucket: 'listing-videos', path: pathFromPublicUrl(result.url,'listing-videos') });
      }

      const { listing, error } = await createListing({
        title:form.title.trim(),description:form.description.trim()||null,price:Number(form.price),currency:form.currency,state:location.state,city:location.city,address:form.address.trim()||location.area||null,images:imageUrls,videos:videoUrls,property_type:form.property_type,sub_type:form.property_type==='apartment'?form.sub_type:null,bedrooms:Number(form.bedrooms)||1,bathrooms:Number(form.bathrooms)||1,availability_status:'pending_approval' as any,status:'pending_approval',owner_id:owner,partner_id:assignedPartnerId||null,chat_agent_id:profile.role==='staff'?profile.user_id:null,reserved_by:null,reservation_expiry:null,reservation_fee_paid:false,chat_unlocked:false,submitted_by_role:profile.role,approved_by:null,approved_at:null,rejection_reason:null,security_deposit_amount:form.property_type==='apartment'&&form.sub_type==='short_let'&&form.security_deposit_amount?Number(form.security_deposit_amount):null,contact_phone:form.contact_phone.trim()||null,amenities:form.amenities
      });
      if (error || !listing) throw new Error(error?.message || 'Could not create listing');

      toast.success(listing.status==='available'?'Listing published':'Listing submitted for approval');
      images.forEach(item=>URL.revokeObjectURL(item.preview));
      videos.forEach(item=>URL.revokeObjectURL(item.preview));
      onSuccess?.();
    } catch (error: any) {
      await cleanupUploaded(uploaded);
      toast.error(error?.message || 'Could not create listing');
    } finally {
      setSaving(false);
    }
  }

  const amenityOptions=['WiFi','Parking','Security','24/7 Power','Water','Air Conditioning','Furnished','Kitchen'];
  return <div className="min-h-[100dvh] bg-[#0A0A0F] pb-24 text-white"><Toaster position="top-center" richColors/><header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[.05] bg-[#0A0A0F]/95 px-4 py-4 backdrop-blur"><button onClick={onBack} disabled={saving} className="h-10 w-10 rounded-xl bg-white/[.05] disabled:opacity-40">←</button><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-blue-300">WEHOUSE PROPERTY</p><h1 className="text-lg font-bold">Create listing</h1><p className="text-[10px] text-[#73788A]">Media stays on this device until you submit.</p></div></header>
  <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5 px-4 py-6">
   <Section title="Property owner"><label className="mb-2 block text-xs text-[#9A9CAF]">Assign Property Partner (optional)</label><select value={assignedPartnerId} onChange={e=>setAssignedPartnerId(e.target.value)} className="field"><option value="">WeHouse / internal property</option>{partners.map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.username||p.user_id}</option>)}</select></Section>
   <Section title="Property details"><Field label="Title" value={form.title} set={v=>setForm({...form,title:v})}/><label className="block text-xs text-[#9A9CAF]">Description</label><Textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="field min-h-28"/><div className="grid grid-cols-2 gap-3"><select value={form.property_type} onChange={e=>setForm({...form,property_type:e.target.value as any})} className="field"><option value="apartment">Apartment</option><option value="hotel">Hotel</option></select>{form.property_type==='apartment'&&<select value={form.sub_type} onChange={e=>setForm({...form,sub_type:e.target.value as any})} className="field"><option value="long_stay">Long Stay</option><option value="short_let">Short Let</option></select>}<Field label="Bedrooms" value={form.bedrooms} set={v=>setForm({...form,bedrooms:v})} type="number"/><Field label="Bathrooms" value={form.bathrooms} set={v=>setForm({...form,bathrooms:v})} type="number"/></div></Section>
   <Section title="Price and location"><Field label="Price (NGN)" value={form.price} set={v=>setForm({...form,price:v})} type="number"/><LocationSelector value={location} onChange={setLocation}/><Field label="Address / area" value={form.address} set={v=>setForm({...form,address:v})}/><Field label="Contact phone" value={form.contact_phone} set={v=>setForm({...form,contact_phone:v})}/>{form.property_type==='apartment'&&form.sub_type==='short_let'&&<Field label="Refundable security deposit" value={form.security_deposit_amount} set={v=>setForm({...form,security_deposit_amount:v})} type="number"/>}</Section>
   <Section title="Amenities"><div className="flex flex-wrap gap-2">{amenityOptions.map(a=><button type="button" key={a} onClick={()=>setForm({...form,amenities:form.amenities.includes(a)?form.amenities.filter(x=>x!==a):[...form.amenities,a]})} className={`rounded-xl border px-3 py-2 text-xs ${form.amenities.includes(a)?'border-blue-400 bg-blue-500/15 text-blue-200':'border-white/10 text-[#8A8B9C]'}`}>{a}</button>)}</div></Section>
   <Section title="Media"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>imageInput.current?.click()} className="h-11 rounded-xl border border-white/[.08] bg-white/[.035] text-xs font-semibold">Add images · {images.length}/7</button><button type="button" onClick={()=>videoInput.current?.click()} className="h-11 rounded-xl border border-white/[.08] bg-white/[.035] text-xs font-semibold">Add videos · {videos.length}/3</button></div><input ref={imageInput} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={addImages}/><input ref={videoInput} hidden multiple type="file" accept="video/mp4,video/quicktime,video/webm" onChange={addVideos}/><div className="grid grid-cols-3 gap-2">{images.map((item,index)=><button type="button" key={item.preview} onClick={()=>removeImage(index)} className="relative aspect-square overflow-hidden rounded-xl"><img src={item.preview} className="h-full w-full object-cover" alt={`Property preview ${index+1}`}/><span className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-white">×</span></button>)}</div>{videos.length>0&&<div className="grid gap-2 sm:grid-cols-2">{videos.map((item,index)=><div key={item.preview} className="relative overflow-hidden rounded-xl bg-black"><video src={item.preview} controls playsInline className="aspect-video w-full object-contain"/><button type="button" onClick={()=>removeVideo(index)} className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs">×</button></div>)}</div>}<p className="text-[9px] leading-4 text-[#6D7282]">Images: JPG/PNG/WebP up to 10MB each. Videos: MP4/MOV/WebM up to 50MB each. Files upload only after you submit, and partial uploads are removed if listing creation fails.</p></Section>
   <button disabled={saving} className="h-12 w-full rounded-2xl bg-blue-500 font-bold text-white disabled:opacity-50">{saving?'Uploading & saving…':profile.role==='creator'?'Create listing':'Submit for approval'}</button>
  </form><style>{`.field{width:100%;height:44px;border-radius:12px;background:#15151F;border:1px solid rgba(255,255,255,.08);color:white;padding:0 12px;outline:none}.field:focus{border-color:#3B82F6}`}</style></div>;
}

function Section({title,children}:{title:string;children:React.ReactNode}){return <section className="space-y-3 rounded-2xl border border-white/[.06] bg-[#111119] p-4"><h2 className="text-sm font-bold">{title}</h2>{children}</section>}
function Field({label,value,set,type='text'}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label className="block"><span className="mb-2 block text-xs text-[#9A9CAF]">{label}</span><Input type={type} value={value} onChange={e=>set(e.target.value)} className="field"/></label>}

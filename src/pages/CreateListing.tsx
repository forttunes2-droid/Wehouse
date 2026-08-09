import { useState, useRef, useCallback, useEffect } from 'react';
import { createListing, uploadListingImage, uploadListingVideo, checkDuplicateListing, supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import LocationSelector from '@/legacy/LocationSelector';
import { Toaster, toast } from 'sonner';
import type { Profile } from '@/types';

interface CreateListingProps { profile: Profile; onBack: () => void; onSuccess?: () => void }

type PartnerOption = { user_id: string; username: string | null; full_name: string | null };

export default function CreateListing({ profile, onBack, onSuccess }: CreateListingProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [assignedPartnerId, setAssignedPartnerId] = useState('');
  const [form, setForm] = useState({ title:'',description:'',price:'',currency:'NGN',address:'',property_type:'apartment' as 'apartment'|'hotel',sub_type:'long_stay' as 'short_let'|'long_stay',bedrooms:'1',bathrooms:'1',contact_phone:profile.phone||'',security_deposit_amount:'',amenities:[] as string[] });
  const [location,setLocation]=useState({country:profile.country||'Nigeria',state:profile.state||'',city:profile.city||'',area:profile.area||''});

  useEffect(()=>{ void (async()=>{ const {data}=await supabase.from('profiles').select('user_id,username,full_name').eq('role','property_partner').eq('deleted',false).eq('suspended',false).eq('banned',false).order('username'); setPartners(data||[]); })(); },[]);

  const uploadImages=useCallback(async(e:React.ChangeEvent<HTMLInputElement>)=>{ const files=Array.from(e.target.files||[]).filter(f=>f.type.startsWith('image/')); e.target.value=''; if(!files.length)return; if(images.length+files.length>7)return toast.error('Maximum 7 images'); setUploadingImage(true); const results=await Promise.all(files.map((f,i)=>uploadListingImage(f,`draft-${profile.user_id}-${Date.now()}-${i}`))); setUploadingImage(false); const urls=results.filter(r=>r.url&&!r.error).map(r=>r.url!); setImages(v=>[...v,...urls]); if(urls.length)toast.success(`${urls.length} image${urls.length>1?'s':''} added`); if(urls.length!==files.length)toast.error('Some images could not be uploaded'); },[images.length,profile.user_id]);
  const uploadVideo=useCallback(async(e:React.ChangeEvent<HTMLInputElement>)=>{ const file=e.target.files?.[0]; e.target.value=''; if(!file)return; if(videos.length>=3)return toast.error('Maximum 3 videos'); setUploadingVideo(true); const {url,error}=await uploadListingVideo(file,`draft-${profile.user_id}-${Date.now()}`); setUploadingVideo(false); if(error||!url)return toast.error(error?.message||'Video upload failed'); setVideos(v=>[...v,url]); toast.success('Video added'); },[videos.length,profile.user_id]);

  async function submit(e:React.FormEvent){
    e.preventDefault();
    if(!form.title.trim()||Number(form.price)<=0||!location.city)return toast.error('Title, valid price and LGA are required');
    const duplicate=await checkDuplicateListing(form.title,form.address,location.city,location.state,assignedPartnerId||profile.user_id);
    if(duplicate.titleMatch)return toast.error('A very similar active listing already exists in this location');
    if(duplicate.recentPost)return toast.error('This owner already has a recent listing in this LGA');
    setSaving(true);
    const {listing,error}=await createListing({
      title:form.title.trim(),description:form.description.trim()||null,price:Number(form.price),currency:form.currency,state:location.state||null,city:location.city,address:form.address.trim()||location.area||null,images,videos,property_type:form.property_type,sub_type:form.property_type==='apartment'?form.sub_type:null,bedrooms:Number(form.bedrooms)||1,bathrooms:Number(form.bathrooms)||1,availability_status:'pending_approval' as any,status:'pending_approval',owner_id:assignedPartnerId||profile.user_id,partner_id:assignedPartnerId||null,chat_agent_id:profile.role==='staff'?profile.user_id:null,reserved_by:null,reservation_expiry:null,reservation_fee_paid:false,chat_unlocked:false,submitted_by_role:profile.role,approved_by:null,approved_at:null,rejection_reason:null,security_deposit_amount:form.property_type==='apartment'&&form.sub_type==='short_let'&&form.security_deposit_amount?Number(form.security_deposit_amount):null,contact_phone:form.contact_phone.trim()||null,amenities:form.amenities
    });
    setSaving(false);
    if(error||!listing)return toast.error(error?.message||'Could not create listing');
    toast.success(listing.status==='available'?'Listing published':'Listing submitted for approval'); onSuccess?.();
  }

  const amenityOptions=['WiFi','Parking','Security','24/7 Power','Water','Air Conditioning','Furnished','Kitchen'];
  return <div className="min-h-screen bg-[#0A0A0F] pb-24"><Toaster position="top-center" richColors/><header className="sticky top-0 z-20 border-b border-white/5 bg-[#0A0A0F]/95 backdrop-blur px-4 py-4 flex items-center gap-3"><button onClick={onBack} className="h-10 w-10 rounded-xl bg-white/5 text-white">←</button><div><h1 className="text-lg font-bold text-white">Create Property Listing</h1><p className="text-[11px] text-[#73758A]">WeHouse-controlled publishing and approval</p></div></header>
  <form onSubmit={submit} className="max-w-3xl mx-auto px-4 py-6 space-y-5">
   <Section title="Property owner"><label className="block text-xs text-[#9A9CAF] mb-2">Assign Property Partner (optional)</label><select value={assignedPartnerId} onChange={e=>setAssignedPartnerId(e.target.value)} className="field"><option value="">WeHouse / internal property</option>{partners.map(p=><option key={p.user_id} value={p.user_id}>{p.full_name||p.username||p.user_id}</option>)}</select></Section>
   <Section title="Property details"><Field label="Title" value={form.title} set={v=>setForm({...form,title:v})}/><label className="block text-xs text-[#9A9CAF]">Description</label><Textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="field min-h-28"/><div className="grid grid-cols-2 gap-3"><select value={form.property_type} onChange={e=>setForm({...form,property_type:e.target.value as any})} className="field"><option value="apartment">Apartment</option><option value="hotel">Hotel</option></select>{form.property_type==='apartment'&&<select value={form.sub_type} onChange={e=>setForm({...form,sub_type:e.target.value as any})} className="field"><option value="long_stay">Long Stay</option><option value="short_let">Short Let</option></select>}<Field label="Bedrooms" value={form.bedrooms} set={v=>setForm({...form,bedrooms:v})} type="number"/><Field label="Bathrooms" value={form.bathrooms} set={v=>setForm({...form,bathrooms:v})} type="number"/></div></Section>
   <Section title="Price and location"><Field label="Price (NGN)" value={form.price} set={v=>setForm({...form,price:v})} type="number"/><LocationSelector value={location} onChange={setLocation}/><Field label="Address / area" value={form.address} set={v=>setForm({...form,address:v})}/><Field label="Contact phone" value={form.contact_phone} set={v=>setForm({...form,contact_phone:v})}/>{form.property_type==='apartment'&&form.sub_type==='short_let'&&<Field label="Refundable security deposit" value={form.security_deposit_amount} set={v=>setForm({...form,security_deposit_amount:v})} type="number"/>}</Section>
   <Section title="Amenities"><div className="flex flex-wrap gap-2">{amenityOptions.map(a=><button type="button" key={a} onClick={()=>setForm({...form,amenities:form.amenities.includes(a)?form.amenities.filter(x=>x!==a):[...form.amenities,a]})} className={`px-3 py-2 rounded-xl text-xs border ${form.amenities.includes(a)?'border-violet-400 bg-violet-500/15 text-violet-200':'border-white/10 text-[#8A8B9C]'}`}>{a}</button>)}</div></Section>
   <Section title="Media"><div className="flex gap-3"><Button type="button" onClick={()=>fileInputRef.current?.click()} disabled={uploadingImage}>{uploadingImage?'Uploading…':'Add images'}</Button><Button type="button" onClick={()=>videoInputRef.current?.click()} disabled={uploadingVideo}>{uploadingVideo?'Uploading…':'Add video'}</Button></div><input ref={fileInputRef} hidden multiple type="file" accept="image/*" onChange={uploadImages}/><input ref={videoInputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm" onChange={uploadVideo}/><div className="grid grid-cols-3 gap-2">{images.map((url,i)=><button type="button" key={url} onClick={()=>setImages(v=>v.filter((_,x)=>x!==i))} className="aspect-square rounded-xl overflow-hidden relative"><img src={url} className="w-full h-full object-cover"/><span className="absolute right-1 top-1 bg-black/70 text-white rounded-full px-2">×</span></button>)}</div>{videos.length>0&&<p className="text-xs text-[#73758A]">{videos.length} video{videos.length>1?'s':''} attached</p>}</Section>
   <button disabled={saving||uploadingImage||uploadingVideo} className="w-full h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 text-white font-bold disabled:opacity-50">{saving?'Saving…':profile.role==='creator'?'Publish Listing':'Submit for Approval'}</button>
  </form><style>{`.field{width:100%;height:44px;border-radius:12px;background:#15151F;border:1px solid rgba(255,255,255,.08);color:white;padding:0 12px;outline:none}.field:focus{border-color:#8B5CF6}`}</style></div>;
}

function Section({title,children}:{title:string;children:React.ReactNode}){return <section className="rounded-2xl border border-white/[.06] bg-[#111119] p-4 space-y-3"><h2 className="text-sm font-bold text-white">{title}</h2>{children}</section>}
function Field({label,value,set,type='text'}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label className="block"><span className="block text-xs text-[#9A9CAF] mb-2">{label}</span><Input type={type} value={value} onChange={e=>set(e.target.value)} className="field"/></label>}

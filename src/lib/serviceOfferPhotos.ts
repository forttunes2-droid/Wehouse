import {supabase,uploadStorageObjectWithProgress} from './supabase/client';
import {compressImageFile} from './supabase/utils';
import {withTimeout} from './withTimeout';

export type ServiceOfferPhoto={id:string;image:string;preview:string;caption:string};
export type ServicePhotoGallery={id:string;photos:ServiceOfferPhoto[];revision:string;unused:string[]};
export type ServiceOfferCard={id:string;name:string;price:number;price_type:string;cover:ServiceOfferPhoto|null};
const bucket='service-offer-photos';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function servicePhoto(value:unknown,serviceId:string,workerId:string):ServiceOfferPhoto{
 const p=value as ServiceOfferPhoto;
 const prefix=`${workerId}/${serviceId}/${p?.id}/`;
 if(!p||!uuid(serviceId)||!uuid(p.id)||p.image!==`${prefix}full.jpg`||p.preview!==`${prefix}preview.jpg`||typeof p.caption!=='string'||!p.caption.trim()||p.caption.length>140)throw Error('Service photo could not be confirmed. Refresh before continuing.');
 return p;
}
function gallery(value:unknown,id:string,worker:string):ServicePhotoGallery{
 const row=value as ServicePhotoGallery;
 if(!row||row.id!==id||!uuid(row.revision)||!Array.isArray(row.photos)||row.photos.length>3||!Array.isArray(row.unused)||row.unused.length>24||row.unused.some(p=>typeof p!=='string'||!p.startsWith(`${worker}/`)))throw Error('Service photos could not be confirmed. Refresh before continuing.');
 const photos=row.photos.map(p=>servicePhoto(p,id,worker));
 if(new Set(photos.map(p=>p.id)).size!==photos.length)throw Error('Service photos could not be confirmed.');
 return {...row,photos};
}
export async function getServiceOfferPhotos(id:string,worker:string){
 const {data,error}=await withTimeout(supabase.rpc('get_my_service_offer_photos',{p_service_id:id}),15000,'Service photos took too long. Please refresh.');
 if(error)throw error;return gallery(data,id,worker);
}
export async function saveServiceOfferPhotos(current:ServicePhotoGallery,photos:ServiceOfferPhoto[],worker:string){
 const {data,error}=await withTimeout(supabase.rpc('set_my_service_offer_photos',{p_service_id:current.id,p_photos:photos,p_expected_revision:current.revision}),15000,'The photo save result is unknown. Refresh before retrying.');
 if(error)throw error;const saved=gallery(data,current.id,worker);
 if(saved.photos.length!==photos.length||saved.photos.some((p,i)=>p.id!==photos[i].id||p.image!==photos[i].image||p.preview!==photos[i].preview||p.caption!==photos[i].caption))throw Error('The saved gallery could not be confirmed. Refresh before continuing.');
 return saved;
}
export async function uploadServiceOfferPhoto(current:ServicePhotoGallery,worker:string,file:File,caption:string,onProgress:(n:number)=>void){
 if(current.photos.length>=3)throw Error('Use up to three photos for each service.');
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>10000000)throw Error('Choose a JPG, PNG or WebP photo up to 10 MB.');
 if(!caption.trim()||caption.trim().length>140)throw Error('Describe this service photo in up to 140 characters.');
 const full=await withTimeout(compressImageFile(file,1440,0.82,700000),30000,'Photo preparation took too long. Try a smaller image.');
 const preview=await withTimeout(compressImageFile(file,480,0.78,120000),30000,'Preview preparation took too long. Try a smaller image.');
 const id=crypto.randomUUID(),prefix=`${worker}/${current.id}/${id}/`;
 const photo={id,image:`${prefix}full.jpg`,preview:`${prefix}preview.jpg`,caption:caption.trim()};
 await uploadStorageObjectWithProgress(bucket,photo.image,full,'image/jpeg',n=>onProgress(Math.round(n*0.8)));
 await uploadStorageObjectWithProgress(bucket,photo.preview,preview,'image/jpeg',n=>onProgress(80+Math.round(n*0.2)));
 // Never remove bytes after an uncertain save. Refresh the authoritative gallery
 // first; unused uploads can then be safely removed through Storage.
 return saveServiceOfferPhotos(current,[...current.photos,photo],worker);
}
export async function removeUnusedServicePhotos(paths:string[]){
 if(!paths.length)return;
 const {error}=await withTimeout(supabase.storage.from(bucket).remove(paths),15000,'Unused photo removal could not be confirmed. Refresh and retry.');
 if(error)throw error;
}
export async function servicePhotoUrls(paths:string[]){
 const unique=[...new Set(paths)];if(!unique.length)return {} as Record<string,string>;
 if(unique.length>72)throw Error('Load fewer service photos at once.');
 const {data,error}=await withTimeout(supabase.storage.from(bucket).createSignedUrls(unique,300),15000,'Service photos could not be loaded.');
 if(error)throw error;
 if(!data||data.length!==unique.length||data.some(p=>p.error||!p.path||!unique.includes(p.path)||!p.signedUrl))throw Error('Service photo links could not be confirmed. Refresh photos to retry.');
 return Object.fromEntries((data||[]).filter(p=>p.path&&unique.includes(p.path)&&!p.error&&p.signedUrl).map(p=>[p.path!,p.signedUrl!]));
}

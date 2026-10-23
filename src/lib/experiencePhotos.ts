import { supabase } from './supabase/client';
import { compressImageFile } from './supabase/utils';
import { requestKeyFor, releaseRequestKey, runSafeAction, isNetworkFailure } from './safeAction';
import { withTimeout } from './withTimeout';
import type { ExperienceActivity } from './experienceActivities';

export type ExperiencePhoto = {
  id: string; activity_id: string; revision: number; object_path: string;
  byte_size: number; caption: string; context_current: boolean;
  status: 'uploading'|'submitted'|'approved'|'rejected'|'archived';
  review_note?: string|null;
};
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function photoReceipt(value:unknown,activityId:string):ExperiencePhoto {
  const row=value as ExperiencePhoto;
  if(!row||!uuid(row.id)||row.activity_id!==activityId||row.object_path!==`${activityId}/${row.id}.jpg`||
    !Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.byte_size)||row.byte_size<1||row.byte_size>2000000||
    typeof row.caption!=='string'||row.caption.trim().length<5||row.caption.length>240||typeof row.context_current!=='boolean'||
    !['uploading','submitted','approved','rejected','archived'].includes(row.status)||row.review_note!=null&&typeof row.review_note!=='string')throw new Error('Activity photo could not be confirmed. Refresh before continuing.');
  return row;
}
async function rpc(name:string,args:Record<string,unknown>){
  const {data,error}=await withTimeout(supabase.rpc(name,args),15000,'Photo confirmation took too long. Refresh before retrying.');
  if(error)throw error;return data;
}
export async function listExperiencePhotos(activityId:string){
  const data=await rpc('get_experience_activity_photos',{p_activity_id:activityId});
  if(!Array.isArray(data)||data.length>20)throw new Error('Activity photos could not be loaded.');
  const rows=data.map(value=>photoReceipt(value,activityId));
  if(new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>row.status==='archived'))throw new Error('Activity photos could not be confirmed.');
  return rows;
}
export async function experiencePhotoPreviews(rows:ExperiencePhoto[]){
  if(!rows.length)return {} as Record<string,string>;
  const paths=rows.filter(row=>row.status!=='uploading').map(row=>row.object_path);
  if(!paths.length)return {} as Record<string,string>;
  const {data,error}=await withTimeout(supabase.storage.from('experience-photos').createSignedUrls(paths,120),15000,'Photo previews could not be loaded.');
  if(error)throw error;
  if(!data||data.length!==paths.length||new Set(data.map(item=>item.path)).size!==paths.length||data.some(item=>item.error||!item.signedUrl||!paths.includes(item.path||'')))throw new Error('Photo previews could not be confirmed.');
  return Object.fromEntries(data.map(item=>[item.path!,item.signedUrl!]));
}
export async function finishExperiencePhoto(row:ExperiencePhoto){
  const result=photoReceipt(await rpc('finish_experience_activity_photo',{p_photo_id:row.id}),row.activity_id);
  if(result.id!==row.id||result.object_path!==row.object_path||result.caption!==row.caption||result.byte_size!==row.byte_size||
    result.status!=='submitted'||result.revision!==row.revision+1)throw new Error('Photo submission was not confirmed. Refresh its status.');
  return result;
}
export async function uploadExperiencePhoto(activity:ExperienceActivity,file:File,caption:string){
  return runSafeAction(`experience-photo:${activity.id}`,async()=>{
    try {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>10000000)throw new Error('Choose a JPG, PNG or WebP photo up to 10 MB.');
    if(caption.trim().length<5||caption.trim().length>240)throw new Error('Describe what the photo shows in 5 to 240 characters.');
    const body=await withTimeout(compressImageFile(file,2560,0.86,2000000),30000,'Photo preparation took too long. Choose a smaller image.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await body.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
    const signature=`experience-photo:${activity.id}:${activity.revision}:${hash}:${caption.trim()}`;
    const id=requestKeyFor(signature);
    const row=photoReceipt(await rpc('begin_experience_activity_photo',{p_activity_id:activity.id,p_photo_id:id,p_activity_revision:activity.revision,p_byte_size:body.size,p_caption:caption.trim()}),activity.id);
    if(row.id!==id||row.byte_size!==body.size||row.caption!==caption.trim()||!row.context_current||row.status==='archived')throw new Error('Photo upload reference could not be confirmed.');
    if(row.status!=='uploading'){releaseRequestKey(signature);return row;}
    const {error}=await withTimeout(supabase.storage.from('experience-photos').upload(row.object_path,body,{contentType:'image/jpeg',upsert:false}),90000,'Photo upload confirmation timed out. Refresh status before retrying.');
    if(error&&!/already exists|duplicate/i.test(error.message)&&String(error.statusCode)!=='409')throw error;
    const saved=await finishExperiencePhoto(row);releaseRequestKey(signature);return saved;
    } catch(cause) {
      if(isNetworkFailure(cause))throw new Error('Photo result is unknown. Refresh its status before retrying.');
      throw cause;
    }
  });
}
export async function changeExperiencePhoto(row:ExperiencePhoto,action:'archive'|'refresh_context'|'approved'|'rejected',note=''){
  const saved=photoReceipt(await rpc('change_experience_activity_photo',{p_photo_id:row.id,p_expected_revision:row.revision,p_action:action,p_note:note}),row.activity_id);
  const expected=action==='archive'?'archived':action==='refresh_context'?'submitted':action;
  if(saved.id!==row.id||saved.status!==expected||saved.revision!==row.revision+1||saved.object_path!==row.object_path||saved.byte_size!==row.byte_size||saved.caption!==row.caption||
    action==='refresh_context'&&!saved.context_current||['approved','rejected'].includes(action)&&saved.review_note!==note.trim())throw new Error('Photo decision was not confirmed. Refresh before retrying.');
  return saved;
}

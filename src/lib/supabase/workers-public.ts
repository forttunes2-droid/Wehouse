import { supabase } from './client';
import type { Profile } from '@/types';
import {withTimeout} from '@/lib/withTimeout';

export type ServiceProviderCursor={rating:number;reviews:number;id:string};
export type ServiceProviderFilters={country:string;query:string;category:string;specialty:string;state:string;city:string};
function providerRows(value:unknown,ids?:string[]):Profile[]{
  if(!Array.isArray(value)||value.length>(ids?.length??24))throw Error('Service results could not be confirmed. Please retry.');
  const seen=new Set<string>();
  return value.map(row=>{
    if(!row||typeof row!=='object'||typeof row.user_id!=='string'||!row.user_id||row.user_id.length>120||seen.has(row.user_id)||ids&&!ids.includes(row.user_id)||
      typeof row.rating!=='number'||!Number.isFinite(row.rating)||row.rating<0||row.rating>5||typeof row.review_count!=='number'||!Number.isInteger(row.review_count)||row.review_count<0)throw Error('Service results could not be confirmed. Please retry.');
    seen.add(row.user_id);
    return {...row,role:'worker',profile_complete:true,worker_status:'verified',worker_verified:true,available:true,deleted:false,suspended:false,banned:false} as Profile;
  });
}
export async function searchServiceProviders(filters:ServiceProviderFilters,after?:ServiceProviderCursor|null,signal?:AbortSignal){
  const request=supabase.rpc('search_service_providers',{
    p_country:filters.country,p_query:Array.from(filters.query.trim()).slice(0,80).join('')||null,p_category:filters.category||null,p_specialty:filters.specialty||null,
    p_state:filters.state||null,p_city:filters.city||null,p_after_rating:after?.rating??null,p_after_reviews:after?.reviews??null,p_after_id:after?.id??null,
  });
  const {data,error}=await withTimeout(signal?request.abortSignal(signal):request,15000,'Service search took too long. Please retry.');
  if(error)throw Error(error.message||'Service search could not be loaded. Please retry.');
  if(!data||typeof data.has_more!=='boolean')throw Error('Service results could not be confirmed. Please retry.');
  const workers=providerRows(data.items),last=workers.at(-1),cursor=data.next_cursor;
  if(data.has_more&&(workers.length!==24||!last||!cursor||cursor.id!==last.user_id||cursor.rating!==Number(last.rating)||cursor.reviews!==Number(last.review_count)))throw Error('More service results could not be confirmed. Please refresh.');
  return{workers,hasMore:data.has_more,nextCursor:data.has_more?cursor as ServiceProviderCursor:null};
}
export async function getServiceProvidersByIds(ids:string[]){
  const selected=[...new Set(ids)];
  if(selected.length<1||selected.length>12||selected.some(id=>!id||id.length>120))throw Error('Choose valid Service Provider references.');
  const {data,error}=await withTimeout(supabase.rpc('get_discoverable_service_providers',{p_ids:selected}),15000,'The Service Provider took too long to load. Please retry.');
  if(error)throw Error(error.message||'Service Providers could not be loaded.');
  return providerRows(data,selected);
}

// Public worker discovery must use the backend projection instead of reading
// arbitrary profile rows. The RPC exposes only the fields intended for the
// worker marketplace and applies verified + available account rules server-side.
export async function getWorkers(filters?: { state?: string; city?: string; occupation?: string; status?: string }) {
  const { data, error } = await supabase.rpc('get_public_workers', {
    p_state: filters?.state || null,
    p_city: filters?.city || null,
    p_occupation: filters?.occupation || null,
  });

  const workers = (data || []).map((row: any) => ({
    ...row,
    role: 'worker',
    profile_complete: true,
    worker_status: 'verified',
    worker_verified: true,
    available: true,
    deleted: false,
    suspended: false,
    banned: false,
  })) as Profile[];

  return { workers, error };
}

export async function getFeaturedWorkers(filters?: {
  state?: string;
  city?: string;
  query?: string;
  limit?: number;
}) {
  const { data, error } = await supabase.rpc('get_featured_workers', {
    p_state: filters?.state || null,
    p_city: filters?.city || null,
    p_query: filters?.query || null,
    p_limit: filters?.limit || 3,
  });
  const workers = (data || []).map((row: any) => ({
    ...row,
    role: 'worker',
    profile_complete: true,
    worker_status: 'verified',
    worker_verified: true,
    available: true,
    deleted: false,
    suspended: false,
    banned: false,
    pro_active: true,
  })) as Profile[];
  return { workers, error };
}

export async function recordFeaturedProfileOpen(placementId?: string) {
  if (!placementId) return { recorded: false, error: null };
  const { data, error } = await supabase.rpc('record_my_featured_profile_open', {
    p_placement_id: placementId,
  });
  return { recorded: data === true, error };
}

export async function recordFeaturedBookingRequest(
  placementId: string | undefined,
  bookingId: string,
) {
  if (!placementId) return { recorded: false, error: null };
  const { data, error } = await supabase.rpc('record_my_featured_booking_request', {
    p_placement_id: placementId,
    p_booking_id: bookingId,
  });
  return { recorded: data === true, error };
}

// A worker may only change their own availability. The backend derives the
// worker identity from auth.uid() and rejects unavailable/unverified accounts.
export async function setWorkerAvailability(_workerId: string, isAvailable: boolean) {
  const { error } = await supabase.rpc('set_my_worker_availability', {
    p_is_available: isAvailable,
  });
  if (error) return { profile: null as Profile | null, error };

  const { data, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_id', (await supabase.auth.getUser()).data.user?.id || '')
    .maybeSingle();

  return { profile: (data || null) as Profile | null, error: profileError };
}

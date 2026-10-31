import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {corsHeaders} from 'jsr:@supabase/supabase-js@2/cors';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {hasLiveSession} from '../_shared/liveSession.ts';
import {consumeUserAction} from '../_shared/rateLimit.ts';
import {JsonRequestError,readSmallJsonRequest} from '../_shared/smallJsonRequest.ts';

type Address={address:string|null;city:string|null;state:string|null};
const cache=new Map<string,{expires:number;value:Address}>();
const json=(body:unknown,status=200,retry?:number)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,
 'Content-Type':'application/json','Cache-Control':'no-store',...(retry?{'Retry-After':String(retry)}:{})}});
const text=(value:unknown)=>typeof value==='string'?value.slice(0,500):'';
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const body=await readSmallJsonRequest(request,2048);
  if(typeof body.latitude!=='number'||typeof body.longitude!=='number'||!Number.isFinite(body.latitude)||!Number.isFinite(body.longitude)||
   body.latitude< -90||body.latitude>90||body.longitude< -180||body.longitude>180)return json({error:'Invalid coordinates'},400);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),authorization=request.headers.get('authorization');
  if(!authorization)return json({error:'Sign in to look up this address'},401);
  if(!url||!key)return json({error:'Address lookup is temporarily unavailable'},503);
  const deadline=AbortSignal.timeout(8000);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:deadline})}});
  const token=authorization.replace(/^Bearer\s+/i,'');
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user||!await hasLiveSession(db,user.id,token))return json({error:'Session ended. Sign in again.'},401);
  const budget=await consumeUserAction(db,user.id,'reverse_geocode',6,60,true);
  if(!budget.allowed)return json({address:null,error:'Address lookup is busy. Select your area or try again shortly.',retry_after_seconds:budget.retryAfterSeconds},429,budget.retryAfterSeconds);
  const provider=new URL(Deno.env.get('REVERSE_GEOCODE_URL')||'https://nominatim.openstreetmap.org/reverse');
  if(provider.protocol!=='https:')return json({address:null,error:'Address lookup configuration is unavailable'},503);
  const cacheKey=provider.origin+':'+body.latitude.toFixed(4)+':'+body.longitude.toFixed(4),saved=cache.get(cacheKey);
  if(saved&&saved.expires>Date.now())return json(saved.value);
  // The public service's one-request/second allowance is shared by the app,
  // rather than multiplied by Edge instances or valid user accounts.
  const slot=await db.rpc('take_reverse_geocode_provider_slot');
  if(slot.error)return json({address:null,error:'Address lookup is temporarily unavailable'},503);
  if(slot.data!==true)return json({address:null,error:'Address lookup is busy. Select your area or try again shortly.',retry_after_seconds:1},429,1);
  provider.searchParams.set('format','jsonv2');provider.searchParams.set('lat',String(body.latitude));provider.searchParams.set('lon',String(body.longitude));
  provider.searchParams.set('zoom','18');provider.searchParams.set('addressdetails','1');
  const headers:Record<string,string>={'User-Agent':'WeHouse/1.0 (https://wehouse.com.ng)','Accept-Language':'en'};
  const providerToken=Deno.env.get('REVERSE_GEOCODE_BEARER_TOKEN');if(providerToken)headers.Authorization='Bearer '+providerToken;
  const response=await fetch(provider,{signal:deadline,headers});
  if(!response.ok)return json({address:null,error:'Address lookup is temporarily unavailable'},503);
  const data=await readSmallJsonRequest(response,32768);
  const details=data.address&&typeof data.address==='object'&&!Array.isArray(data.address)?data.address as Record<string,unknown>:{};
  const street=[text(details.house_number),text(details.road||details.pedestrian||details.residential)].filter(Boolean).join(' ');
  const area=text(details.neighbourhood||details.suburb||details.quarter||details.hamlet||details.village);
  const locality=text(details.city||details.town||details.village||details.municipality);
  const city=text(details.state_district||details.county||details.municipality)||locality,state=text(details.state);
  const parts=[street,area,locality,city,state].map(value=>value.trim()).filter((value,index,rows)=>value&&rows.findIndex(item=>item.toLowerCase()===value.toLowerCase())===index);
  const value:Address={address:parts.length?parts.join(', '):text(data.display_name)||null,city:city||null,state:state||null};
  for(const [key,item] of cache)if(item.expires<=Date.now())cache.delete(key);
  if(cache.size>=128)cache.delete(cache.keys().next().value!);
  cache.set(cacheKey,{expires:Date.now()+300000,value});return json(value);
 }catch(error){return json({address:null,error:error instanceof JsonRequestError?error.message:'Address lookup is temporarily unavailable'},error instanceof JsonRequestError?error.status:503);}
});

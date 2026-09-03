import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from 'jsr:@supabase/supabase-js@2/cors';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'private, max-age=300'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 try{
  const body=await req.json(),latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude< -90||latitude>90||longitude< -180||longitude>180)return json({error:'Invalid coordinates'},400);
  const url=new URL('https://nominatim.openstreetmap.org/reverse');url.searchParams.set('format','jsonv2');url.searchParams.set('lat',String(latitude));url.searchParams.set('lon',String(longitude));url.searchParams.set('zoom','18');url.searchParams.set('addressdetails','1');
  const response=await fetch(url,{headers:{'User-Agent':'WeHouse/1.0 (https://wehouse.com.ng)','Accept-Language':'en'}});
  if(!response.ok)return json({address:null},200);
  const data=await response.json();return json({address:typeof data.display_name==='string'?data.display_name:null});
 }catch{return json({address:null},200)}
});

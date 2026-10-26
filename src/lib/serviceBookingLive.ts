import {supabase} from './supabase/client';

/** A signal never supplies a price. Reload the participant-authorized booking RPC. */
export function subscribeToServiceBookingChanges(bookingId:string,onChange:()=>void,onHealth:(healthy:boolean)=>void=()=>{}){
 let disposed=false;
 let channel:ReturnType<typeof supabase.channel>|undefined;
 void (async()=>{
  try{
   const {data,error}=await supabase.auth.getSession();
   if(disposed||error||!data.session?.user.id)return;
   await supabase.realtime.setAuth();if(disposed)return;
   channel=supabase.channel(`wehouse:service-booking:${data.session.user.id}`,{config:{private:true}})
    .on('broadcast',{event:'service_booking_changed'},({payload})=>{
     if(!disposed&&payload?.booking_id===bookingId){onHealth(true);onChange();}
    }).subscribe(status=>{
     if(disposed)return;onHealth(false);if(status==='SUBSCRIBED')onChange();
    });
  }catch{if(!disposed)onHealth(false);}
 })();
 return()=>{disposed=true;if(channel)void supabase.removeChannel(channel);};
}

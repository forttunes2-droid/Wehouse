// Browser presentation fixture only. SQL and module tests exercise the real private transport.
export function subscribeToServiceBookingChanges(bookingId:string,onChange:()=>void,onHealth:(value:boolean)=>void){
 const listener=(event:Event)=>{if((event as CustomEvent).detail?.booking_id===bookingId){onHealth(true);onChange();}};
 window.addEventListener('qa-service-booking-change',listener);
 return()=>window.removeEventListener('qa-service-booking-change',listener);
}

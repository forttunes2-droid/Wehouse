import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Content-Type':'application/json',
};
const PAYMENT_RETURN_URL='https://www.wehouse.com.ng/#payment-return';
const SUPPORTED_PURPOSES=new Set(['apartment_reservation','apartment_rent','rent_plan_contribution','hotel_booking','worker_booking','shared_housing_share']);
function json(body:Record<string,unknown>,status=200){return new Response(JSON.stringify(body),{status,headers:cors})}
function sameMoney(a:unknown,b:unknown){const left=Number(a??0),right=Number(b??0);return Number.isFinite(left)&&Number.isFinite(right)&&Math.round(left*100)===Math.round(right*100)}

serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
 try{
  const authHeader=req.headers.get('authorization');if(!authHeader)return json({success:false,error:'Authorization required'},401);
  const supabaseUrl=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),paystackSecret=Deno.env.get('PAYSTACK_SECRET_KEY');
  if(!supabaseUrl||!serviceKey||!paystackSecret)return json({success:false,error:'Payment server configuration is incomplete'},503);
  const db=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=authHeader.replace(/^Bearer\s+/i,'');const{data:{user},error:authError}=await db.auth.getUser(token);if(authError||!user?.email)return json({success:false,error:'Invalid or expired session'},401);
  const{data:profile,error:profileError}=await db.from('profiles').select('user_id,role,deleted,suspended,banned').eq('auth_id',user.id).maybeSingle();
  if(profileError)return json({success:false,error:profileError.message},500);if(!profile||profile.deleted||profile.suspended||profile.banned)return json({success:false,error:'Account is not active'},403);
  const body=await req.json();const reference=String(body?.reference||'').trim();if(!/^[A-Za-z0-9.=_-]{6,120}$/.test(reference))return json({success:false,error:'Invalid payment reference'},400);
  const{data:payment,error:paymentError}=await db.from('booking_payments').select('id,user_id,payer_user_id,amount,amount_total,currency,status,purpose,paystack_reference,listing_id,hotel_booking_id,worker_booking_id,metadata').eq('paystack_reference',reference).maybeSingle();
  if(paymentError)return json({success:false,error:paymentError.message},500);if(!payment||!SUPPORTED_PURPOSES.has(String(payment.purpose||'')))return json({success:false,error:'Unsupported payment request'},404);
  const owner=payment.payer_user_id||payment.user_id;if(!owner||owner!==profile.user_id)return json({success:false,error:'Payment does not belong to the authenticated account'},403);
  if(payment.status==='paid'||payment.status==='completed')return json({success:true,already_paid:true,reference,purpose:payment.purpose});
  if(payment.status!=='pending')return json({success:false,error:'This payment can no longer be initialized'},409);
  const amount=Number(payment.amount_total??payment.amount??0);if(!Number.isFinite(amount)||amount<=0)return json({success:false,error:'Invalid payment amount'},409);if((payment.currency||'NGN')!=='NGN')return json({success:false,error:'Payment must be in NGN'},409);
  const meta=payment.metadata&&typeof payment.metadata==='object'?payment.metadata as Record<string,unknown>:{};const returnPage='my_reservations';

  if(payment.purpose==='apartment_reservation'||payment.purpose==='apartment_rent'){
   const reservationId=String(meta.reservation_id||'').trim();if(!reservationId)return json({success:false,error:'Reservation link is missing'},409);
   const{data:reservation,error:reservationError}=await db.from('reservations').select('id,user_id,listing_id,status,payment_reference,payment_expires_at,rent_payment_status,rent_payment_reference,upfront_rent_required,stay_type,stay_check_in,stay_check_out,stay_rent_total,security_deposit_snapshot').eq('id',reservationId).maybeSingle();
   if(reservationError)return json({success:false,error:reservationError.message},500);if(!reservation||reservation.user_id!==profile.user_id)return json({success:false,error:'Reservation does not match this account'},403);
   const{data:listing,error:listingError}=await db.from('listings').select('id,status,current_reservation_id,deleted_at,sub_type').eq('id',reservation.listing_id).maybeSingle();
   if(listingError)return json({success:false,error:listingError.message},500);if(!listing||listing.deleted_at)return json({success:false,error:'Property is no longer available'},409);
   const short=reservation.stay_type==='short_let'||listing.sub_type==='short_let';

   if(payment.purpose==='apartment_reservation'){
    if(reservation.payment_reference!==reference||reservation.status!=='payment_pending')return json({success:false,error:'Reservation is no longer waiting for checkout'},409);
    if(reservation.payment_expires_at&&new Date(reservation.payment_expires_at).getTime()<Date.now())return json({success:false,error:'Reservation checkout hold has expired. Start the reservation again.'},409);
    if(short){
     if(!reservation.stay_check_in||!reservation.stay_check_out||new Date(`${reservation.stay_check_out}T00:00:00`).getTime()<=new Date(`${reservation.stay_check_in}T00:00:00`).getTime())return json({success:false,error:'Short Stay dates are invalid'},409);
     if(['maintenance','closed','rejected','pending_approval'].includes(String(listing.status)))return json({success:false,error:'This Short Stay is not bookable right now'},409);
    }else{
     if(listing.current_reservation_id!==reservation.id||listing.status!=='reserved')return json({success:false,error:'Property checkout hold is no longer valid'},409);
    }
   }else{
    if(!['reserved','ready_for_move_in'].includes(String(reservation.status)))return json({success:false,error:short?'Short Stay payment is not available in the current reservation state':'Year 1 rent is not available in the current reservation state'},409);
    if(reservation.rent_payment_status!=='payment_pending'||reservation.rent_payment_reference!==reference)return json({success:false,error:short?'Short Stay checkout is no longer active':'Year 1 rent checkout is no longer active'},409);
    if(short){
     if(String(meta.payment_component||'')!=='short_stay_rent')return json({success:false,error:'Short Stay payment component is invalid'},409);
     const required=Number(reservation.stay_rent_total||0)+Number(reservation.security_deposit_snapshot||0);if(!sameMoney(required,amount))return json({success:false,error:'Short Stay amount does not match the reservation terms'},409);
     if(['maintenance','closed','rejected','pending_approval'].includes(String(listing.status)))return json({success:false,error:'This Short Stay cannot accept payment right now'},409);
    }else{
     if(String(meta.payment_component||'')!=='long_stay_rent')return json({success:false,error:'Long Stay payment component is invalid'},409);
     if(!sameMoney(reservation.upfront_rent_required,amount))return json({success:false,error:'Year 1 rent amount does not match the reservation terms'},409);
     if(listing.current_reservation_id!==reservation.id||listing.status!=='reserved')return json({success:false,error:'Property is no longer reserved for this contract'},409);
    }
   }
  }

  if(payment.purpose==='rent_plan_contribution'){
   const contributionId=String(meta.contribution_id||'').trim();if(!contributionId)return json({success:false,error:'Rent contribution link is missing'},409);
   const{data:contribution,error:contributionError}=await db.from('rent_plan_contributions').select('id,rent_plan_id,reservation_id,amount,status,paystack_reference,target_year,installment_number,due_date').eq('id',contributionId).maybeSingle();
   if(contributionError)return json({success:false,error:contributionError.message},500);if(!contribution||contribution.status!=='payment_pending'||contribution.paystack_reference!==reference)return json({success:false,error:'This rent contribution checkout is no longer active'},409);if(!sameMoney(contribution.amount,amount))return json({success:false,error:'Rent contribution amount mismatch'},409);
   const{data:plan,error:planError}=await db.from('rent_plans').select('id,user_id,reservation_id,status').eq('id',contribution.rent_plan_id).maybeSingle();if(planError)return json({success:false,error:planError.message},500);if(!plan||plan.user_id!==profile.user_id||plan.status!=='active')return json({success:false,error:'Rent plan is not active for this account'},403);
   const{data:reservation,error:reservationError}=await db.from('reservations').select('id,user_id,status').eq('id',contribution.reservation_id||plan.reservation_id).maybeSingle();if(reservationError)return json({success:false,error:reservationError.message},500);if(!reservation||reservation.user_id!==profile.user_id||reservation.status!=='occupied')return json({success:false,error:'Active tenancy is required for this rent contribution'},409);
  }

  if(payment.purpose==='shared_housing_share'){
   const groupId=String(meta.shared_group_id||'').trim(),memberId=String(meta.shared_member_id||'').trim();
   if(!groupId||!memberId)return json({success:false,error:'Shared-home payment link is incomplete'},409);
   const{data:member,error:memberError}=await db.from('shared_housing_members').select('id,group_id,user_id,share_amount,payment_status,payment_reference').eq('id',memberId).maybeSingle();
   if(memberError)return json({success:false,error:memberError.message},500);
   if(!member||member.group_id!==groupId||member.user_id!==profile.user_id)return json({success:false,error:'Shared-home payment does not belong to this account'},403);
   if(member.payment_status!=='pending'||member.payment_reference!==reference)return json({success:false,error:'This roommate share is no longer awaiting payment'},409);
   if(!sameMoney(member.share_amount,amount))return json({success:false,error:'Roommate share amount mismatch'},409);
  }

  if(payment.purpose==='hotel_booking'){
   const hotelBookingId=Number(payment.hotel_booking_id??meta.hotel_booking_id??0);if(!Number.isInteger(hotelBookingId)||hotelBookingId<=0)return json({success:false,error:'Hotel booking link is missing'},409);
   const{data:booking,error:bookingError}=await db.from('hotel_bookings').select('booking_id,user_id,status,payment_status,payment_reference,payment_expires_at,total_price,booking_code').eq('booking_id',hotelBookingId).maybeSingle();
   if(bookingError)return json({success:false,error:bookingError.message},500);if(!booking||booking.user_id!==profile.user_id)return json({success:false,error:'Hotel booking does not belong to this account'},403);if(booking.status!=='pending'||booking.payment_status!=='payment_pending'||booking.payment_reference!==reference)return json({success:false,error:'Hotel booking is no longer awaiting this payment'},409);if(booking.payment_expires_at&&new Date(booking.payment_expires_at).getTime()<Date.now())return json({success:false,error:'Hotel checkout hold has expired. Choose the room again.'},409);if(!sameMoney(booking.total_price,amount))return json({success:false,error:'Hotel booking amount mismatch'},409);
  }

  if(payment.purpose==='worker_booking'){
   const workerBookingId=String(payment.worker_booking_id??meta.booking_id??'').trim();if(!workerBookingId)return json({success:false,error:'Worker booking link is missing'},409);
   const{data:booking,error:bookingError}=await db.from('worker_bookings').select('id,user_id,status,negotiated_amount,agreed_amount').eq('id',workerBookingId).maybeSingle();
   if(bookingError)return json({success:false,error:bookingError.message},500);if(!booking||booking.user_id!==profile.user_id)return json({success:false,error:'Worker booking does not belong to this account'},403);
   if(booking.status!=='waiting_payment')return json({success:false,error:'This job is no longer waiting for payment'},409);
   const required=Number(booking.negotiated_amount??booking.agreed_amount??0);if(!sameMoney(required,amount))return json({success:false,error:'Worker payment amount does not match the accepted price'},409);
  }

  const existingUrl=typeof meta.paystack_authorization_url==='string'?meta.paystack_authorization_url:'',existingCode=typeof meta.paystack_access_code==='string'?meta.paystack_access_code:'';if(existingUrl&&existingCode)return json({success:true,reference,purpose:payment.purpose,authorization_url:existingUrl,access_code:existingCode,existing:true});
  const response=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${paystackSecret}`,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,amount:String(Math.round(amount*100)),currency:'NGN',reference,callback_url:PAYMENT_RETURN_URL,metadata:JSON.stringify({purpose:payment.purpose,payment_id:payment.id,listing_id:payment.listing_id||null,hotel_booking_id:payment.hotel_booking_id||null,worker_booking_id:payment.worker_booking_id||null,reservation_id:meta.reservation_id||null,contribution_id:meta.contribution_id||null,shared_group_id:meta.shared_group_id||null,shared_member_id:meta.shared_member_id||null,booking_code:meta.booking_code||null,stay_type:meta.stay_type||null,payment_component:meta.payment_component||null,return_page:returnPage})})});
  let initialized:any=null;try{initialized=await response.json()}catch{initialized=null}if(!response.ok||!initialized?.status||!initialized?.data?.authorization_url||!initialized?.data?.access_code){const upstreamMessage=String(initialized?.message||'Paystack could not initialize this payment');console.error('[payment-init] Paystack initialization rejected',{reference,purpose:payment.purpose,status:response.status,message:upstreamMessage});return json({success:false,error:upstreamMessage,retryable:response.status>=500},response.status>=500?502:400)}
  const authorizationUrl=String(initialized.data.authorization_url),accessCode=String(initialized.data.access_code);const nextMeta={...meta,return_page:returnPage,paystack_access_code:accessCode,paystack_authorization_url:authorizationUrl,paystack_initialized_at:new Date().toISOString()};const{error:updateError}=await db.from('booking_payments').update({metadata:nextMeta,updated_at:new Date().toISOString()}).eq('id',payment.id).eq('status','pending');if(updateError)return json({success:false,error:'Could not persist payment session'},500);
  return json({success:true,reference,purpose:payment.purpose,authorization_url:authorizationUrl,access_code:accessCode,existing:false});
 }catch(error){console.error('[payment-init] unexpected failure',{message:error instanceof Error?error.message:String(error)});return json({success:false,error:error instanceof Error?error.message:'Payment initialization failed'},500)}
});

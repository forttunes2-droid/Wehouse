import { supabase } from "./client";
import {withTimeout} from '@/lib/withTimeout';
import {paymentCheckoutReceipt,type PaymentInitResult} from '../../../supabase/functions/_shared/payment-checkout';

export async function initializePaymentReference(reference:string,purpose:string):Promise<{result:PaymentInitResult|null;error:Error|null}>{
 try{
  if(!/^[A-Za-z0-9.=_-]{6,120}$/.test(reference))throw Error('The payment reference could not be confirmed.');
  const {data,error}=await withTimeout(supabase.functions.invoke('payment-init',{body:{reference}}),25000,'Checkout result is unknown. Refresh this booking before retrying.');
  if(error){
   let message=error.message||'Payment checkout could not start';
   try{const body=await error.context?.clone?.().json();if(typeof body?.error==='string'&&body.error.length<=2000)message=body.error;}catch{/* A transport error may have no JSON response. */}
   throw Error(message);
  }
  return{result:paymentCheckoutReceipt(data,reference,purpose),error:null};
 }catch(cause){return{result:null,error:cause instanceof Error?cause:new Error('Checkout could not be confirmed. Refresh before retrying.')};}
}

export async function initializeApartmentRentPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc(
    "create_apartment_rent_payment",
    {
      p_reservation_id: reservationId,
    },
  );
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid)
    return { result: bootstrap as PaymentInitResult, error: null };

  const reference = String(bootstrap.reference || "");
  if (!reference)
    return {
      result: { success: false, error: "Rent payment reference is missing" },
      error: null,
    };
  return initializePaymentReference(reference,'apartment_rent');
}

export async function initializeShortStayPayment(reservationId: string) {
  const { data: bootstrap, error: bootstrapError } = await supabase.rpc(
    "create_short_stay_payment",
    {
      p_reservation_id: reservationId,
    },
  );
  if (bootstrapError) return { result: null, error: bootstrapError };
  if (!bootstrap?.success) return { result: bootstrap || null, error: null };
  if (bootstrap.already_paid)
    return { result: bootstrap as PaymentInitResult, error: null };
  const reference = String(bootstrap.reference || "");
  if (!reference)
    return {
      result: {
        success: false,
        error: "Short Let payment reference is missing",
      },
      error: null,
    };
  return initializePaymentReference(reference,'apartment_rent');
}


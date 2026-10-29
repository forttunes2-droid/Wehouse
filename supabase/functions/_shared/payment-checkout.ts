/** Shared by the provider initializer and browser adapters. Never a payment-status authority. */
export function paystackCheckoutDestination(value:unknown):string|null{
 if(typeof value!=='string'||value.length>2048)return null;
 try{
  const url=new URL(value);
  return url.origin==='https://checkout.paystack.com'&&!url.username&&!url.password&&url.pathname.length>1?url.href:null;
 }catch{return null;}
}
export type PaymentInitResult={success:boolean;already_paid?:boolean;reference?:string;purpose?:string;authorization_url?:string;access_code?:string;existing?:boolean;error?:string};
export function paymentCheckoutReceipt(value:unknown,reference:string,purpose:string):PaymentInitResult{
 const r=value as PaymentInitResult|null;
 if(r?.success===false&&typeof r.error==='string'&&r.error.trim()&&r.error.length<=2000)return{success:false,error:r.error};
 if(!r||r.success!==true||r.reference!==reference||r.purpose!==purpose
  ||(r.already_paid!==undefined&&typeof r.already_paid!=='boolean')
  ||(r.existing!==undefined&&typeof r.existing!=='boolean'))throw Error('The checkout receipt does not match this payment. Refresh before retrying.');
 if(r.already_paid===true)return{success:true,already_paid:true,reference,purpose};
 const destination=paystackCheckoutDestination(r.authorization_url);
 if(!destination)throw Error('The payment destination could not be confirmed. Refresh before retrying.');
 return{success:true,reference,purpose,authorization_url:destination,already_paid:false,existing:r.existing};
}

import {supabase} from '@/lib/supabase';
import {withTimeout} from '@/lib/withTimeout';
import {propertySubmissionReceipt} from '@/lib/propertySpaces';

/** Recover the existing batch after an unknown write; never create a replacement batch. */
export async function submitPropertyBatch(batchId:string,items:unknown[]){
 let knownFailure:string|null=null;
 try{
  const result=await withTimeout(supabase.rpc('create_my_property_inspection_batch_v4',{p_batch_id:batchId,p_items:items}),15000,'Property confirmation took too long.');
  if(result.error){if(result.error.code==='P0001'&&/^(Review and accept the current fees|Fees changed or are unavailable)/.test(result.error.message))knownFailure=result.error.message;throw result.error;}
  return propertySubmissionReceipt(result.data,batchId,items.length);
 }catch{
  try{
   const saved=await withTimeout(supabase.rpc('get_my_property_submission_receipt',{p_batch_id:batchId,p_items:items}),15000,'Property status could not be loaded.');
   if(saved.error)throw saved.error;
   return propertySubmissionReceipt(saved.data,batchId,items.length);
  }catch{throw Error(knownFailure||'Submission is not confirmed. Check your submitted properties before trying again. Uploaded evidence has been kept.');}
 }
}

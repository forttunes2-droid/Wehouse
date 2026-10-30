import {withTimeout} from './withTimeout';

/** Browser screening requests independent review; it never verifies identity. */
export async function confirmIdentityReviewSubmission(
  command:PromiseLike<{data:unknown;error:unknown}>,workspace:'worker'|'property_partner',
) {
  const {data,error}=await withTimeout(command,15000,'Identity submission could not be confirmed. Refresh your workspace before starting another check.');
  const receipt=data as {success?:unknown;current?:unknown;status?:unknown;workspace?:unknown}|null;
  if(error||receipt?.success!==true||receipt.current!==false||receipt.status!=='pending_review'||receipt.workspace!==workspace){
    throw new Error('Identity submission could not be confirmed. Refresh your workspace before starting another check.');
  }
  return receipt;
}

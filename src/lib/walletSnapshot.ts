/** Current NGN wallet contract: do not invent zero or hide a genuine signed balance. */
export function validWalletSnapshot(value:unknown,idField:'id'|'wallet_id'){
 if(!value||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 if(typeof row[idField]!=='string'||!row[idField]||typeof row.is_frozen!=='boolean')return false;
 return ['available_balance','pending_balance','frozen_balance','total_withdrawn'].every(key=>{
  const amount=row[key];if(typeof amount!=='number'||!Number.isFinite(amount))return false;
  const minor=Math.round(amount*100);
  return Number.isSafeInteger(minor)&&Math.abs(amount*100-minor)<0.000001;
 });
}

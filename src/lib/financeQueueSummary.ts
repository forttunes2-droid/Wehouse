export function financeQueueSummary(report:unknown){
  if(!report||typeof report!=='object')throw new Error('Finance summary is incomplete');
  const row=report as Record<string,unknown>;
  if(!['creator','admin','staff'].includes(String(row.actor_role)))throw new Error('Finance authority could not be confirmed');
  const keys=['payments','withdrawals','refunds','financial_actions','commissions','payment_protection','audit'] as const;
  for(const key of keys)if(!Array.isArray(row[key]))throw new Error('Finance summary is incomplete');
  const count=(key:typeof keys[number])=>(row[key] as unknown[]).length;
  return {payments:count('payments'),payouts:count('withdrawals')+count('refunds')+count('financial_actions'),ledger:count('commissions')+count('payment_protection')+count('audit')};
}

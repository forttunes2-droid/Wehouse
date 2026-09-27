import type { SharedHousingGroup } from '@/lib/supabase/shared-housing';
export function sharedHousingLane(group: SharedHousingGroup, userId: string, now = Date.now()): 'action'|'active'|'history' {
  if (['cancelled','expired','refunded'].includes(group.status) || ['completed','cancelled','expired','refunded'].includes(group.booking_status || '')) return 'history';
  if (!['paid','complete'].includes(group.status) && Date.parse(group.expires_at)<=now) return 'history';
  const mine=group.members.find(member=>member.user_id===userId);
  if (mine?.invitation_status==='invited' || (mine?.invitation_status==='accepted' && mine.payment_status!=='paid' && ['ready','payment_pending'].includes(group.status))) return 'action';
  return 'active';
}
export function sharedAmounts(rent: number, deposit: number, members:number) {
  if (![rent,deposit].every(Number.isFinite) || rent<=0 || deposit<0 || !Number.isInteger(members) || members<2 || members>12) return null;
  const r=Math.round(rent*100), d=Math.round(deposit*100), total=r+d;
  if (![r,d,total].every(Number.isSafeInteger)) return null;
  return Array.from({length:members},(_,index)=>{
    const sum=Math.floor(total/members)+(index<total%members?1:0);
    const stay=Math.floor(r/members)+(index<r%members?1:0);
    return {rent:stay/100,deposit:(sum-stay)/100,total:sum/100};
  });
}

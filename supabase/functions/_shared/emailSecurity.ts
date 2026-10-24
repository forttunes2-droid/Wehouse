export type EmailSecurityPurpose = 'device_confirmation' | 'password_recovery';
export function securityPurpose(value: unknown): EmailSecurityPurpose | null {
  return value==='device_confirmation'||value==='password_recovery'?value:null;
}
export function createEmailSecurityCode() {
  // Rejection sampling avoids modulo bias. Codes are eight decimal digits.
  const range=100_000_000,limit=Math.floor(0x1_0000_0000/range)*range;
  const bytes=new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while(bytes[0]>=limit);
  return String(bytes[0]%range).padStart(8,'0');
}
export async function emailSecurityHash(secret:string,id:string,authId:string,purpose:EmailSecurityPurpose,code:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify([id,authId,purpose,code])));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function sameEmailSecurityHash(left:string,right:string) {
  if(left.length!==64||right.length!==64)return false;
  let difference=0;for(let i=0;i<64;i++)difference|=left.charCodeAt(i)^right.charCodeAt(i);
  return difference===0;
}
export async function sendEmailSecurityCode(config:{apiKey:string;from:string},email:string,code:string,purpose:EmailSecurityPurpose) {
  const action=purpose==='device_confirmation'?'Confirm your WeHouse device':'Reset your WeHouse password';
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:config.from,to:[email],subject:action,
      text:`${action}\n\nYour code is ${code}. It expires in 10 minutes. Enter it only in WeHouse. Never share it with anyone, including WeHouse support.\n\nIf you did not request this, ignore this email and review your signed-in devices.`}),
    signal:AbortSignal.timeout(12000),
  });
  if(!response.ok)return false;
  const receipt=await response.json().catch(()=>null);
  return typeof receipt?.id==='string'&&receipt.id.length>0;
}

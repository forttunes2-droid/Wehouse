import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
export type AuthenticationRequirement={auth_id:string;required:boolean;enrolled:boolean;stage:'setup'|'challenge'|'ready'};
export async function getAuthenticationRequirement(authId:string):Promise<AuthenticationRequirement>{
 const result=await withTimeout(supabase.rpc('get_my_authentication_requirements'),15000,'Account security could not be checked. Try signing in again.');
 const data=result.data as AuthenticationRequirement|null;
 if(result.error||!data||data.auth_id!==authId||typeof data.required!=='boolean'||typeof data.enrolled!=='boolean'||!['setup','challenge','ready'].includes(data.stage))throw Error('Account security could not be confirmed. Try signing in again.');
 return data;
}

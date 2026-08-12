import { useEffect,useState } from 'react';
import { supabase } from '@/lib/supabase';
import SupportChat from '@/components/SupportChat';

type ChatProfile={user_id:string;username:string|null;email:string;role?:string};
export default function SupportBridge(){const[profile,setProfile]=useState<ChatProfile|null>(null);useEffect(()=>{let live=true;void(async()=>{const{data:{user}}=await supabase.auth.getUser();if(!user||!live)return;const{data}=await supabase.from('profiles').select('user_id,username,email,role').eq('auth_id',user.id).maybeSingle();if(live&&data&&['worker','property_partner'].includes(data.role))setProfile(data as ChatProfile)})();return()=>{live=false}},[]);if(!profile)return null;return <div className="operational-support-bridge"><style>{`.operational-support-bridge>button[aria-label="WeHouse Support"]{display:none}`}</style><SupportChat profile={profile}/></div>}

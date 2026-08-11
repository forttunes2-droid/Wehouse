import AccountCenter from '@/pages/AccountCenter';
import type { Profile } from '@/types';

type Props={profile:Profile;onLogout:()=>void;onNavigate?:(page:string)=>void;onGoToProfileEdit?:()=>void;onGoToChat?:()=>void;onGoToAccount?:()=>void;isAdmin?:boolean;onGoToNewListing?:()=>void};
export default function Dashboard({profile,onLogout,onNavigate,onGoToProfileEdit}:Props){return <AccountCenter profile={profile} onGoToProfileEdit={onGoToProfileEdit||(()=>onNavigate?.('profile_edit'))} onGoToPrivacy={()=>onNavigate?.('privacy')} onGoToSecurity={()=>onNavigate?.('security')} onLogout={onLogout}/>}

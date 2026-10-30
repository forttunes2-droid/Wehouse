import {createRoot} from 'react-dom/client';
import PrivacySecuritySettings from '../../src/pages/PrivacySecuritySettings';
import OpenSourceLicences from '../../src/components/OpenSourceLicences';
import PersonalDataCaseReview from '../../src/components/PersonalDataCaseReview';
import PaidPlanBilling from '../../src/components/PaidPlanBilling';
import SecuritySettings from '../../src/pages/SecuritySettings';
import {Toaster} from 'sonner';
import {CreatorAuthProvider} from '../../src/hooks/useCreatorAuth';
import CreatorAuthModal from '../../src/components/CreatorAuthModal';
import {fixtureProfile} from './authFixture';
import '../../src/index.css';
const mode=new URLSearchParams(location.search).get('mode');
window.addEventListener('openSupportChat',event=>{(window as unknown as {__personalDataContext:unknown}).__personalDataContext=(event as CustomEvent).detail;});
createRoot(document.getElementById('root')!).render(<CreatorAuthProvider>
 {mode==='billing'?<PaidPlanBilling profile={fixtureProfile} workspace="personal" onBack={()=>{}}/>:mode==='close'?<SecuritySettings profile={{...fixtureProfile,role:'user'}} focus="close"/>:mode==='licences'?<OpenSourceLicences profile={fixtureProfile} onBack={()=>{}}/>:mode==='privacy'?<PrivacySecuritySettings profile={{...fixtureProfile,role:'user'}} onUpdate={()=>{}} onBack={()=>{}}/>:<main className="min-h-screen bg-[var(--wh-bg)] text-[var(--wh-text)]"><PersonalDataCaseReview conversationId="99700000-1000-4000-8000-000000000001" creator onResolved={()=>{(window as unknown as {__reviewResolved:boolean}).__reviewResolved=true;}}/></main>}
 <CreatorAuthModal/>
 <Toaster/>
</CreatorAuthProvider>);

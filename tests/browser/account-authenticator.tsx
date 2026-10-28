import {createRoot} from 'react-dom/client';
import {useAuth} from '@/hooks/useAuth';
import AccountAuthenticatorGate from '@/components/AccountAuthenticatorGate';
function Fixture(){const auth=useAuth();Object.assign(window,{__authContinue:auth.handleLoginSuccess});return auth.isLoading?<p>Loading account</p>:auth.pendingMfa?<AccountAuthenticatorGate requirement={auth.pendingMfa} onVerified={auth.completeSecondFactor} onSignOut={auth.logout}/>:auth.profile?<h1>Verified workspace</h1>:<p>{auth.error||'Signed out'}</p>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

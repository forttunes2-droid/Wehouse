import {Toaster} from 'sonner';
import {resolvedAppearance,useAppearance} from '@/lib/appearance';

export default function WeHouseToaster(){
 const appearance=useAppearance();
 return <Toaster position="top-center" theme={resolvedAppearance(appearance)} visibleToasts={1} duration={3200} closeButton
  offset="max(12px, env(safe-area-inset-top))" mobileOffset="max(12px, env(safe-area-inset-top))"
  style={{zIndex:2147483647}} toastOptions={{style:{background:'var(--wh-elevated)',color:'var(--wh-text)',borderColor:'var(--wh-border)',borderRadius:'14px',padding:'12px 14px',fontSize:'13px',lineHeight:'1.4',boxShadow:'var(--wh-shadow-md)'}}}/>;
}

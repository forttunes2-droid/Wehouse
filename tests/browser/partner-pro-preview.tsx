import { createRoot } from 'react-dom/client';
import PropertyPartnerProWorkspace from '@/components/PropertyPartnerProWorkspace';
import '@/index.css';
createRoot(document.getElementById('root')!).render(<PropertyPartnerProWorkspace profile={{user_id:'preview-partner',role:'property_partner'} as any}/>);

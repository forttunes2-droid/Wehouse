import { createRoot } from 'react-dom/client';
import LongLetRentTermsPanel from '../../src/components/LongLetRentTermsPanel';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl p-4"><LongLetRentTermsPanel listingId="b7990000-2000-4000-8000-000000000001"/></main>);

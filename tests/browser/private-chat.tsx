import {createRoot} from 'react-dom/client';
import SecureMessagesPanel from '../../src/components/SecureMessagesPanel';
createRoot(document.getElementById('root')!).render(<main className="mx-auto min-h-screen max-w-xl bg-[var(--wh-bg)] p-3 text-[var(--wh-text)] sm:p-6"><SecureMessagesPanel onReady={()=>{(window as unknown as {__ready:boolean}).__ready=true;}}/></main>);

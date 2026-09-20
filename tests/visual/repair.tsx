import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReceiptViewer } from '../../src/components/PaymentReceipt';
import RoommatePublicProfile from '../../src/components/RoommatePublicProfile';
import { PublicProfileAction } from '../../src/components/PublicProfileSurface';
import '../../src/index.css';
const receipt = { id: 'layout-only', reference: 'WH-TEST-LAYOUT-12345678901234567890-12345678901234567890', purpose: 'hotel_booking', amount: 180000, currency: 'NGN', paid_at: '2026-09-20T10:00:00Z', status: 'paid', environment: 'test' as const, payer_name: 'Example Customer', merchant_name: 'Example Hotel and Suites', description: 'Deluxe room', package_name: 'Breakfast included', check_in: '2026-09-24', check_out: '2026-09-30', nights: 6, guests: 2 };
function Review() {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(390);
  const [view, setView] = useState('receipt');
  const inner = new URLSearchParams(location.search).get('view');
  if (inner === 'receipt') return <><button onClick={() => setOpen(true)}>Open example receipt</button><ReceiptViewer open={open} onClose={() => setOpen(false)} receipt={receipt} /></>;
  if (inner === 'conversation') return open ? <RoommatePublicProfile context="conversation" person={{ name: 'Example Contact', username: 'example', bio: 'Example public profile. This is separate from conversation info.', location: 'Lafia, Nasarawa', occupation: 'Designer' }} onClose={() => setOpen(false)} actions={<PublicProfileAction label="Audio" onClick={() => {}}>☎</PublicProfileAction>} /> : <button onClick={() => setOpen(true)}>Open conversation info</button>;
  return <main style={{ padding: 12, color: 'white' }}><h1>Layout review · simulated data</h1><p>No customer, verification, or payment changes.</p><div style={{display:'flex',gap:16,margin:'12px 0'}}>{[320,390,768].map(size => <button onClick={() => setWidth(size)} key={size}>{size}px</button>)}{['receipt','conversation'].map(kind => <button key={kind} onClick={() => setView(kind)}>{kind}</button>)}</div><iframe title={`${width}px ${view} review`} key={`${width}:${view}`} src={`?view=${view}`} style={{width,height:800,border:'1px solid #777'}} /></main>;
}
createRoot(document.getElementById('root')!).render(<Review />);

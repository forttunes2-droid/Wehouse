import {useState} from 'react';
import AccountRecoveryCenter from '@/components/AccountRecoveryCenter';
export default function AccountReviewEntry({signedIn=true}:{signedIn?:boolean}){
 const [open,setOpen]=useState(false);
 return <section className="space-y-3"><button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="min-h-11 rounded-xl border border-[var(--wh-border-subtle)] px-4 text-sm font-semibold text-[var(--wh-text)]">{open?'Close account reviews':'Review account or work profile restrictions'}</button>{open&&<AccountRecoveryCenter signedIn={signedIn}/>}</section>;
}

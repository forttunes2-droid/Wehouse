import { useState } from 'react';
import OfficialChannel from '@/components/OfficialChannel';
import OfficialEntryCard from '@/components/OfficialEntryCard';
import SupportEntryCard from '@/components/SupportEntryCard';
import type { Profile } from '@/types';

type Props={profile:Profile;title?:string;description?:string};

export default function CommunicationInbox({profile,title='Messages',description='Official updates and human support in one place.'}:Props){
 const[officialOpen,setOfficialOpen]=useState(false);
 if(officialOpen)return <OfficialChannel profile={profile} onBack={()=>setOfficialOpen(false)}/>;
 return <div className="space-y-4"><div><h2 className="text-base font-bold text-white">{title}</h2><p className="mt-1 text-[10px] leading-relaxed text-[#696E7F]">{description}</p></div><section className="overflow-hidden rounded-2xl border border-white/[.06] bg-[#11141C]"><OfficialEntryCard profile={profile} compact onOpen={()=>setOfficialOpen(true)}/><div className="ml-[4.5rem] h-px bg-white/[.05]"/><SupportEntryCard profile={profile} compact/></section><p className="px-1 text-[9px] leading-relaxed text-[#555A69]">WeHouse Official is read-only. WeHouse Support connects you to a real team member for account-specific help.</p></div>
}

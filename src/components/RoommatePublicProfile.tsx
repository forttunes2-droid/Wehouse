import type { ReactNode } from "react";

export type RoommatePublicProfileData = {
  name: string;
  username?: string | null;
  avatar?: string | null;
  location?: string;
  bio?: string | null;
  school?: string | null;
  occupation?: string | null;
  preferredArea?: string | null;
};

type Props = { person:RoommatePublicProfileData; onClose:()=>void; score?:number; matchLabel?:string; highlights?:string[]; presence?:string; actions?:ReactNode; footer?:ReactNode };

export default function RoommatePublicProfile({person,onClose,score,matchLabel,highlights=[],presence,actions,footer}:Props){
  const hasScore=Number.isFinite(score);
  return <div className="fixed inset-0 z-[100100] overflow-y-auto bg-[#090B10] text-white" role="dialog" aria-modal="true" aria-label={`${person.name} roommate profile`}>
    <header className="sticky top-0 z-10 border-b border-white/[.06] bg-[#090B10]/95 px-3 py-2.5 backdrop-blur-xl"><div className="mx-auto flex max-w-xl items-center gap-2"><button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full text-xl text-[#A6ABB9]" aria-label="Close profile">←</button><div><p className="text-[8px] font-bold uppercase tracking-[.18em] text-violet-400">Roommates</p><h2 className="text-sm font-semibold">Profile</h2></div></div></header>
    <main className="mx-auto max-w-xl px-5 pb-12 pt-8">
      <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-white/[.08] bg-violet-500/15 text-3xl font-bold text-violet-100">{person.avatar?<img src={person.avatar} alt={`${person.name} profile`} className="h-full w-full object-cover"/>:person.name[0]?.toUpperCase()||'W'}</div>
      <h3 className="mt-5 text-center text-2xl font-bold">{person.name}</h3>
      {person.username&&<p className="mt-1 text-center text-[10px] text-[#767C8C]">@{person.username.replace(/^@/,'')}</p>}
      <p className="mt-2 text-center text-[10px] text-[#8A90A0]">{[person.location,presence].filter(Boolean).join(' · ')||'Roommate connection'}</p>
      {actions&&<div className="mt-6">{actions}</div>}
      {hasScore&&<section className="mt-7 border-y border-white/[.07] py-5"><div className="flex items-end justify-between"><div><p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#666D7E]">Compatibility</p><p className="mt-1 text-sm font-semibold">{matchLabel||'Roommate match'}</p></div><strong className="text-3xl text-violet-300">{score}%</strong></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-violet-500" style={{width:`${Math.min(100,Math.max(0,Number(score)))}%`}}/></div>{highlights.length>0&&<p className="mt-3 text-[10px] text-[#777D8D]">Strongest alignment · {highlights.join(' · ')}</p>}</section>}
      <section className="divide-y divide-white/[.06] border-b border-white/[.06]">{person.preferredArea&&<Detail label="Preferred area" value={person.preferredArea}/>} {person.school&&<Detail label="School" value={person.school}/>} {person.occupation&&<Detail label="Occupation" value={person.occupation}/>}</section>
      <section className="py-6"><p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#666D7E]">About</p><p className="mt-2 text-[12px] leading-6 text-[#A2A7B5]">{person.bio||'This person has not added an introduction yet.'}</p></section>
      {footer}
    </main>
  </div>
}

function Detail({label,value}:{label:string;value:string}){return <div className="flex items-start justify-between gap-6 py-4"><span className="text-[9px] text-[#686E7E]">{label}</span><strong className="max-w-[68%] text-right text-[11px] font-semibold text-[#D7DAE3]">{value}</strong></div>}

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MessagePress from '../../src/components/MessagePress';
import '../../src/index.css';

function GestureFixture() {
  const [reply,setReply]=useState('None');
  const [count,setCount]=useState(0);
  const [actions,setActions]=useState(0);
  const [plays,setPlays]=useState(0);
  return <main className="min-h-screen bg-[#090B10] px-3 py-6 text-white">
    <h1 className="text-lg">Message gestures</h1>
    <output aria-label="Reply result">{reply}</output>
    <output aria-label="Reply count">{count}</output>
    <output aria-label="Action count">{actions}</output>
    <output aria-label="Voice plays">{plays}</output>
    <button type="button" onClick={()=>{setReply('None');setCount(0);setActions(0);}} className="my-4 block rounded-xl bg-violet-500 px-4 py-3">Reset gesture result</button>
    <div className="space-y-8">
      {(['incoming','outgoing'] as const).map(side=><section key={side} data-testid={side}>
        <MessagePress className={`flex items-center ${side==='outgoing'?'justify-end':'justify-start'}`} onOpen={()=>setActions(n=>n+1)} onReply={()=>{setReply(side);setCount(n=>n+1);}}>
          <div className={`max-w-[86%] rounded-2xl px-4 py-4 ${side==='outgoing'?'bg-violet-500':'bg-[#171B24]'}`}>
            <p className="py-4" data-testid={`${side}-text`}>{side==='outgoing'?'My message':'Their message'}</p>
            <button type="button" onClick={()=>setPlays(n=>n+1)}>Play voice note</button>
          </div>
        </MessagePress>
      </section>)}
    </div>
    <div aria-hidden="true" className="h-[900px]" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><GestureFixture /></StrictMode>);

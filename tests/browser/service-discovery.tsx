import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import WorkerDiscovery from '../../src/pages/WorkerDiscovery';
import type {Profile} from '../../src/types';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
function Fixture(){
 const [viewer,setViewer]=useState('coverage-viewer'),[initial,setInitial]=useState(new URLSearchParams(location.search).get('id'));
 useEffect(()=>{const change=()=>setViewer('another-viewer');window.addEventListener('qa-service-viewer',change);return()=>window.removeEventListener('qa-service-viewer',change);},[]);
 return <WorkerDiscovery initialWorkerId={initial} onInitialWorkerOpened={()=>setInitial(null)} preSelectedCategory={new URLSearchParams(location.search).get('category')} profile={{user_id:viewer,role:'user',state:'Nasarawa',city:'Keffi',local_government:'Keffi'} as Profile}/>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

import {createRoot} from 'react-dom/client';
import WorkerDiscovery from '../../src/pages/WorkerDiscovery';
import type {Profile} from '../../src/types';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
createRoot(document.getElementById('root')!).render(<WorkerDiscovery profile={{user_id:'coverage-viewer',role:'user',state:'Nasarawa',city:'Keffi',local_government:'Keffi'} as Profile}/>);

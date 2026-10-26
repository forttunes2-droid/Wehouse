import {createRoot} from 'react-dom/client';
import FriendChat from '../../src/components/FriendChat';
import '../../src/index.css';
document.documentElement.dataset.whTheme=new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
createRoot(document.getElementById('root')!).render(<FriendChat friend={{friend_id:'95100000-0000-4000-8000-000000000001',user_id:'history-peer',username:'friend',full_name:'Friend',avatar_url:null,status:'accepted',requested_by_me:false}} myUserId="history-me" onClose={()=>{}} onNavigate={(page,id)=>{(window as any).__friendDestination={page,id};}}/>);

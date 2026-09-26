import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import RoommatePreferencesPanel from '../../src/components/RoommatePreferencesPanel';
import RoommatePublicProfile from '../../src/components/RoommatePublicProfile';
import WorkerPublicationControls from '../../src/components/WorkerPublicationControls';
import ShortLetSplitCosts from '../../src/components/ShortLetSplitCosts';
import SharedHousingDetails from '../../src/components/SharedHousingDetails';
import {roommatePreferenceForm,roommatePreferenceError} from '../../src/lib/roommatePreferences';
import {nigeriaCalendarDate} from '../../src/lib/shortLetQuote';
import './stabilisationClientFixture';
import '../../src/index.css';
const w=window as any;
function Fixture(){
 const mode=w.__practicalMode||'preferences';
 const [form,setForm]=useState(()=>roommatePreferenceForm(null,'Example Polytechnic'));
 const [error,setError]=useState(''),[saved,setSaved]=useState(false),[open,setOpen]=useState(true),[group,setGroup]=useState('');
 w.__getForm=()=>form;
 const save=()=>{const validation=roommatePreferenceError(form,nigeriaCalendarDate());setError(validation||'');if(!validation){w.__savedForm=form;setSaved(true);}};
 return <div className="mx-auto min-h-screen max-w-2xl bg-[#090B10] px-4 py-5 text-white sm:px-6"><h1 className="mb-5 text-xl font-semibold">{mode.includes('publication')?'Creator · Worker Operations':mode==='preferences'?'Find someone to live with':'WeHouse'}</h1>
 {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
 {mode==='preferences'&&<>{saved&&<p role="status">Your moving preferences are saved.</p>}<RoommatePreferencesPanel form={form} setForm={setForm} busy={false} onSave={save}/></>}
 {mode==='profile'&&open&&<RoommatePublicProfile person={{name:'Bola Example',username:'bola',preferredArea:'Lafia',bio:'Looking for a calm shared home.'}} score={75} comparedAnswers={4} matchLabel="Strong preference match" highlights={['Same preferred LGA','Your annual rent ranges overlap']} discuss={['Different expectations about overnight visitors']} onClose={()=>setOpen(false)}/>}
 {mode.includes('publication')&&<WorkerPublicationControls userId="qa-creator" workerId={mode==='publication-worker'?'qa-worker':undefined}/>}
 {mode==='split'&&!group&&<><p className="text-sm leading-6">Short Let · dates reserved</p><ShortLetSplitCosts userId="qa-owner" row={{id:'reservation-existing',stay_type:'short_let',status:'reserved',guest_count:3,stay_rent_total:1000,security_deposit_snapshot:500,rent_payment_status:'not_started',reservation_fee_status:'paid',manual_payment_status:'paid',reservation_fee_snapshot:10000,short_stay_balance_due_at:new Date(Date.now()+24*60*60*1000).toISOString(),stay_check_in:'2027-03-20',stay_check_out:'2027-03-21'}} onCreated={item=>{w.__createdGroup=item;setGroup(item.id);}}/></>}
 {(mode==='shared-guest'||group)&&open&&<SharedHousingDetails groupId={group||'shared-existing'} userId={mode==='shared-guest'?'qa-bola':'qa-owner'} onBack={()=>{setOpen(false);w.__closed=true;}} onChanged={()=>{w.__changed=(w.__changed||0)+1;}} onOpenListing={id=>{w.__openedListing=id;}} onOpenBooking={id=>{w.__openedBooking=id;}}/>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);

import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/client';
import {withTimeout} from '@/lib/withTimeout';
import {preparePersonalDataExport,EXPORT_LABELS} from '@/lib/personalDataExport';
import type {PersonalDataExportAccess} from '@/lib/personalDataReview';
import {Button} from '@/components/ui/button';

export default function PersonalDataExportDownload({conversationId,access}:{conversationId:string;access:PersonalDataExportAccess}){
 const [section,setSection]=useState(access.sections[0]||''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [cursors,setCursors]=useState<Record<string,string|null>>({}),[parts,setParts]=useState<Record<string,number>>({});
 const generation=useRef(0),lock=useRef(false);
 useEffect(()=>{generation.current++;setCursors({});setParts({});setNotice('');setError('');setBusy(false);lock.current=false;return()=>{generation.current++;};},[conversationId,access.approval_id]);
 async function download(){
  if(lock.current||!access.can_download||!access.approval_id||!access.sections.includes(section))return;
  lock.current=true;setBusy(true);setError('');setNotice('');const current=generation.current;
  try{
   const part=await preparePersonalDataExport(async request=>{
    const {data,error}=await withTimeout(supabase.rpc('get_my_personal_data_export_page',{p_conversation_id:request.conversationId,p_approval_id:request.approvalId,p_section:request.section,p_cursor:request.cursor}),15000,'The download took too long. Retry this part.');
    if(error)throw error;return data;
   },{conversationId,approvalId:access.approval_id,section,cursor:cursors[section]??null},()=>current===generation.current);
   if(current!==generation.current)return;
   const url=URL.createObjectURL(new Blob([part.text],{type:'application/x-ndjson;charset=utf-8'})),link=document.createElement('a');
   link.href=url;link.download=`wehouse-${section}-part-${parts[section]||1}.jsonl`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
   setCursors(p=>({...p,[section]:part.nextCursor}));setParts(p=>({...p,[section]:part.nextCursor?(p[section]||1)+1:1}));
   setNotice(`${part.count} records prepared. ${part.nextCursor?'Download the next part to continue.':'This section is complete; check your browser downloads.'}`);
  }catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:(cause as {message?:string})?.message||'The download failed. Retry this part.');}
  finally{if(current===generation.current){lock.current=false;setBusy(false);}}
 }
 if(!access.can_download)return null;
 return <div className="space-y-3 rounded-xl border border-[var(--wh-border)] p-4">
  <h3 className="font-semibold">Download your account records</h3>
  <p className="text-sm leading-6 text-[var(--wh-text-secondary)]">{access.scope_note} Files may contain private information; keep them somewhere safe.</p>
  <label className="block space-y-2 text-sm"><span>Records to download</span><select value={section} onChange={e=>{setSection(e.target.value);setNotice('');setError('');}} disabled={busy} className="min-h-12 w-full rounded-xl border border-[var(--wh-border)] bg-[var(--wh-elevated)] px-3">{access.sections.filter(s=>Object.hasOwn(EXPORT_LABELS,s)).map(s=><option key={s} value={s}>{EXPORT_LABELS[s]}</option>)}</select></label>
  <Button type="button" variant="outline" className="min-h-11" disabled={busy||!section} onClick={()=>void download()}>{busy?'Preparing records…':cursors[section]?'Download next part':'Download records'}</Button>
  {notice&&<p role="status" className="text-sm leading-6">{notice}</p>}{error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
 </div>;
}

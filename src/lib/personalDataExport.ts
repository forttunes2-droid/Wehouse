export type ExportPage={conversation_id:string;approval_id:string;section:string;cursor:string|null;next_cursor:string|null;records:Record<string,unknown>[];prepared_at:string};
export type ExportRequest={conversationId:string;approvalId:string;section:string;cursor:string|null};
export type ExportReader=(request:ExportRequest)=>Promise<unknown>;
export const EXPORT_LABELS:Record<string,string>={account:'Account information',private_location:'Private location',age_information:'Age information',services:'Services offered',service_area:'Service area',home_bookings:'Home bookings',hotel_bookings:'Hotel bookings',service_requests:'Service requests',provided_services:'Services provided',activity_bookings:'Activity bookings',payments:'Payments',wallets:'Wallet records',requests:'Help and review requests',sent_friend_messages:'Sent Friend messages (encrypted)'};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function exportPage(value:unknown,request:ExportRequest):ExportPage{
 const p=value as ExportPage;
 if(!p||p.conversation_id!==request.conversationId||p.approval_id!==request.approvalId||p.section!==request.section||p.cursor!==request.cursor||!(p.next_cursor===null||(typeof p.next_cursor==='string'&&p.next_cursor.length>0&&p.next_cursor.length<=128&&p.next_cursor!==request.cursor))||!Array.isArray(p.records)||p.records.length>25||p.records.some(r=>!r||typeof r!=='object'||Array.isArray(r))||!Number.isFinite(Date.parse(p.prepared_at)))throw Error('The data page could not be confirmed. Retry this download.');
 return p;
}
/** One part stays below 5 MiB/1,000 records; continuation is explicit. */
export async function preparePersonalDataExport(read:ExportReader,request:ExportRequest,isCurrent:()=>boolean=()=>true){
 if(!uuid.test(request.conversationId)||!uuid.test(request.approvalId)||!Object.hasOwn(EXPORT_LABELS,request.section))throw Error('Refresh this request before downloading data.');
 const encoder=new TextEncoder();let cursor=request.cursor,totalBytes=0,count=0;
 const pieces=[JSON.stringify({format:'wehouse-account-records-jsonl-v1',section:request.section,approval_id:request.approvalId,notice:'Records are read at preparation time. Original media and supplementary records remain in the case review. Friend messages remain encrypted.'})+'\n'];
 const seen=new Set<string|null>();
 for(let page=0;page<40;page++){
  if(!isCurrent())throw Error('This download was cancelled because the account or request changed.');
  if(seen.has(cursor))throw Error('The export repeated a page. Refresh this request.');seen.add(cursor);
  const result=exportPage(await read({...request,cursor}),{...request,cursor});
  if(!isCurrent())throw Error('This download was cancelled because the account or request changed.');
  const text=result.records.map(record=>JSON.stringify({prepared_at:result.prepared_at,record})+'\n').join('');
  const bytes=encoder.encode(text).byteLength;
  if(bytes>1024*1024)throw Error('A data page is too large to prepare safely. Ask WeHouse for help in this request.');
  pieces.push(text);totalBytes+=bytes;count+=result.records.length;cursor=result.next_cursor;
  if(cursor===null||totalBytes>=4*1024*1024)break;
 }
 pieces.push(JSON.stringify({end_of_part:true,next_cursor:cursor,record_count:count})+'\n');
 return {text:pieces.join(''),nextCursor:cursor,count};
}

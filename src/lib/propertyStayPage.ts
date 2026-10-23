export type PropertyStayRow=Record<string,unknown>&{reservation_id:string;created_at:string|null;page_created_at:string};
export function propertyStayPage(value:unknown,size=50){
 if(!Number.isSafeInteger(size)||size<1||size>50||!Array.isArray(value)||value.length>size+1)throw Error('Reservation history could not be confirmed. Try again.');
 const ids=new Set<string>();
 for(const row of value){
  if(!row||typeof row.reservation_id!=='string'||!row.reservation_id.trim()||row.reservation_id.length>128||ids.has(row.reservation_id)||typeof row.page_created_at!=='string'||!Number.isFinite(Date.parse(row.page_created_at))||(row.created_at!==null&&(typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))))throw Error('Reservation history could not be confirmed. Try again.');
  ids.add(row.reservation_id);
 }
 const rows=value.slice(0,size) as PropertyStayRow[];const last=rows.at(-1);
 return{rows,hasMore:value.length>size,cursor:last?{createdAt:last.page_created_at,id:last.reservation_id}:null};
}
export function propertyStayTarget(value:unknown,id:string){
 if(!Array.isArray(value)||value.length>1)throw Error('Linked reservation could not be confirmed.');
 const rows=propertyStayPage(value,1).rows;
 if(rows[0]&&rows[0].reservation_id!==id)throw Error('Linked reservation did not match this request.');
 return rows[0]||null;
}

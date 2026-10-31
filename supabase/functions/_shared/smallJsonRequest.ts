export class JsonRequestError extends Error {
  constructor(message:string,readonly status:number){super(message);}
}
/** Enforce the real streamed byte count, even with no/incorrect Content-Length. */
export async function readSmallJsonRequest(request:Pick<Request,'headers'|'body'>,maximum=8192):Promise<Record<string,unknown>> {
  const declared=request.headers.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maximum))throw new JsonRequestError('Request is too large',413);
  if(!request.body)throw new JsonRequestError('A JSON request is required',400);
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maximum){await reader.cancel();throw new JsonRequestError('Request is too large',413);}chunks.push(value);
    }
  }finally{reader.releaseLock();}
  try{
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('object required');
    return value;
  }catch{throw new JsonRequestError('Enter valid request details',400);}
}

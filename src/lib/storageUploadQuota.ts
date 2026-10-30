type Fetcher=typeof fetch;
type Ticket={id:string};
/** Reserve independently of Storage's rollback permission probes. Never retry a media body here. */
export function createStorageUploadQuota(apiUrl:string,storageUrl:string,transport:Fetcher=globalThis.fetch.bind(globalThis)) {
  const apiOrigin=new URL(apiUrl).origin;
  const storageOrigins=new Set([apiOrigin,new URL(storageUrl).origin]);
  let active=0,generation=0;const waiting:Array<()=>void>=[];
  async function run<T>(task:()=>Promise<T>):Promise<T> {
    const identity=generation;
    if(active<2)active++;
    else {if(waiting.length>=16)throw new Error('Too many files are queued. Finish this upload batch before adding more.');await new Promise<void>(resolve=>waiting.push(resolve));}
    try{if(identity!==generation)throw new Error('Upload cancelled because the signed-in account changed.');return await task();}finally{const next=waiting.shift();if(next)next();else active--;}
  }
  async function rpc(name:string,args:unknown,headers:Headers) {
    const auth=headers.get('authorization'),key=headers.get('apikey');
    if(!auth||!key)throw new Error('Sign in before uploading.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await transport(`${apiOrigin}/rest/v1/rpc/${name}`,{method:'POST',headers:{authorization:auth,apikey:key,'content-type':'application/json'},body:JSON.stringify(args),signal:controller.signal});
      const value=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(value?.message||'Upload space could not be confirmed. Try again.');
      return value;
    } finally {clearTimeout(timer);}
  }
  async function reserve(bucket:string,path:string,headers:Headers):Promise<Ticket> {
    const value=await rpc('reserve_my_media_upload',{p_bucket:bucket,p_name:path},headers);
    if(typeof value?.id!=='string'||!value.id)throw new Error('Upload space could not be confirmed. Try again.');
    return {id:value.id};
  }
  async function complete(ticket:Ticket,headers:Headers) {
    // The asset can already be committed when this acknowledgement is lost.
    // Keep it intact; the durable ticket remains available for reconciliation.
    try{await rpc('complete_my_media_upload',{p_reservation_id:ticket.id},headers);}catch{/* no destructive rollback */}
  }
  const guardedFetch:Fetcher=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(storageOrigins.has(url.origin)&&method==='POST'&&/^\/storage\/v1\/object\/(copy|move)$/.test(url.pathname)) {
      const body=typeof init?.body==='string'?JSON.parse(init.body):input instanceof Request?await input.clone().json():null;
      if(typeof body?.bucketId!=='string'||typeof body?.destinationKey!=='string'||(body.destinationBucket!=null&&typeof body.destinationBucket!=='string'))throw new Error('The media destination could not be confirmed.');
      const headers=new Headers(input instanceof Request?input.headers:undefined);
      new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));
      return run(async()=>{
        const signal=init?.signal||(input instanceof Request?input.signal:null);
        if(signal?.aborted)throw new DOMException('Upload cancelled','AbortError');
        const ticket=await reserve(body.destinationBucket||body.bucketId,body.destinationKey,headers);
        const response=await transport(input,init);if(response.ok)await complete(ticket,headers);return response;});
    }
    const match=url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    const command=match?decodeURIComponent(match[1]):'';
    if(!storageOrigins.has(url.origin)||!['POST','PUT'].includes(method)||!match||['sign','list','info','authenticated','public','copy','move','upload'].includes(command))return transport(input,init);
    const headers=new Headers(input instanceof Request?input.headers:undefined);
    new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));
    return run(async()=>{
      const signal=init?.signal||(input instanceof Request?input.signal:null);
      if(signal?.aborted)throw new DOMException('Upload cancelled','AbortError');
      const ticket=await reserve(command,decodeURIComponent(match[2]),headers);
      const response=await transport(input,init);
      if(response.ok)await complete(ticket,headers);
      return response;
    });
  };
  return {fetch:guardedFetch,reserve,complete,run,reset:()=>{generation++;}};
}

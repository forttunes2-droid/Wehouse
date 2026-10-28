/** Callers supply a canonical public reference, never a credential/media URL. */
export async function sharePublicReference(url:string,title:string):Promise<'shared'|'copied'|'cancelled'> {
 const ref=new URL(url);
 const publicRoute=/^#place\/(?:listing\/[A-Za-z0-9_-]{1,160}|hotel\/[1-9]\d*)$/.test(ref.hash)||/^#worker_discovery\?(?:id|experienceId)=[a-f\d-]{36}$/i.test(ref.hash);
 if(ref.origin!=='https://wehouse.com.ng'||ref.pathname!=='/'||ref.search||ref.username||ref.password||!publicRoute)throw Error('This public link cannot be shared.');
 if(typeof navigator!=='undefined'&&typeof navigator.share==='function'){
  try{await navigator.share({title,text:`View ${title} on WeHouse`,url});return 'shared';}
  catch(error){if(error instanceof DOMException&&error.name==='AbortError')return 'cancelled';}
 }
 if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);return 'copied';}
 throw Error('Sharing is not available on this device.');
}

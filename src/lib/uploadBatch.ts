/** Prepare and upload two files at a time; await started work before reporting failure. */
export async function uploadInParallel<T,U>(files:readonly T[],task:(file:T)=>Promise<U>):Promise<U[]> {
  const results=Array<U>(files.length);let next=0,failed=false,failure:unknown;
  const worker=async()=>{
    while(!failed){const index=next++;if(index>=files.length)return;
      try{results[index]=await task(files[index]);}catch(error){if(!failed){failed=true;failure=error;}}
    }
  };
  await Promise.all(Array.from({length:Math.min(2,files.length)},worker));
  if(failed)throw failure;return results;
}

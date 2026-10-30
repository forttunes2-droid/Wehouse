/** Count a placement once after at least half its card is visible for one second. */
export function observeSponsoredVisibility(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  let inView=false, recorded=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
  const update=()=>{
    cancel();
    if(recorded||!inView||document.visibilityState!=='visible')return;
    timer=setTimeout(()=>{
      timer=undefined;
      if(recorded||!inView||document.visibilityState!=='visible')return;
      recorded=true;observer.disconnect();onVisible();
    },1000);
  };
  const observer=new IntersectionObserver(entries=>{
    const entry=entries.find(item=>item.target===element);
    if(!entry)return;
    inView=entry.isIntersecting&&entry.intersectionRatio>=0.5;update();
  },{threshold:[0,0.5]});
  observer.observe(element);
  document.addEventListener('visibilitychange',update);
  return()=>{recorded=true;cancel();observer.disconnect();document.removeEventListener('visibilitychange',update);};
}

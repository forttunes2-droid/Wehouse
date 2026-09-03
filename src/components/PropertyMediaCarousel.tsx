import { useRef, useState } from 'react';
import { ListingMediaImage } from './ListingCandidateMedia';

type Props = {
  images: string[];
  title: string;
  children?: React.ReactNode;
};

export default function PropertyMediaCarousel({ images, title, children }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const fullscreenRailRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  function moveTo(index: number) {
    const normalized = (index + images.length) % images.length;
    railRef.current?.scrollTo({
      left: normalized * (railRef.current.clientWidth || 1),
      behavior: 'smooth',
    });
    setActiveIndex(normalized);
  }

  function updateIndex() {
    const rail = railRef.current;
    if (!rail || !rail.clientWidth) return;
    setActiveIndex(Math.min(images.length - 1, Math.max(0, Math.round(rail.scrollLeft / rail.clientWidth))));
  }

  function openFullscreen() {
    setFullscreen(true);
    window.requestAnimationFrame(() => fullscreenRailRef.current?.scrollTo({ left: activeIndex * (fullscreenRailRef.current.clientWidth || 1) }));
  }

  function moveFullscreenTo(index: number) {
    fullscreenRailRef.current?.scrollTo({ left: index * (fullscreenRailRef.current.clientWidth || 1), behavior: 'smooth' });
    setActiveIndex(index);
  }

  return <>
    <section className="relative overflow-hidden bg-[#11141C] sm:m-4 sm:rounded-3xl">
      <div
        ref={railRef}
        onScroll={updateIndex}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth scrollbar-hide"
        aria-label={`${title} photos`}
      >
        {images.map((image, index) => <button
          key={`${image}-${index}`}
          type="button"
          onClick={openFullscreen}
          className="min-w-full snap-center"
          aria-label={`View photo ${index + 1} of ${images.length} full screen`}
        >
          <ListingMediaImage reference={image} alt={`${title} · photo ${index + 1}`} draggable={false} className="aspect-[4/3] w-full select-none object-cover sm:aspect-[16/9]" />
        </button>)}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/20" />
      {children}
      {images.length > 1 && <>
        <button type="button" aria-label="Previous photo" onClick={() => moveTo(activeIndex - 1)} className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl backdrop-blur sm:grid">‹</button>
        <button type="button" aria-label="Next photo" onClick={() => moveTo(activeIndex + 1)} className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl backdrop-blur sm:grid">›</button>
        <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[9px] backdrop-blur">{activeIndex + 1} / {images.length}</span>
        <div className="absolute bottom-4 right-4 flex gap-1.5">{images.map((_, index) => <button key={index} type="button" onClick={() => moveTo(index)} aria-label={`Go to photo ${index + 1}`} className={`h-2 rounded-full transition-all ${index === activeIndex ? 'w-5 bg-white' : 'w-2 bg-white/45'}`} />)}</div>
      </>}
    </section>
    {fullscreen && <div className="fixed inset-0 z-[100200] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Property photo viewer">
      <header className="flex h-14 shrink-0 items-center justify-between px-4"><span className="text-xs text-white/70">{activeIndex + 1} of {images.length}</span><button type="button" onClick={() => setFullscreen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl" aria-label="Close photo viewer">×</button></header>
      <div ref={fullscreenRailRef} onScroll={(event) => { const rail=event.currentTarget; if(rail.clientWidth)setActiveIndex(Math.min(images.length-1,Math.max(0,Math.round(rail.scrollLeft/rail.clientWidth)))) }} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-hide">{images.map((image,index)=><div key={`${image}-full-${index}`} className="flex min-w-full snap-center items-center justify-center"><ListingMediaImage reference={image} alt={`${title} · photo ${index + 1}`} className="max-h-full max-w-full object-contain" /></div>)}</div>
      {images.length > 1 && <div className="flex shrink-0 gap-2 overflow-x-auto p-4 scrollbar-hide">{images.map((image, index) => <button key={`${image}-thumb-${index}`} type="button" onClick={() => moveFullscreenTo(index)} className={`h-16 w-20 shrink-0 overflow-hidden rounded-xl border-2 ${index === activeIndex ? 'border-violet-400' : 'border-transparent opacity-60'}`}><ListingMediaImage reference={image} alt="" className="h-full w-full object-cover" /></button>)}</div>}
    </div>}
  </>;
}

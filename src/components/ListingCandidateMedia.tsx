import { useEffect, useState } from 'react';
import { getListingMediaUrl } from '@/lib/supabase/listings';

const urlCache = new Map<string, string>();

export function useListingMediaUrl(reference: string | null | undefined) {
  const [url, setUrl] = useState(() => reference ? (urlCache.get(reference) || (/^https?:\/\//i.test(reference) ? reference : '')) : '');

  useEffect(() => {
    let active = true;
    if (!reference) { setUrl(''); return () => { active = false; }; }
    const cached = urlCache.get(reference);
    if (cached) { setUrl(cached); return () => { active = false; }; }
    if (/^https?:\/\//i.test(reference)) { urlCache.set(reference, reference); setUrl(reference); return () => { active = false; }; }
    setUrl('');
    void getListingMediaUrl(reference).then(({ url: signedUrl }) => {
      if (!active || !signedUrl) return;
      urlCache.set(reference, signedUrl);
      setUrl(signedUrl);
    });
    return () => { active = false; };
  }, [reference]);

  return url;
}

export function ListingMediaImage({ reference, alt, className, ...props }: { reference: string; alt: string; className?: string } & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const url = useListingMediaUrl(reference);
  return url
    ? <img src={url} alt={alt} className={className} {...props}/>
    : <div className={`${className || ''} animate-pulse bg-white/[.04]`} aria-label="Loading secure image"/>;
}

export function ListingMediaVideo({ reference, className, ...props }: { reference: string; className?: string } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const url = useListingMediaUrl(reference);
  return url
    ? <video src={url} className={className} {...props}/>
    : <div className={`${className || ''} animate-pulse bg-white/[.04]`} aria-label="Loading secure video"/>;
}

import { useEffect, useState } from 'react';
import { getListingMediaUrls } from '@/lib/supabase/listings';

type CacheEntry = { url: string; expiresAt: number };
type PendingResolver = (url: string) => void;

const PUBLIC_URL_EXPIRY = Number.POSITIVE_INFINITY;
const SIGNED_URL_CACHE_MS = 55 * 60 * 1000;
const urlCache = new Map<string, CacheEntry>();
const pending = new Map<string, PendingResolver[]>();
let flushScheduled = false;

function cachedUrl(reference: string) {
  const cached = urlCache.get(reference);
  if (!cached) return '';
  if (cached.expiresAt <= Date.now()) {
    urlCache.delete(reference);
    return '';
  }
  return cached.url;
}

function queueMediaUrl(reference: string) {
  if (/^https?:\/\//i.test(reference)) {
    urlCache.set(reference, { url: reference, expiresAt: PUBLIC_URL_EXPIRY });
    return Promise.resolve(reference);
  }

  const cached = cachedUrl(reference);
  if (cached) return Promise.resolve(cached);

  return new Promise<string>(resolve => {
    pending.set(reference, [...(pending.get(reference) || []), resolve]);
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const batch = Array.from(pending.entries());
      pending.clear();
      const references = batch.map(([item]) => item);
      void getListingMediaUrls(references).then(({ urls }) => {
        batch.forEach(([item, resolvers]) => {
          const url = urls.get(item) || '';
          if (url) urlCache.set(item, { url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
          resolvers.forEach(done => done(url));
        });
      });
    });
  });
}

export function useListingMediaUrl(reference: string | null | undefined) {
  const [url, setUrl] = useState(() => reference ? cachedUrl(reference) || (/^https?:\/\//i.test(reference) ? reference : '') : '');

  useEffect(() => {
    let active = true;
    if (!reference) {
      setUrl('');
      return () => { active = false; };
    }
    const cached = cachedUrl(reference);
    if (cached) {
      setUrl(cached);
      return () => { active = false; };
    }
    setUrl('');
    void queueMediaUrl(reference).then(nextUrl => {
      if (active) setUrl(nextUrl);
    });
    return () => { active = false; };
  }, [reference]);

  return url;
}

export function ListingMediaImage({ reference, alt, className, loading = 'lazy', decoding = 'async', ...props }: { reference: string; alt: string; className?: string } & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const url = useListingMediaUrl(reference);
  return url
    ? <img src={url} alt={alt} className={className} loading={loading} decoding={decoding} {...props}/>
    : <div className={`${className || ''} animate-pulse bg-white/[.04]`} role="status" aria-label="Loading image"/>;
}

export function ListingMediaVideo({ reference, className, preload = 'metadata', playsInline = true, ...props }: { reference: string; className?: string } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const url = useListingMediaUrl(reference);
  return url
    ? <video src={url} className={className} preload={preload} playsInline={playsInline} {...props}/>
    : <div className={`${className || ''} animate-pulse bg-white/[.04]`} role="status" aria-label="Loading video"/>;
}

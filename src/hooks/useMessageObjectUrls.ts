import { useCallback, useEffect, useRef } from 'react';
export function useMessageObjectUrls(messages: Array<{ attachments?: string[] }>) {
  const owned = useRef(new Set<string>()), displayed = useRef(new Set<string>());
  const own = useCallback((urls: string[]) => { for (const url of urls) if (url.startsWith('blob:')) owned.current.add(url); }, []);
  useEffect(() => {
    const next = new Set(messages.flatMap(row => row.attachments || []).filter(url => url.startsWith('blob:')));
    for (const url of displayed.current) if (!next.has(url)) { URL.revokeObjectURL(url); owned.current.delete(url); }
    for (const url of next) owned.current.add(url);
    displayed.current = next;
  }, [messages]);
  useEffect(() => () => { for (const url of owned.current) URL.revokeObjectURL(url); owned.current.clear(); displayed.current.clear(); }, []);
  return own;
}

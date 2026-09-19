import { useEffect, useRef } from 'react';

// Render text, never HTML supplied through the legal-document editor.
export default function LegalDocumentBody({ body, onReachedEnd }: { body: string; onReachedEnd?: () => void }) {
  const end = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!onReachedEnd || !end.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { onReachedEnd(); observer.disconnect(); }
    }, { threshold: 1 });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [body, onReachedEnd]);

  return <article className="min-w-0 space-y-3 break-words text-base leading-7 text-[#C5BFCE] [overflow-wrap:anywhere]">
    {body.split('\n').map((line, index) => {
      const text = line.trim();
      if (!text) return null;
      if (/^#{1,6}\s/.test(text) || /^\*\*.+\*\*$/.test(text)) {
        return <h2 key={index} className="pt-5 text-lg font-semibold text-[#F6F2FC] first:pt-0">{text.replace(/^#{1,6}\s+/, '').replace(/^\*\*|\*\*$/g, '')}</h2>;
      }
      return <p key={index} className="whitespace-pre-wrap">{line}</p>;
    })}
    {onReachedEnd && <p ref={end} tabIndex={0} className="pt-4 text-sm text-[#AAA3B3]">End of document</p>}
  </article>;
}

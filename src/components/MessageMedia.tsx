import { useEffect, useState } from 'react';
import {  ImageOff, Images, Mic, Play, Video, X } from 'lucide-react';
import MediaViewer from '@/components/MediaViewer';
import VoiceNotePlayer from '@/components/VoiceNotePlayer';
import { attachmentSize, messageAttachmentKind, usableAttachmentUrl, type MessageAttachment } from '@/lib/messageAttachment';
import './message-attachments.css';

export function AttachmentState({ error = false, onRetry }: { error?: boolean; onRetry?: () => void }) {
  return <div className="wh-attachment-surface wh-attachment-state" role={error ? 'alert' : 'status'}>
    {error ? <ImageOff size={20} aria-hidden="true" /> : <Images size={20} aria-hidden="true" />}
    <div><p>{error ? 'An attachment could not be loaded.' : 'Loading attachment…'}</p>{error && onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>
  </div>;
}

function Photo({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="wh-media-failed"><ImageOff size={24} className="mx-auto mb-1" aria-hidden="true" />Photo unavailable</span>
    : <img src={url} alt="Shared photo" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/** One presentation for already-authorised URLs. Does not fetch, decrypt or grant access. */
export default function MessageMedia({ items }: { items: MessageAttachment[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  const safe = items.filter(item => usableAttachmentUrl(item.url));
  const visual = safe.flatMap(item => {
    const kind = messageAttachmentKind(item.type, item.url);
    return kind === 'image' || kind === 'video' ? [{ url: item.url, kind }] : [];
  });
  const openedIndex = visual.findIndex(item => item.url === opened);
  if (!items.length) return null;
  return <div className="wh-attachment-surface wh-message-media">
    {visual.length > 0 && <div className="wh-media-grid" data-count={Math.min(visual.length, 4)}>{visual.slice(0, 4).map((item, index) => <button
      key={`${item.url}-${index}`} type="button" className="wh-media-tile" aria-label={`Open ${item.kind === 'image' ? 'photo' : 'video'} ${index + 1} of ${visual.length}`}
      onClick={event => { event.stopPropagation(); setOpened(item.url); }}>
      {item.kind === 'image' ? <Photo key={item.url} url={item.url} /> : <span className="wh-media-play"><Play size={22} aria-hidden="true" /></span>}
      {index === 3 && visual.length > 4 && <span className="wh-media-count">+{visual.length - 4}</span>}
    </button>)}</div>}
    {safe.map((item, index) => {
      const kind = messageAttachmentKind(item.type, item.url);
      if (kind === 'audio') return <div key={`${item.url}-${index}`} className="wh-media-audio"><VoiceNotePlayer url={item.url} /></div>;
      if (kind !== 'file') return null;
      return <p key={`${item.url}-${index}`} className="wh-attachment-state text-sm" role="note">Documents are not supported in chat.</p>;
    })}
    {safe.length !== items.length && <AttachmentState error />}
    {openedIndex >= 0 && <MediaViewer items={visual} initialIndex={openedIndex} title="Shared media" onClose={() => setOpened(null)} />}
  </div>;
}

function PendingItem({ file, onRemove, disabled = false }: { file: File; onRemove: () => void; disabled?: boolean }) {
  const [url, setUrl] = useState('');
  const kind = messageAttachmentKind(file.type, file.name);
  useEffect(() => {
    if (kind !== 'image') return;
    const next = URL.createObjectURL(file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, kind]);
  const label = kind === 'audio' ? 'Voice note' : file.name;
  return <div className="wh-pending-item">
    <span className="wh-pending-thumb">{kind === 'image' && url ? <Photo key={url} url={url} /> : kind === 'audio' ? <Mic size={22} aria-hidden="true" /> : kind === 'video' ? <Video size={22} aria-hidden="true" /> : <ImageOff size={22} aria-hidden="true" />}</span>
    <span className="wh-pending-name"><span>{label}</span><small>{attachmentSize(file.size)}</small></span>
    <button type="button" className="wh-attachment-remove" disabled={disabled} aria-label={`Remove ${label}`} onClick={onRemove}><X size={18} aria-hidden="true" /></button>
  </div>;
}
export function PendingMessageMedia({ files, onRemove, disabled = false }: { files: File[]; onRemove: (index: number) => void; disabled?: boolean }) {
  if (!files.length) return null;
  return <div className="wh-attachment-surface wh-pending-media" aria-label="Attachments ready to send">{files.map((file, index) => <PendingItem key={`${file.name}-${file.lastModified}-${index}`} file={file} disabled={disabled} onRemove={() => onRemove(index)} />)}</div>;
}

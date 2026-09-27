import { messageAttachmentKind } from "@/lib/messageAttachment";
import { useEffect, useState } from 'react';
import { getSupportAttachmentUrl } from '@/lib/supabase/support';
import { withTimeout } from '@/lib/withTimeout';
import MessageMedia, { AttachmentState } from '@/components/MessageMedia';

type Props = { path: string; type?: string; className?: string };

/** Keep support signing/permissions separate; share only the presentation. */
export default function SecureSupportAttachment({ path, type = '', className = '' }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const kind = messageAttachmentKind(type, path);
  const supported = kind === 'image' || kind === 'video';
  useEffect(() => {
    let active = true; setFailed(false); setUrl(null);
    if (!supported) return;
    void (async () => {
      try {
        const result = await withTimeout(getSupportAttachmentUrl(path), 12000, 'Attachment took too long to load.');
        if (!active) return;
        if (result.error || !result.url) setFailed(true);
        else setUrl(result.url);
      } catch { if (active) setFailed(true); }
    })();
    return () => { active = false; };
  }, [path, attempt, supported]);
  if (!supported) return <p className="wh-attachment-state text-sm" role="note">Documents are not supported in chat.</p>;
  return <div className={className}>{failed ? <AttachmentState error onRetry={() => setAttempt(value => value + 1)} /> : !url ? <AttachmentState /> : <MessageMedia items={[{ url, type }]} />}</div>;
}

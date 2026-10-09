import { Camera, FileText, Image as ImageIcon, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { CHAT_MEDIA_ACCEPT } from "@/lib/chatMediaPolicy";

export type ChatAttachmentSource = "media" | "document" | "camera";
type Props = { onFiles: (files: FileList | null, source: ChatAttachmentSource) => void; disabled?: boolean };

export default function ChatAttachmentPicker({ onFiles, disabled = false }: Props) {
  const mediaRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(ref: RefObject<HTMLInputElement | null>) {
    setOpen(false);
    window.setTimeout(() => ref.current?.click(), 0);
  }

  return (
    <>
      <div className="relative shrink-0">
        <input ref={mediaRef} type="file" multiple accept={CHAT_MEDIA_ACCEPT} className="hidden"
          onChange={event => { onFiles(event.target.files, "media"); event.target.value = ""; }} />
        <input ref={documentRef} type="file" multiple accept="*/*" className="hidden"
          onChange={event => { onFiles(event.target.files, "document"); event.target.value = ""; }} />
        <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" className="hidden"
          onChange={event => { onFiles(event.target.files, "camera"); event.target.value = ""; }} />
        <button type="button" disabled={disabled} onClick={() => setOpen(true)}
          aria-label="Attach to message"
          className="grid h-11 w-11 place-items-center rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)] transition hover:border-violet-400/30 hover:text-violet-200 disabled:opacity-40">
          <Plus size={21} aria-hidden="true" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[100040] flex items-end bg-black/65 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
          role="dialog" aria-modal="true" aria-label="Attach to message" onClick={() => setOpen(false)}>
          <section className="w-full rounded-t-[28px] border border-[var(--wh-border-subtle)] bg-[var(--wh-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-[28px]"
            onClick={event => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--wh-border-subtle)] sm:hidden" />
            <header className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-500/10 text-violet-200"><Plus size={19} aria-hidden="true" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">Add to message</h2>
                <p className="mt-0.5 text-xs text-[var(--wh-text-muted)]">Choose what you want to share.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close attachment menu"
                className="grid h-10 w-10 place-items-center rounded-full bg-[var(--wh-interactive)] text-[var(--wh-text-secondary)]"><X size={18} /></button>
            </header>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <button type="button" onClick={() => pick(mediaRef)}
                className="group rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-400/30">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-200"><ImageIcon size={23} /></span>
                <span className="mt-3 block text-sm font-semibold">Photos & videos</span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--wh-text-muted)]">Gallery media</span>
              </button>
              <button type="button" onClick={() => pick(documentRef)}
                className="group rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-400/30">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-200"><FileText size={23} /></span>
                <span className="mt-3 block text-sm font-semibold">Document</span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--wh-text-muted)]">PDF, Word, Excel & more</span>
              </button>
              <button type="button" onClick={() => pick(cameraRef)}
                className="group rounded-2xl border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-400/30">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/12 text-violet-200"><Camera size={23} /></span>
                <span className="mt-3 block text-sm font-semibold">Camera</span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--wh-text-muted)]">Take a new photo/video</span>
              </button>
            </div>
            <p className="mt-4 text-center text-[10px] leading-4 text-[var(--wh-text-muted)]">Attachments are private to this conversation. WeHouse checks file type and size before upload.</p>
          </section>
        </div>
      ) : null}
    </>
  );
}

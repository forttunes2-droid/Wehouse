import { Plus } from "lucide-react";
import { useRef } from "react";
import { CHAT_MEDIA_ACCEPT } from "@/lib/chatMediaPolicy";

type Props = { onFiles: (files: FileList | null) => void; disabled?: boolean };
export default function ChatAttachmentPicker({ onFiles, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className="relative shrink-0">
    <input ref={inputRef} type="file" multiple accept={CHAT_MEDIA_ACCEPT} className="hidden"
      onChange={event => { onFiles(event.target.files); event.target.value = ""; }} />
    <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
      aria-label="Add photo or video"
      className="grid h-11 w-11 place-items-center rounded-full border border-[var(--wh-border-subtle)] bg-[var(--wh-interactive)] text-xl text-[var(--wh-text-secondary)] disabled:opacity-40">
      <Plus size={21} aria-hidden="true" />
    </button>
  </div>;
}

import { Plus } from "lucide-react";
import { useRef } from "react";

type Props = {
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  allowVideo?: boolean;
  allowDocuments?: boolean;
  allowAudio?: boolean;
};

export default function ChatAttachmentPicker({
  onFiles,
  disabled = false,
  allowVideo = false,
  allowDocuments = false,
  allowAudio = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    allowVideo ? "video/mp4" : "",
    allowAudio ? "audio/*" : "",
    allowDocuments ? "application/pdf,.doc,.docx,text/plain" : "",
  ].filter(Boolean).join(",");

  return (
    <div className="relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Add media or file"
        className="grid h-11 w-11 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-xl text-[#A2A7B6] disabled:opacity-40"
      >
        <Plus size={21} aria-hidden="true" />
      </button>
    </div>
  );
}

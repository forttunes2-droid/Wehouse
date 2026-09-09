import { useEffect, useRef, useState } from "react";

type Props = {
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  allowVideo?: boolean;
  allowDocuments?: boolean;
  allowAudio?: boolean;
};

type Choice = { label: string; detail: string; accept: string };

export default function ChatAttachmentPicker({
  onFiles,
  disabled = false,
  allowVideo = false,
  allowDocuments = false,
  allowAudio = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [accept, setAccept] = useState("image/jpeg,image/png,image/webp");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const choices: Choice[] = [
    {
      label: allowVideo ? "Photo or video" : "Photo",
      detail: allowVideo ? "Camera or gallery" : "Camera or gallery",
      accept: allowVideo
        ? "image/jpeg,image/png,image/webp,video/mp4"
        : "image/jpeg,image/png,image/webp",
    },
    { label: "GIF", detail: "Animated image", accept: "image/gif" },
    {
      label: "Sticker",
      detail: "PNG or WebP",
      accept: "image/png,image/webp",
    },
    ...(allowAudio
      ? [{ label: "Audio", detail: "Audio file", accept: "audio/*" }]
      : []),
    ...(allowDocuments
      ? [
          {
            label: "Document",
            detail: "PDF or document",
            accept: "application/pdf,.doc,.docx,text/plain",
          },
        ]
      : []),
  ];

  function choose(choice: Choice) {
    setAccept(choice.accept);
    setOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.click());
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
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
        onClick={() => setOpen((current) => !current)}
        aria-label="Add attachment, GIF or sticker"
        aria-expanded={open}
        className="grid h-11 w-11 place-items-center rounded-full border border-white/[.07] bg-white/[.035] text-xl text-[#A2A7B6] disabled:opacity-40"
      >
        ＋
      </button>
      {open && (
        <div className="absolute bottom-14 left-0 z-30 w-52 overflow-hidden rounded-2xl border border-white/[.1] bg-[#171A22] p-1.5 shadow-2xl">
          {choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              onClick={() => choose(choice)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left active:bg-white/[.06]"
            >
              <span className="text-[11px] font-semibold text-white">
                {choice.label}
              </span>
              <span className="text-[8px] text-[#747B8B]">
                {choice.detail}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

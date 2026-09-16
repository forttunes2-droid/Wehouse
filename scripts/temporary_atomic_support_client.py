from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path): return (ROOT / path).read_text()
def write(path, text): (ROOT / path).write_text(text)
def one(text, old, new, label):
    count=text.count(old)
    if count != 1: raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old,new,1)

support_path='src/lib/supabase/support.ts'
support=read(support_path)
marker='export const ensureSupportConversation = createSupportConversation;\n\n'
addition=r'''export type SupportMessageDraftStatus = {
  draft_id: string;
  state: "draft" | "sent" | "expired";
  conversation_id: string | null;
  message_id: string | null;
  expires_at: string;
  consumed_at: string | null;
};

export const SUPPORT_EVIDENCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isSupportedSupportEvidence(file: File) {
  return SUPPORT_EVIDENCE_MIME_TYPES.has(file.type || "");
}

export async function createSupportMessageDraft() {
  const { data, error } = await supabase.rpc("create_my_support_message_draft");
  return { draftId: data as string | null, error };
}

export async function getSupportMessageDraftStatus(draftId: string) {
  const { data, error } = await supabase.rpc("get_my_support_message_draft_status", {
    p_draft_id: draftId,
  });
  return { status: (data || null) as SupportMessageDraftStatus | null, error };
}

export async function discardSupportMessageDraft(draftId: string) {
  const { data, error } = await supabase.rpc("discard_my_support_message_draft", {
    p_draft_id: draftId,
  });
  return { discarded: data === true, error };
}

export async function sendFirstWeHouseMessage(
  draftId: string,
  context: SupportOpenContext,
  content: string,
  attachments: string[] = [],
  attachmentTypes: string[] = [],
) {
  const snapshot = sanitizeSupportSnapshot(context.contextSnapshot);
  const { data, error } = await supabase.rpc("send_my_first_wehouse_message", {
    p_draft_id: draftId,
    p_subject: context.subject || "WeHouse",
    p_category: context.category || "general",
    p_context_type: context.contextType || "general",
    p_context_id: context.contextId || null,
    p_context_snapshot: snapshot,
    p_priority: context.priority || "normal",
    p_content: content,
    p_attachments: attachments,
    p_attachment_types: attachmentTypes,
  });
  const result = (data || {}) as {
    conversation_id?: string | null;
    message_id?: string | null;
    replayed?: boolean;
  };
  return {
    conversationId: result.conversation_id || null,
    messageId: result.message_id || null,
    replayed: result.replayed === true,
    error,
  };
}

export async function uploadSupportDraftAttachment(
  draftId: string,
  requesterId: string,
  file: File,
) {
  const safeName =
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "attachment";
  const path = `drafts/${requesterId}/${draftId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
  const { error } = await supabase.storage
    .from("support-files")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
  return { path: error ? null : path, error };
}

'''
support=one(support,marker,marker+addition,'support draft helpers')
write(support_path,support)

chat_path='src/components/SupportChat.tsx'
chat=read(chat_path)
old_import='''  completeSupportCase,\n  conversationPresentation,\n  deleteSupportAttachment,\n  ensureSupportConversation,\n  getMySupportConversations,\n  getSupportCaseEvents,\n  getSupportMessages,\n  markSupportMessagesRead,\n  reopenSupportCase,\n  sendSupportMessage,\n  supportNextStep,\n  supportStatusLabel,\n  uploadSupportAttachment,\n  supportContextType,\n'''
new_import='''  completeSupportCase,\n  conversationPresentation,\n  createSupportMessageDraft,\n  deleteSupportAttachment,\n  discardSupportMessageDraft,\n  getMySupportConversations,\n  getSupportCaseEvents,\n  getSupportMessageDraftStatus,\n  getSupportMessages,\n  isSupportedSupportEvidence,\n  markSupportMessagesRead,\n  reopenSupportCase,\n  sendFirstWeHouseMessage,\n  sendSupportMessage,\n  supportNextStep,\n  supportStatusLabel,\n  uploadSupportAttachment,\n  uploadSupportDraftAttachment,\n  supportContextType,\n'''
chat=one(chat,old_import,new_import,'SupportChat imports')

old_refs='''  const bottomRef = useRef<HTMLDivElement>(null);\n  const inputRef = useRef<HTMLTextAreaElement>(null);\n  const fileRef = useRef<HTMLInputElement>(null);\n'''
new_refs='''  const bottomRef = useRef<HTMLDivElement>(null);\n  const inputRef = useRef<HTMLTextAreaElement>(null);\n  const fileRef = useRef<HTMLInputElement>(null);\n  const firstSendAttemptRef = useRef<{\n    draftId: string;\n    content: string;\n    context: SupportOpenContext;\n    paths: string[];\n    types: string[];\n  } | null>(null);\n'''
chat=one(chat,old_refs,new_refs,'first send ref')

old_filter='''      if (\n        !file.type.startsWith("image/") &&\n        !file.type.startsWith("video/") &&\n        file.type !== "application/pdf"\n      ) {\n        toast.error(`${file.name} is not a supported evidence file`);\n        return false;\n      }\n'''
new_filter='''      if (!isSupportedSupportEvidence(file)) {\n        toast.error(`${file.name} is not a supported evidence file`);\n        return false;\n      }\n'''
chat=one(chat,old_filter,new_filter,'evidence mime filter')

start=chat.index('  async function send() {')
end=chat.index('  async function respondToResolution',start)
new_send=r'''  async function send() {
    if (sending || (!input.trim() && !files.length && !firstSendAttemptRef.current)) return;
    if (!profile) return;
    setSending(true);

    const existingConversationId = thread?.conversation_id || null;
    if (existingConversationId) {
      const paths: string[] = [];
      const types: string[] = [];
      for (const file of files) {
        const uploaded = await uploadSupportAttachment(existingConversationId, file);
        if (uploaded.error || !uploaded.path) {
          for (const path of paths) await deleteSupportAttachment(path);
          setSending(false);
          toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
          return;
        }
        paths.push(uploaded.path);
        types.push(file.type || "application/octet-stream");
      }
      const { error } = await sendSupportMessage(
        existingConversationId,
        input.trim(),
        paths,
        types,
        null,
      );
      if (error) {
        for (const path of paths) await deleteSupportAttachment(path);
        setSending(false);
        toast.error(error.message || "Message failed");
        return;
      }
      setInput("");
      setFiles([]);
      setSending(false);
      await loadMessages(existingConversationId, true);
      void refreshThread(null, existingConversationId);
      return;
    }

    let attempt = firstSendAttemptRef.current;
    if (!attempt) {
      const context = pendingContext || {};
      const draft = await createSupportMessageDraft();
      if (draft.error || !draft.draftId) {
        setSending(false);
        toast.error(draft.error?.message || "Unable to prepare this WeHouse message");
        return;
      }
      const paths: string[] = [];
      const types: string[] = [];
      for (const file of files) {
        const uploaded = await uploadSupportDraftAttachment(
          draft.draftId,
          profile.user_id,
          file,
        );
        if (uploaded.error || !uploaded.path) {
          for (const path of paths) await deleteSupportAttachment(path);
          await discardSupportMessageDraft(draft.draftId);
          setSending(false);
          toast.error(uploaded.error?.message || `Could not upload ${file.name}`);
          return;
        }
        paths.push(uploaded.path);
        types.push(file.type || "application/octet-stream");
      }
      attempt = {
        draftId: draft.draftId,
        content: input.trim(),
        context,
        paths,
        types,
      };
      firstSendAttemptRef.current = attempt;
    }

    const sent = await sendFirstWeHouseMessage(
      attempt.draftId,
      attempt.context,
      attempt.content,
      attempt.paths,
      attempt.types,
    );
    let conversationId = sent.conversationId;
    if (sent.error || !conversationId) {
      const checked = await getSupportMessageDraftStatus(attempt.draftId);
      if (checked.status?.state === "sent" && checked.status.conversation_id) {
        conversationId = checked.status.conversation_id;
      } else if (checked.error) {
        setSending(false);
        toast.error(
          "We could not confirm whether that message was sent. Tap Send again to reconcile the same request before creating another one.",
        );
        return;
      } else {
        for (const path of attempt.paths) await deleteSupportAttachment(path);
        if (checked.status?.state !== "expired")
          await discardSupportMessageDraft(attempt.draftId);
        firstSendAttemptRef.current = null;
        setSending(false);
        toast.error(sent.error?.message || "Message failed");
        return;
      }
    }

    firstSendAttemptRef.current = null;
    setInput("");
    setFiles([]);
    setPendingContext(null);
    setSending(false);
    await loadMessages(conversationId, true);
    await refreshThread(attempt.context, conversationId);
  }

'''
chat=chat[:start]+new_send+chat[end:]

old_close='''              setOpen(false);\n              setFiles([]);\n              setEvents([]);\n              setPendingContext(null);\n'''
new_close='''              setOpen(false);\n              setFiles([]);\n              setEvents([]);\n              setPendingContext(null);\n              if (!firstSendAttemptRef.current) setInput("");\n'''
chat=one(chat,old_close,new_close,'close state')

old_footer='''        <div className="mx-auto max-w-4xl">\n          {pendingContext && hasContext(pendingContext) && (\n'''
new_footer='''        <div className="mx-auto max-w-4xl">\n          {!thread ? (\n            <FirstSendDisclosure\n              context={pendingContext}\n              presentation={presentation}\n            />\n          ) : null}\n          {pendingContext && hasContext(pendingContext) && (\n'''
chat=one(chat,old_footer,new_footer,'first send disclosure render')

old_accept='''              accept="image/*,video/*,application/pdf"\n'''
new_accept='''              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,.doc,.docx"\n'''
chat=one(chat,old_accept,new_accept,'evidence accept list')

insert_before='''function PendingContext({\n'''
disclosure=r'''function FirstSendDisclosure({
  context,
  presentation,
}: {
  context: SupportOpenContext | null;
  presentation: ReturnType<typeof conversationPresentation>;
}) {
  const type = supportContextType(context || {});
  const isReservation = [
    "apartment_reservation",
    "apartment_payment",
    "reservation",
    "hotel_booking",
  ].includes(type);
  const thisIs = presentation.operational
    ? isReservation
      ? "Reservation Operations conversation"
      : "Property Operations conversation"
    : "WeHouse conversation";
  const handledBy = presentation.operational
    ? isReservation
      ? "Reservation Operations"
      : "Property Operations"
    : "WeHouse Support";
  const linkedTo =
    context?.subject ||
    (context?.contextId
      ? String(type || "WeHouse record").replace(/_/g, " ")
      : "Your WeHouse account");
  const sendingEffect = presentation.operational
    ? "Creates or opens one conversation linked to this record and sends this message. It does not change payment or booking state by itself."
    : "Creates one WeHouse help request and sends this message. It does not freeze, release, refund or transfer money by itself.";
  const facts = [
    ["This is", thisIs],
    ["Handled by", handledBy],
    ["Linked to", linkedTo],
    ["What sending does", sendingEffect],
  ];
  return (
    <section className="mb-2 rounded-2xl border border-white/[.065] bg-white/[.025] p-3">
      <p className="mb-2 text-[9px] font-semibold uppercase tracking-[.14em] text-violet-300">
        Before you send
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <p className="text-[8px] font-semibold uppercase tracking-wide text-[#626A7B]">
              {label}
            </p>
            <p className="mt-0.5 text-[9px] leading-4 text-[#C7CBD5]">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

'''
chat=one(chat,insert_before,disclosure+insert_before,'FirstSendDisclosure component')
write(chat_path,chat)

# Source-level guard: first Send must use the atomic command rather than the old
# create-then-send sequence, and the four disclosure facts stay visible.
test_path='tests/support-first-send-contract.test.mjs'
(ROOT/test_path).write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("first Message WeHouse send uses the idempotent draft boundary", async () => {
  const [chat, api, migration] = await Promise.all([
    read("src/components/SupportChat.tsx"),
    read("src/lib/supabase/support.ts"),
    read("supabase/migrations/20260916123000_atomic_wehouse_first_send_and_support_storage.sql"),
  ]);
  assert.match(chat, /createSupportMessageDraft/);
  assert.match(chat, /uploadSupportDraftAttachment/);
  assert.match(chat, /sendFirstWeHouseMessage/);
  assert.match(chat, /getSupportMessageDraftStatus/);
  assert.doesNotMatch(chat, /ensureSupportConversation/);
  assert.match(api, /send_my_first_wehouse_message/);
  assert.match(migration, /support_message_drafts/);
  assert.match(migration, /support-files/);
  assert.match(migration, /for update/);
  assert.match(migration, /consumed_at=now\(\)/);
});

test("unsent Message WeHouse composer discloses its purpose before persistence", async () => {
  const chat = await read("src/components/SupportChat.tsx");
  for (const label of ["This is", "Handled by", "Linked to", "What sending does"])
    assert.match(chat, new RegExp(label));
  assert.match(chat, /Opening this screen alone does not create a conversation/);
  assert.match(chat, /Attach evidence/);
});
''')

for transient in [
    ROOT/'scripts/temporary_atomic_support_client.py',
    ROOT/'.github/workflows/temporary-atomic-support-client.yml',
]:
    if transient.exists(): transient.unlink()
print('Atomic Support client applied')

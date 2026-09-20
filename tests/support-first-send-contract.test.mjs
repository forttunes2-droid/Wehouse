import assert from "node:assert/strict";
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

test("unsent Message WeHouse shows one named topic without internal workflow instructions", async () => {
  const chat = await read("src/components/SupportChat.tsx");
  assert.match(chat, /aria-label="Conversation topic"/);
  assert.match(chat, /Hotel enquiry/);
  assert.match(chat, /Remove linked topic/);
  assert.doesNotMatch(chat, /Before you send|What sending does|FirstSendDisclosure/);
  assert.match(chat, /Attach evidence/);
});

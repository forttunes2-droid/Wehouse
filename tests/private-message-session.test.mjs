import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("one identity unlock is shared across Inbox and private conversation entry points", async () => {
  const [e2ee, hook, auth] = await Promise.all([
    read("src/lib/e2ee.ts"),
    read("src/hooks/useSecureInboxAccess.ts"),
    read("src/hooks/useAuth.ts"),
  ]);

  // The unlock belongs to the Personal identity and browser/app session, not to
  // a route, workspace, conversation, roommate, or Service Provider thread.
  assert.match(e2ee, /const SESSION_KEY_PREFIX = "wehouse:e2ee:private-key:"/);
  assert.match(e2ee, /function sessionKey\(profileId:string\)/);
  assert.match(e2ee, /readPrivateDeviceJwk/);
  assert.doesNotMatch(e2ee, /sessionStorage\.setItem/);
  assert.match(e2ee, /sessionStorage\.getItem\(sessionKey\(identity\.user_id\)\)/);
  assert.match(hook, /rememberPrivateMessagingProfile\(profileId\)/);
  assert.match(hook, /encryptionIdentityStatus\(\)/);
  assert.doesNotMatch(hook, /conversationId|peerUserId|workspace/);

  // Signing out deliberately ends the shared unlocked session.
  assert.match(auth, /sessionStorage\.clear\(\)/);
});

test("automatic encryption has optional passkey recovery and an explicit history-loss decision", async () => {
  const [panel,e2ee] = await Promise.all([read("src/components/SecureMessagesPanel.tsx"),read("src/lib/e2ee.ts")]);
  assert.match(panel,/Continue without previous history/);assert.match(panel,/Restore with passkey/);
  assert.doesNotMatch(panel,/Create a 6-digit|Change passcode|Confirm recovery passcode/);
  assert.match(e2ee,/create_my_automatic_private_identity/);assert.match(e2ee,/start_my_new_private_identity/);
});

test("Inbox surfaces do not expose a permanent PIN settings tab", async () => {
  const [personalInbox, serviceProviderInbox] = await Promise.all([
    read("src/pages/Chat.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
  ]);
  assert.doesNotMatch(personalInbox, />Inbox PIN</);
  assert.doesNotMatch(serviceProviderInbox, />Inbox PIN</);
});

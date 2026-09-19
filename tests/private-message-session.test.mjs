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
  assert.match(e2ee, /sessionStorage\.setItem\(sessionKey\(identity\.user_id\)/);
  assert.match(e2ee, /sessionStorage\.getItem\(sessionKey\(identity\.user_id\)\)/);
  assert.match(hook, /rememberPrivateMessagingProfile\(profileId\)/);
  assert.match(hook, /encryptionIdentityStatus\(\)/);
  assert.doesNotMatch(hook, /conversationId|peerUserId|workspace/);

  // Signing out deliberately ends the shared unlocked session.
  assert.match(auth, /sessionStorage\.clear\(\)/);
});

test("forgotten Inbox passcode creates and confirms a replacement without asking for the old passcode", async () => {
  const onboarding = await read("src/components/SecureChatOnboarding.tsx");
  assert.match(onboarding, /Forgot passcode\?/);
  assert.match(onboarding, /Choose six new digits\. You do not need the old passcode\./);
  assert.match(onboarding, /resetEncryptionRecoveryPin\(pin\)/);
  assert.match(onboarding, /Confirm your passcode/);
});

test("Inbox surfaces do not expose a permanent PIN settings tab", async () => {
  const [personalInbox, serviceProviderInbox] = await Promise.all([
    read("src/pages/Chat.tsx"),
    read("src/components/WorkerJobsPanelV2.tsx"),
  ]);
  assert.doesNotMatch(personalInbox, />Inbox PIN</);
  assert.doesNotMatch(serviceProviderInbox, />Inbox PIN</);
});

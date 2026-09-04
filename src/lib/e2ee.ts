import { supabase } from "@/lib/supabase";

export type PrivateConversationKind = "roommate" | "worker";
export type EncryptedAttachment = {
  path: string;
  file_iv: string;
  metadata_ciphertext: string;
  metadata_iv: string;
};
type IdentityRow = {
  user_id: string;
  key_version: number;
  public_key_jwk: JsonWebKey;
  encrypted_private_key: string;
  backup_iv: string;
  backup_salt: string;
  kdf_iterations: number;
};
type EnvelopeRow = {
  recipient_user_id: string;
  recipient_key_version: number;
  sender_ephemeral_public_key_jwk: JsonWebKey;
  wrapped_key: string;
  wrap_iv: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_KEY_PREFIX = "wehouse:e2ee:private-key:";
const readinessTimeoutMs = 10_000;

async function currentProfileId(){
  const {data,error}=await supabase.rpc("current_profile_user_id");
  if(error||!data)throw error||new Error("Active WeHouse profile required");
  return String(data);
}
function sessionKey(profileId:string){return `${SESSION_KEY_PREFIX}${profileId}`}

function bytesToBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function pinKey(pin: string, salt: Uint8Array, iterations = 600_000) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function importPrivateKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}
async function importPublicKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
}
async function wrappingKey(privateKey: CryptoKey, publicKey: CryptoKey) {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function myIdentity() {
  const { data, error } = await supabase.from("user_encryption_identities").select("*").maybeSingle();
  return { identity: (data || null) as IdentityRow | null, error };
}

export async function createEncryptionIdentity(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("Use a 6-digit Recovery PIN");
  const existing = await myIdentity();
  if (existing.error) throw existing.error;
  if (existing.identity) throw new Error("Secure messaging is already set up");
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  )) as CryptoKeyPair;
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinKey(pin, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(privateJwk)));
  const profileId=await currentProfileId();
  const { error } = await supabase.from("user_encryption_identities").insert({
    user_id: profileId,
    public_key_jwk: publicJwk,
    encrypted_private_key: bytesToBase64(encrypted),
    backup_iv: bytesToBase64(iv),
    backup_salt: bytesToBase64(salt),
    kdf_iterations: 600_000,
  });
  if (error) throw error;
  sessionStorage.setItem(sessionKey(profileId), JSON.stringify(privateJwk));
}

export async function unlockEncryptionIdentity(pin: string) {
  const { identity, error } = await myIdentity();
  if (error) throw error;
  if (!identity) throw new Error("Secure messaging has not been set up");
  try {
    const key = await pinKey(pin, base64ToBytes(identity.backup_salt), identity.kdf_iterations);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(identity.backup_iv) },
      key,
      base64ToBytes(identity.encrypted_private_key),
    );
    const jwk = JSON.parse(decoder.decode(clear)) as JsonWebKey;
    sessionStorage.setItem(sessionKey(identity.user_id), JSON.stringify(jwk));
  } catch {
    throw new Error("Incorrect Recovery PIN");
  }
}

async function decryptBackedUpPrivateJwk(identity: IdentityRow, pin: string) {
  try {
    const key = await pinKey(pin, base64ToBytes(identity.backup_salt), identity.kdf_iterations);
    const clear = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(identity.backup_iv) },
      key,
      base64ToBytes(identity.encrypted_private_key),
    );
    return JSON.parse(decoder.decode(clear)) as JsonWebKey;
  } catch {
    throw new Error("Incorrect current Recovery PIN");
  }
}

export async function changeEncryptionRecoveryPin(currentPin: string, nextPin: string) {
  if (!/^\d{6}$/.test(nextPin)) throw new Error("Use a 6-digit Recovery PIN");
  if (currentPin === nextPin) throw new Error("Choose a different Recovery PIN");
  const { identity, error } = await myIdentity();
  if (error) throw error;
  if (!identity) throw new Error("Secure messaging has not been set up");
  const privateJwk = await decryptBackedUpPrivateJwk(identity, currentPin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinKey(nextPin, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(privateJwk)),
  );
  const { error: updateError } = await supabase
    .from("user_encryption_identities")
    .update({
      encrypted_private_key: bytesToBase64(encrypted),
      backup_iv: bytesToBase64(iv),
      backup_salt: bytesToBase64(salt),
      kdf_iterations: 600_000,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", identity.user_id)
    .eq("key_version", identity.key_version);
  if (updateError) throw updateError;
  // The identity key itself is unchanged, so existing conversation envelopes
  // and old messages remain decryptable. Only its encrypted recovery backup changes.
  sessionStorage.setItem(sessionKey(identity.user_id), JSON.stringify(privateJwk));
}

export async function lockEncryptionIdentity() {
  sessionStorage.removeItem(sessionKey(await currentProfileId()));
}

export async function encryptionIdentityStatus() {
  const { identity, error } = await myIdentity();
  const unlocked=identity?Boolean(sessionStorage.getItem(sessionKey(identity.user_id))):false;
  return { enabled: Boolean(identity), unlocked, error };
}

export type PrivateConversationReadiness = {
  state: "ready" | "setup_required" | "unlock_required" | "peer_setup_required" | "unavailable";
  message: string;
};

export async function privateConversationReadiness(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
): Promise<PrivateConversationReadiness> {
  return Promise.race([
    checkPrivateConversationReadiness(kind, conversationId, peerUserId),
    new Promise<PrivateConversationReadiness>((resolve) => window.setTimeout(() => resolve({
      state: "unavailable",
      message: "Secure chat is taking longer than expected. Check your connection and try again.",
    }), readinessTimeoutMs)),
  ]);
}

async function checkPrivateConversationReadiness(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
): Promise<PrivateConversationReadiness> {
  const mine = await encryptionIdentityStatus();
  if (mine.error) return { state: "unavailable", message: mine.error.message || "Secure chat could not be checked" };
  if (!mine.enabled) return { state: "setup_required", message: "Create your Recovery PIN before sending private messages." };
  if (!mine.unlocked) return { state: "unlock_required", message: "Unlock private messages with your Recovery PIN on this device." };
  try {
    await peerPublicKey(kind, conversationId, peerUserId);
    return { state: "ready", message: "End-to-end encrypted" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Secure chat is not ready";
    if (/other person.*enable secure messages/i.test(message)) {
      return { state: "peer_setup_required", message: "This person has not activated encrypted chats yet." };
    }
    return { state: "unavailable", message };
  }
}

async function unlockedPrivateKey() {
  const value = sessionStorage.getItem(sessionKey(await currentProfileId()));
  if (!value) throw new Error("Enter your Recovery PIN to unlock private messages");
  return importPrivateKey(JSON.parse(value) as JsonWebKey);
}
async function peerPublicKey(kind: PrivateConversationKind, conversationId: string, peerUserId: string) {
  const { data, error } = await supabase.rpc("get_private_chat_peer_public_key", {
    p_conversation_kind: kind,
    p_conversation_id: conversationId,
    p_peer_user_id: peerUserId,
  });
  if (error) throw error;
  const row = data?.[0] as { user_id: string; key_version: number; public_key_jwk: JsonWebKey } | undefined;
  if (!row) throw new Error("The other person must enable secure messages before this chat can be encrypted");
  return row;
}
async function wrapFor(key: CryptoKey, recipient: { user_id: string; key_version: number; public_key_jwk: JsonWebKey }) {
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"])) as CryptoKeyPair;
  const wrapKey = await wrappingKey(ephemeral.privateKey, await importPublicKey(recipient.public_key_jwk));
  const raw = await crypto.subtle.exportKey("raw", key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, raw);
  return {
    recipient_user_id: recipient.user_id,
    recipient_key_version: recipient.key_version,
    sender_ephemeral_public_key_jwk: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
    wrapped_key: bytesToBase64(wrapped),
    wrap_iv: bytesToBase64(iv),
  };
}
async function conversationKey(kind: PrivateConversationKind, conversationId: string, peerUserId: string) {
  const profileId=await currentProfileId();
  const { data: existing, error } = await supabase
    .from("conversation_key_envelopes")
    .select("*")
    .eq("conversation_kind", kind)
    .eq("conversation_id", conversationId)
    .eq("recipient_user_id", profileId)
    .order("recipient_key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) {
    const envelope = existing as EnvelopeRow;
    const wrapKey = await wrappingKey(await unlockedPrivateKey(), await importPublicKey(envelope.sender_ephemeral_public_key_jwk));
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.wrap_iv) }, wrapKey, base64ToBytes(envelope.wrapped_key));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  const mine = await myIdentity();
  if (mine.error) throw mine.error;
  if (!mine.identity) throw new Error("Set a Recovery PIN to enable secure messages");
  await unlockedPrivateKey();
  const peer = await peerPublicKey(kind, conversationId, peerUserId);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const envelopes = await Promise.all([
    wrapFor(key, { user_id: mine.identity.user_id, key_version: mine.identity.key_version, public_key_jwk: mine.identity.public_key_jwk }),
    wrapFor(key, peer),
  ]);
  const { data: established, error: insertError } = await supabase.rpc("establish_private_conversation_key", {
    p_conversation_kind: kind,
    p_conversation_id: conversationId,
    p_envelopes: envelopes,
  });
  if (insertError) throw insertError;
  if (established) return key;

  // The peer won a simultaneous setup race. Discard our candidate key and
  // unwrap the single canonical key that transaction established.
  const { data: winner, error: winnerError } = await supabase
    .from("conversation_key_envelopes")
    .select("*")
    .eq("conversation_kind", kind)
    .eq("conversation_id", conversationId)
    .eq("recipient_user_id", profileId)
    .order("recipient_key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (winnerError) throw winnerError;
  if (!winner) throw new Error("Secure conversation setup did not complete");
  const envelope = winner as EnvelopeRow;
  const wrapKey = await wrappingKey(await unlockedPrivateKey(), await importPublicKey(envelope.sender_ephemeral_public_key_jwk));
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.wrap_iv) }, wrapKey, base64ToBytes(envelope.wrapped_key));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPrivateMessage(kind: PrivateConversationKind, conversationId: string, peerUserId: string, content: string) {
  const key = await conversationKey(kind, conversationId, peerUserId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(content));
  return { ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv) };
}
export async function decryptPrivateMessage(kind: PrivateConversationKind, conversationId: string, peerUserId: string, ciphertext: string, iv: string) {
  const key = await conversationKey(kind, conversationId, peerUserId);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return decoder.decode(clear);
}

export async function encryptPrivateAttachment(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
  file: Blob,
  metadata: { name: string; type: string },
) {
  const key = await conversationKey(kind, conversationId, peerUserId);
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const metadataIv = crypto.getRandomValues(new Uint8Array(12));
  const [ciphertext, metadataCiphertext] = await Promise.all([
    crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIv }, key, await file.arrayBuffer()),
    crypto.subtle.encrypt({ name: "AES-GCM", iv: metadataIv }, key, encoder.encode(JSON.stringify(metadata))),
  ]);
  return {
    blob: new Blob([ciphertext], { type: "application/octet-stream" }),
    file_iv: bytesToBase64(fileIv),
    metadata_ciphertext: bytesToBase64(metadataCiphertext),
    metadata_iv: bytesToBase64(metadataIv),
  };
}

export async function decryptPrivateAttachment(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
  attachment: EncryptedAttachment,
) {
  const key = await conversationKey(kind, conversationId, peerUserId);
  const { data, error } = await supabase.storage.from("chat-files").createSignedUrl(attachment.path, 300);
  if (error || !data?.signedUrl) throw error || new Error("Encrypted attachment is unavailable");
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error("Encrypted attachment could not be downloaded");
  const [clear, metadataClear] = await Promise.all([
    crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(attachment.file_iv) }, key, await response.arrayBuffer()),
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(attachment.metadata_iv) },
      key,
      base64ToBytes(attachment.metadata_ciphertext),
    ),
  ]);
  const metadata = JSON.parse(decoder.decode(metadataClear)) as { name: string; type: string };
  return { url: URL.createObjectURL(new Blob([clear], { type: metadata.type })), ...metadata };
}

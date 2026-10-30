import { validateMessageMedia, normaliseChatMediaType } from "@/lib/chatMediaPolicy";
import { supabase } from "@/lib/supabase";
import { ByteCache } from './byteCache';
import {assertPrivateMessagingSession,invalidatePrivateMessagingSession,onPrivateMessagingSessionInvalidated,privateMessagingSessionVersion,PrivateMessagingSessionChanged,rememberPrivateMessagingKeyVersion,storedPrivateMessagingKeyVersion} from './privateMessagingSession';

export type PrivateConversationKind = "roommate" | "worker" | "friend";
export type EncryptedAttachment = {
  path: string;
  file_iv: string;
  metadata_ciphertext: string;
  metadata_iv: string;
  /** Local preparation receipt; stripped before sending or storing the message. */
  prepared_envelope_token?: string;
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
const PRIVATE_MESSAGE_ACCESS_EVENT = "wehouse:private-message-access";
const readinessTimeoutMs = 10_000;
type ConversationKey={key:CryptoKey;token:string};
const conversationKeyCache = new Map<string, Promise<ConversationKey>>();
const conversationEnvelopeReceipts=new Map<string,string>();
const conversationReadyCache=new Map<string,{at:number;status:PrivateConversationReadiness}>();
let activeProfileId: string | null = null;
let activeProfileIdRequest: Promise<string> | null = null;
let activeIdentityVersion:number|null=null;

export function rememberPrivateMessagingProfile(profileId: string) {
  if (!profileId || activeProfileId === profileId) return;
  invalidatePrivateMessagingSession('profile');
  activeProfileId = profileId;
  activeProfileIdRequest = null;
  conversationKeyCache.clear();
}

function announcePrivateMessageAccessChange() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(PRIVATE_MESSAGE_ACCESS_EVENT));
}

export function onPrivateMessageAccessChange(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(PRIVATE_MESSAGE_ACCESS_EVENT, listener);
  return () => window.removeEventListener(PRIVATE_MESSAGE_ACCESS_EVENT, listener);
}

async function currentProfileId() {
  if (activeProfileId) return activeProfileId;
  if (activeProfileIdRequest) return activeProfileIdRequest;
  const version=privateMessagingSessionVersion();
  const pending = Promise.resolve().then(async () => {
      const { data, error } = await supabase.rpc("current_profile_user_id");
      if (error || !data)
        throw error || new Error("Active WeHouse profile required");
      const profileId = String(data);
      assertPrivateMessagingSession(version);
      activeProfileId = profileId;
      return profileId;
  }).finally(()=>{if(activeProfileIdRequest===pending)activeProfileIdRequest = null;});
  activeProfileIdRequest=pending;
  return pending;
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
  const version=privateMessagingSessionVersion(),profileId=await currentProfileId();
  assertPrivateMessagingSession(version);
  const { data, error } = await supabase.from("user_encryption_identities").select("user_id,key_version,public_key_jwk,encrypted_private_key,backup_iv,backup_salt,kdf_iterations").eq('user_id',profileId).maybeSingle();
  assertPrivateMessagingSession(version);
  if(data&&data.user_id!==profileId)throw new Error('Private-message identity could not be confirmed');
  activeIdentityVersion=data?.key_version??null;
  return { identity: (data || null) as IdentityRow | null, error };
}

export async function createEncryptionIdentity(pin: string) {
  const version=privateMessagingSessionVersion();
  if (!/^\d{6}$/.test(pin)) throw new Error("Use a 6-digit recovery passcode");
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
  assertPrivateMessagingSession(version);
  const { error } = await supabase.from("user_encryption_identities").insert({
    user_id: profileId,
    key_version: 1,
    public_key_jwk: publicJwk,
    encrypted_private_key: bytesToBase64(encrypted),
    backup_iv: bytesToBase64(iv),
    backup_salt: bytesToBase64(salt),
    kdf_iterations: 600_000,
  });
  if (error) throw error;
  assertPrivateMessagingSession(version);
  invalidatePrivateMessagingSession('identity');
  sessionStorage.setItem(sessionKey(profileId), JSON.stringify(privateJwk));
  rememberPrivateMessagingKeyVersion(profileId,1);
  announcePrivateMessageAccessChange();
}

export async function unlockEncryptionIdentity(pin: string) {
  const version=privateMessagingSessionVersion();
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
    assertPrivateMessagingSession(version);
    invalidatePrivateMessagingSession('identity');
    sessionStorage.setItem(sessionKey(identity.user_id), JSON.stringify(jwk));
    rememberPrivateMessagingKeyVersion(identity.user_id,identity.key_version);
    announcePrivateMessageAccessChange();
  } catch (cause) {
    if(cause instanceof PrivateMessagingSessionChanged)throw cause;
    throw new Error("Incorrect recovery passcode");
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
    throw new Error("Incorrect current recovery passcode");
  }
}

export async function changeEncryptionRecoveryPin(currentPin: string, nextPin: string) {
  const version=privateMessagingSessionVersion();
  if (!/^\d{6}$/.test(nextPin)) throw new Error("Use a 6-digit recovery passcode");
  if (currentPin === nextPin) throw new Error("Choose a different recovery passcode");
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
  assertPrivateMessagingSession(version);
  const { data: updated, error: updateError } = await supabase
    .from("user_encryption_identities")
    .update({
      encrypted_private_key: bytesToBase64(encrypted),
      backup_iv: bytesToBase64(iv),
      backup_salt: bytesToBase64(salt),
      kdf_iterations: 600_000,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", identity.user_id)
    .eq("key_version", identity.key_version).select('user_id,key_version').maybeSingle();
  if (updateError) throw updateError;
  if(updated?.user_id!==identity.user_id||updated.key_version!==identity.key_version)throw new Error('The private-message backup changed in another session. Refresh before changing its passcode.');
  assertPrivateMessagingSession(version);
  // The identity key itself is unchanged, so existing conversation envelopes
  // and old messages remain decryptable. Only its encrypted recovery backup changes.
  sessionStorage.setItem(sessionKey(identity.user_id), JSON.stringify(privateJwk));
  rememberPrivateMessagingKeyVersion(identity.user_id,identity.key_version);
  announcePrivateMessageAccessChange();
}

export async function lockEncryptionIdentity() {
  const version=privateMessagingSessionVersion(),profileId=await currentProfileId();
  assertPrivateMessagingSession(version);
  invalidatePrivateMessagingSession('lock');
  sessionStorage.removeItem(sessionKey(profileId));
  announcePrivateMessageAccessChange();
}

export async function encryptionIdentityStatus() {
  const { identity, error } = await myIdentity();
  const unlocked=identity?Boolean(sessionStorage.getItem(sessionKey(identity.user_id)))&&storedPrivateMessagingKeyVersion(identity.user_id)===identity.key_version:false;
  if(identity&&!unlocked&&sessionStorage.getItem(sessionKey(identity.user_id))){
    invalidatePrivateMessagingSession('identity');sessionStorage.removeItem(sessionKey(identity.user_id));
  }
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
  let timeout:number|undefined;
  try{
  const version=privateMessagingSessionVersion(),profileId=await currentProfileId();
  assertPrivateMessagingSession(version);
  const cacheKey=`${profileId}:${version}:${kind}:${conversationId}:${peerUserId}`,cached=conversationReadyCache.get(cacheKey);
  // Readiness is a short-lived UI hint. Every message read/write still passes
  // the server's current session, participant and workspace checks.
  if(cached&&Date.now()-cached.at<15000)return cached.status;
  const status=await Promise.race([
    checkPrivateConversationReadiness(kind, conversationId, peerUserId),
    new Promise<PrivateConversationReadiness>((resolve) => {timeout=window.setTimeout(() => resolve({
      state: "unavailable",
      message: "Secure chat is taking longer than expected. Check your connection and try again.",
    }), readinessTimeoutMs);}),
  ]);
  if(status.state!=='ready')return status;
  assertPrivateMessagingSession(version);
  if(status.state==='ready'){
    if(conversationReadyCache.size>=64)conversationReadyCache.delete(conversationReadyCache.keys().next().value!);
    conversationReadyCache.set(cacheKey,{at:Date.now(),status});
  }
  return status;
  }catch(cause){return {state:'unavailable',message:cause instanceof PrivateMessagingSessionChanged?cause.message:'Secure chat could not be checked. Check your connection and try again.'};}
  finally{if(timeout!==undefined)window.clearTimeout(timeout);}
}

async function checkPrivateConversationReadiness(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
): Promise<PrivateConversationReadiness> {
  const mine = await encryptionIdentityStatus();
  if (mine.error) return { state: "unavailable", message: mine.error.message || "Secure chat could not be checked" };
  if (!mine.enabled) return { state: "setup_required", message: "Create your recovery passcode before sending private messages." };
  if (!mine.unlocked) return { state: "unlock_required", message: "Unlock private messages with your recovery passcode on this device." };
  const profileId = await currentProfileId();
  const { data: existingEnvelope, error: envelopeError } = await supabase
    .from("conversation_key_envelopes")
    .select("recipient_user_id,recipient_key_version,wrap_iv,wrapped_key")
    .eq("conversation_kind", kind)
    .eq("conversation_id", conversationId)
    .eq("recipient_user_id", profileId)
    .limit(1)
    .maybeSingle();
  if (envelopeError)
    return { state: "unavailable", message: envelopeError.message || "Secure chat could not be checked" };
  const cacheKey=`${profileId}:${privateMessagingSessionVersion()}:${kind}:${conversationId}:${peerUserId}`;
  const saved=conversationEnvelopeReceipts.get(cacheKey);
  if(!existingEnvelope||saved&&saved!==envelopeToken(existingEnvelope as EnvelopeRow)){
    conversationKeyCache.delete(cacheKey);conversationEnvelopeReceipts.delete(cacheKey);
  }
  if (existingEnvelope) return { state: "ready", message: "End-to-end encrypted" };
  const peerResult = await peerPublicKey(kind, conversationId, peerUserId)
    .then(() => ({ ready: true, error: null as unknown }))
    .catch((error: unknown) => ({ ready: false, error }));
  if (peerResult.ready) return { state: "ready", message: "End-to-end encrypted" };
  const message = peerResult.error instanceof Error ? peerResult.error.message : "Secure chat is not ready";
  if (/other person.*enable secure messages/i.test(message)) {
    return { state: "peer_setup_required", message: "This person has not activated encrypted chats yet." };
  }
  return { state: "unavailable", message };
}

async function unlockedPrivateKey() {
  const profileId=await currentProfileId();
  const expected=activeIdentityVersion??(await myIdentity()).identity?.key_version;
  const value = sessionStorage.getItem(sessionKey(profileId));
  if (!value) throw new Error("Enter your recovery passcode to unlock private messages");
  if(!expected||storedPrivateMessagingKeyVersion(profileId)!==expected)throw new Error('Unlock private messages with the current recovery passcode on this device');
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
  if(row.user_id!==peerUserId||!Number.isSafeInteger(row.key_version)||row.key_version<1)throw new Error('The other person’s current encryption identity could not be confirmed');
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
function envelopeToken(envelope:Pick<EnvelopeRow,'recipient_key_version'|'wrap_iv'|'wrapped_key'>){return `${envelope.recipient_key_version}:${envelope.wrap_iv}:${envelope.wrapped_key}`;}
async function loadConversationKey(kind: PrivateConversationKind, conversationId: string, peerUserId: string) {
  const version=privateMessagingSessionVersion();
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
    return {key:await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),token:envelopeToken(envelope)};
  }
  const mine = await myIdentity();
  if (mine.error) throw mine.error;
  if (!mine.identity) throw new Error("Set a recovery passcode to enable secure messages");
  await unlockedPrivateKey();
  const peer = await peerPublicKey(kind, conversationId, peerUserId);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const envelopes = await Promise.all([
    wrapFor(key, { user_id: mine.identity.user_id, key_version: mine.identity.key_version, public_key_jwk: mine.identity.public_key_jwk }),
    wrapFor(key, peer),
  ]);
  assertPrivateMessagingSession(version);
  const { data: established, error: insertError } = await supabase.rpc("establish_private_conversation_key", {
    p_conversation_kind: kind,
    p_conversation_id: conversationId,
    p_envelopes: envelopes,
  });
  if (insertError) throw insertError;
  if (established) return {key,token:envelopeToken(envelopes[0])};

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
  return {key:await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),token:envelopeToken(envelope)};
}

async function conversationKey(kind: PrivateConversationKind, conversationId: string, peerUserId: string) {
  const version=privateMessagingSessionVersion(),profileId=await currentProfileId();
  assertPrivateMessagingSession(version);
  const cacheKey = `${profileId}:${version}:${kind}:${conversationId}:${peerUserId}`;
  const existing = conversationKeyCache.get(cacheKey);
  if (existing) {conversationKeyCache.delete(cacheKey);conversationKeyCache.set(cacheKey,existing);return existing.then(key=>{assertPrivateMessagingSession(version);return key;});}
  const pending = loadConversationKey(kind, conversationId, peerUserId).then(context=>{assertPrivateMessagingSession(version);if(conversationKeyCache.get(cacheKey)===pending)conversationEnvelopeReceipts.set(cacheKey,context.token);return context;}).catch((error) => {
    if(conversationKeyCache.get(cacheKey)===pending)conversationKeyCache.delete(cacheKey);
    throw error;
  });
  if(conversationKeyCache.size>=128){const oldest=conversationKeyCache.keys().next().value!;conversationKeyCache.delete(oldest);conversationEnvelopeReceipts.delete(oldest);}
  conversationKeyCache.set(cacheKey, pending);
  return pending;
}

export function preparePrivateConversation(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
) {
  // Warm the key while the message request is in flight. The actual decrypt
  // still awaits the same cached promise and surfaces its own readable state.
  void conversationKey(kind, conversationId, peerUserId).catch(() => undefined);
}
export function invalidatePrivateConversationKey(kind:PrivateConversationKind,conversationId:string){
  const marker=`:${kind}:${conversationId}:`;
  for(const key of conversationKeyCache.keys())if(key.includes(marker)){conversationKeyCache.delete(key);conversationEnvelopeReceipts.delete(key);}
  for(const key of conversationReadyCache.keys())if(key.includes(marker))conversationReadyCache.delete(key);
}

export async function encryptPrivateMessage(kind: PrivateConversationKind, conversationId: string, peerUserId: string, content: string) {
  const version=privateMessagingSessionVersion();
  const {key,token} = await conversationKey(kind, conversationId, peerUserId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(content));
  assertPrivateMessagingSession(version);
  return { ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv),envelopeToken:token };
}
export async function decryptPrivateMessage(kind: PrivateConversationKind, conversationId: string, peerUserId: string, ciphertext: string, iv: string) {
  const version=privateMessagingSessionVersion();
  const {key} = await conversationKey(kind, conversationId, peerUserId);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  assertPrivateMessagingSession(version);
  return decoder.decode(clear);
}

export async function encryptPrivateAttachment(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
  file: Blob,
  metadata: { name: string; type: string },
) {
  const version=privateMessagingSessionVersion();
  const {key,token} = await conversationKey(kind, conversationId, peerUserId);
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const metadataIv = crypto.getRandomValues(new Uint8Array(12));
  const [ciphertext, metadataCiphertext] = await Promise.all([
    crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIv }, key, await file.arrayBuffer()),
    crypto.subtle.encrypt({ name: "AES-GCM", iv: metadataIv }, key, encoder.encode(JSON.stringify(metadata))),
  ]);
  assertPrivateMessagingSession(version);
  return {
    blob: new Blob([ciphertext], { type: "application/octet-stream" }),
    file_iv: bytesToBase64(fileIv),
    metadata_ciphertext: bytesToBase64(metadataCiphertext),
    metadata_iv: bytesToBase64(metadataIv),
    envelopeToken:token,
  };
}

/** Prevent a reset between file encryption/upload and message encryption. */
export function encryptedAttachmentsForSend(attachments:readonly unknown[],token:string|undefined){
  return attachments.map(value=>{
    const item=value as EncryptedAttachment|null;
    if(!item||!token||item.prepared_envelope_token!==token)throw new Error('The chat encryption changed while this file was uploading. Your draft is kept; send again to upload it with the current key.');
    return {path:item.path,file_iv:item.file_iv,metadata_ciphertext:item.metadata_ciphertext,metadata_iv:item.metadata_iv};
  });
}

const ENCRYPTED_ATTACHMENT_MEMORY_TTL = 30 * 60_000;
const MAX_ENCRYPTED_ATTACHMENT_BYTES = 25 * 1024 * 1024 + 16; // AES-GCM authentication tag
const encryptedAttachmentCache = new ByteCache(32 * 1024 * 1024, ENCRYPTED_ATTACHMENT_MEMORY_TTL);
const attachmentDownloads=new Map<string,Promise<ArrayBuffer>>();
const attachmentControllers=new Set<AbortController>();
type OpenedPrivateAttachment={url:string;name:string;type:string};
type AttachmentWork={version:number;run:()=>Promise<OpenedPrivateAttachment>;resolve:(value:OpenedPrivateAttachment)=>void;reject:(reason:unknown)=>void};
const attachmentWork:AttachmentWork[]=[];
let activeAttachmentWork=0;
function runAttachmentWork(work:AttachmentWork){
  activeAttachmentWork++;
  void (async()=>{try{assertPrivateMessagingSession(work.version);work.resolve(await work.run());}catch(cause){work.reject(cause);}finally{
    activeAttachmentWork--;const next=attachmentWork.shift();if(next)runAttachmentWork(next);
  }})();
}
function boundedAttachmentWork(version:number,run:()=>Promise<OpenedPrivateAttachment>){
  return new Promise<OpenedPrivateAttachment>((resolve,reject)=>{
    const work={version,run,resolve,reject};
    if(activeAttachmentWork<2)runAttachmentWork(work);
    else if(attachmentWork.length<128)attachmentWork.push(work);
    else reject(new Error('Open this attachment again after the visible files finish loading.'));
  });
}
onPrivateMessagingSessionInvalidated(reason=>{
  conversationKeyCache.clear();conversationEnvelopeReceipts.clear();conversationReadyCache.clear();encryptedAttachmentCache.clear();activeIdentityVersion=null;
  attachmentDownloads.clear();for(const controller of attachmentControllers)controller.abort();
  for(const work of attachmentWork.splice(0))work.reject(new PrivateMessagingSessionChanged());
  if(reason==='authentication'){activeProfileId=null;activeProfileIdRequest=null;}
});
const ENCRYPTED_ATTACHMENT_CACHE_NAME = "wehouse-e2ee-media-v1";
const ENCRYPTED_ATTACHMENT_DISK_BYTES = 64 * 1024 * 1024;
const ENCRYPTED_ATTACHMENT_DISK_TTL = 7 * 24 * 60 * 60_000;
let attachmentCacheWriteInFlight = false;

function encryptedAttachmentCacheKey(kind: PrivateConversationKind, conversationId: string, path: string) {
  return new Request(`https://wehouse.invalid/e2ee-media/${encodeURIComponent(kind)}/${encodeURIComponent(conversationId)}/${encodeURIComponent(path)}`);
}

async function readPersistentEncryptedAttachment(kind: PrivateConversationKind, conversationId: string, path: string) {
  if (typeof window === "undefined" || !("caches" in window)) return null;
  try {
    const cache = await window.caches.open(ENCRYPTED_ATTACHMENT_CACHE_NAME);
    const response = await cache.match(encryptedAttachmentCacheKey(kind, conversationId, path));
    if (!response) return null;
    const expires = Number(response.headers.get('x-wehouse-expires'));
    const size = Number(response.headers.get('content-length'));
    if (!Number.isFinite(expires) || expires <= Date.now() || size <= 0 || size > MAX_ENCRYPTED_ATTACHMENT_BYTES) {
      await cache.delete(encryptedAttachmentCacheKey(kind, conversationId, path));
      return null;
    }
    const bytes = await response.arrayBuffer();
    return bytes.byteLength === size ? bytes : null;
  } catch {
    return null;
  }
}

async function writePersistentEncryptedAttachment(kind: PrivateConversationKind, conversationId: string, path: string, bytes: ArrayBuffer) {
  if (typeof window === "undefined" || !("caches" in window) || !window.navigator.locks || bytes.byteLength > MAX_ENCRYPTED_ATTACHMENT_BYTES || attachmentCacheWriteInFlight) return;
  // Caching is optional. Skip concurrent writes rather than queueing large
  // buffers in memory or allowing overlapping trims to exceed the disk budget.
  attachmentCacheWriteInFlight = true;
  try {
    await window.navigator.locks.request('wehouse-e2ee-media-cache', async () => {
    const cache = await window.caches.open(ENCRYPTED_ATTACHMENT_CACHE_NAME);
    const target = encryptedAttachmentCacheKey(kind, conversationId, path);
    await cache.delete(target);
    const kept: {request: Request; size: number}[] = [];
    let used = 0;
    for (const request of await cache.keys()) {
      const item = await cache.match(request);
      const size = Number(item?.headers.get('content-length'));
      const expires = Number(item?.headers.get('x-wehouse-expires'));
      if (!Number.isFinite(size) || size <= 0 || size > MAX_ENCRYPTED_ATTACHMENT_BYTES || !Number.isFinite(expires) || expires <= Date.now()) await cache.delete(request);
      else { used += size; kept.push({request, size}); }
    }
    while (kept.length && (used + bytes.byteLength > ENCRYPTED_ATTACHMENT_DISK_BYTES || kept.length >= 40)) {
      const oldest = kept.shift()!; await cache.delete(oldest.request); used -= oldest.size;
    }
    await cache.put(target, new Response(new Blob([bytes], { type: "application/octet-stream" }), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private", 'Content-Length': String(bytes.byteLength), 'x-wehouse-expires': String(Date.now() + ENCRYPTED_ATTACHMENT_DISK_TTL) } }));
    });
  } catch {
    // Persistent media cache is an optimisation; memory cache and Storage remain authoritative.
  } finally { attachmentCacheWriteInFlight = false; }
}

async function readBoundedEncryptedBody(response:Response){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_ENCRYPTED_ATTACHMENT_BYTES){await response.body?.cancel();throw new Error('Encrypted attachment is too large');}
  if(!response.body)throw new Error('Encrypted attachment is unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;
    if(length>MAX_ENCRYPTED_ATTACHMENT_BYTES){await reader.cancel();throw new Error('Encrypted attachment is too large');}chunks.push(part.value);
  }}finally{reader.releaseLock();}
  if(!length)throw new Error('Encrypted attachment is unavailable');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
}
function loadEncryptedAttachmentBytes(kind:PrivateConversationKind,conversationId:string,path:string,version:number){
  const cacheKey=`${version}:${kind}:${conversationId}:${path}`,existing=attachmentDownloads.get(cacheKey);if(existing)return existing;
  const pending=(async()=>{
    let bytes=encryptedAttachmentCache.get(path);
    if(!bytes)bytes=await readPersistentEncryptedAttachment(kind,conversationId,path);
    assertPrivateMessagingSession(version);
    if(!bytes){
      const {data,error}=await supabase.storage.from('chat-files').createSignedUrl(path,3600);
      assertPrivateMessagingSession(version);
      if(error||!data?.signedUrl)throw error||new Error('Encrypted attachment is unavailable');
      const controller=new AbortController();attachmentControllers.add(controller);const timeout=setTimeout(()=>controller.abort(),30000);
      try{const response=await fetch(data.signedUrl,{signal:controller.signal});if(!response.ok)throw new Error('Encrypted attachment could not be downloaded');bytes=await readBoundedEncryptedBody(response);}
      finally{clearTimeout(timeout);attachmentControllers.delete(controller);}
      assertPrivateMessagingSession(version);void writePersistentEncryptedAttachment(kind,conversationId,path,bytes);
    }
    assertPrivateMessagingSession(version);encryptedAttachmentCache.set(path,bytes);return bytes;
  })().finally(()=>{if(attachmentDownloads.get(cacheKey)===pending)attachmentDownloads.delete(cacheKey);});
  attachmentDownloads.set(cacheKey,pending);return pending;
}
export async function decryptPrivateAttachment(
  kind: PrivateConversationKind,
  conversationId: string,
  peerUserId: string,
  attachment: EncryptedAttachment,
) {
  const version=privateMessagingSessionVersion();
  return boundedAttachmentWork(version,()=>decryptPrivateAttachmentInSlot(kind,conversationId,peerUserId,attachment,version));
}
async function decryptPrivateAttachmentInSlot(kind:PrivateConversationKind,conversationId:string,peerUserId:string,attachment:EncryptedAttachment,version:number){
  const {key} = await conversationKey(kind, conversationId, peerUserId);
  const encryptedBytes=await loadEncryptedAttachmentBytes(kind,conversationId,attachment.path,version);
  const [clear, metadataClear] = await Promise.all([
    crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(attachment.file_iv) }, key, encryptedBytes),
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(attachment.metadata_iv) },
      key,
      base64ToBytes(attachment.metadata_ciphertext),
    ),
  ]);
  const metadata = JSON.parse(decoder.decode(metadataClear)) as { name: string; type: string };
  if (!metadata || typeof metadata.type !== "string" || typeof metadata.name !== "string" || metadata.name.length > 160) throw new Error("Invalid private media metadata");
  const blob = new Blob([clear], { type: normaliseChatMediaType(metadata.type) });
  await validateMessageMedia(blob, metadata);
  assertPrivateMessagingSession(version);
  // Return only validated fields: arbitrary sender metadata must not override url.
  return { url: URL.createObjectURL(blob), name: metadata.name, type: blob.type };
}

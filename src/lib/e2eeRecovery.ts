import { supabase } from "@/lib/supabase";

const encoder = new TextEncoder();
const SESSION_KEY_PREFIX = "wehouse:e2ee:private-key:";
const PRIVATE_MESSAGE_ACCESS_EVENT = "wehouse:private-message-access";

function bytesToBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function derivePinKey(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
}

/**
 * Forgotten Inbox-passcode recovery deliberately does not ask for the old PIN.
 * The old PIN is the only client-side proof capable of decrypting the old
 * private key, so a forgotten-PIN recovery must rotate the E2EE identity.
 * Existing ciphertext is retained server-side but may no longer be readable.
 */
export async function resetEncryptionRecoveryPin(nextPin: string) {
  if (!/^\d{6}$/.test(nextPin))
    throw new Error("Use a 6-digit recovery passcode");

  const { data: profileId, error: profileError } = await supabase.rpc(
    "current_profile_user_id",
  );
  if (profileError || !profileId)
    throw profileError || new Error("Active WeHouse profile required");

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
  const key = await derivePinKey(nextPin, salt);
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(privateJwk)),
  );

  const { data: keyVersion, error } = await supabase.rpc(
    "reset_my_encryption_identity",
    {
      p_public_key_jwk: publicJwk,
      p_encrypted_private_key: bytesToBase64(encryptedPrivateKey),
      p_backup_iv: bytesToBase64(iv),
      p_backup_salt: bytesToBase64(salt),
      p_kdf_iterations: 600_000,
    },
  );
  if (error || !keyVersion)
    throw error || new Error("Private-message recovery could not be reset");

  sessionStorage.setItem(
    `${SESSION_KEY_PREFIX}${String(profileId)}`,
    JSON.stringify(privateJwk),
  );
  window.dispatchEvent(new Event(PRIVATE_MESSAGE_ACCESS_EVENT));
  return Number(keyVersion);
}

import {privateKeyStorage} from './privateKeyStorage';
import type {StoredPrivateIdentity} from './privateKeyStorage';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function validateOwner(profileId: string, version: number) {
  if (!profileId || profileId.length > 80 || !Number.isSafeInteger(version) || version < 1) throw new Error('The private-chat identity could not be confirmed.');
}
function aad(profileId: string, version: number) {return encoder.encode(`wehouse:private-device-key:v1:${profileId}:${version}`);}
export function samePrivatePublicKey(a: JsonWebKey | undefined, b: JsonWebKey | undefined) {
  return Boolean(a && b && a.kty === 'EC' && b.kty === 'EC' && a.crv === 'P-256' && b.crv === 'P-256' && a.x === b.x && a.y === b.y && a.x && a.y);
}
export async function validatePrivateJwk(privateKey: JsonWebKey, publicKey: JsonWebKey) {
  if (!samePrivatePublicKey(privateKey, publicKey) || typeof privateKey.d !== 'string') throw new Error('This backup does not match your private-chat identity.');
  return crypto.subtle.importKey('jwk', privateKey, {name: 'ECDH', namedCurve: 'P-256'}, false, ['deriveKey']);
}
export async function readPrivateDeviceJwk(profileId: string, version: number, expectedPublicKey?: JsonWebKey) {
  validateOwner(profileId, version);
  const record = await privateKeyStorage.get(profileId, version, expectedPublicKey);
  if (!record) return null;
  if (record.profileId !== profileId || record.keyVersion !== version || record.deviceKey.extractable || record.deviceKey.algorithm.name !== 'AES-GCM' || record.ciphertext.byteLength > 20000 || record.iv.byteLength !== 12 || expectedPublicKey && !samePrivatePublicKey(record.publicKey, expectedPublicKey)) throw new Error('The private key stored on this device could not be confirmed.');
  const clear = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: record.iv as BufferSource, additionalData: aad(profileId, version)}, record.deviceKey, record.ciphertext));
  try {
    const jwk = JSON.parse(decoder.decode(clear)) as JsonWebKey;
    await validatePrivateJwk(jwk, record.publicKey);
    if(expectedPublicKey&&!record.confirmed)await privateKeyStorage.confirm(profileId,version,expectedPublicKey);
    return {jwk, publicKey: record.publicKey};
  } finally {clear.fill(0);}
}

export async function keepPrivateDeviceJwk(profileId: string, version: number, jwk: JsonWebKey, publicKey: JsonWebKey) {
  validateOwner(profileId, version);
  await validatePrivateJwk(jwk, publicKey);
  const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = encoder.encode(JSON.stringify(jwk));
  let ciphertext: ArrayBuffer;
  try {ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad(profileId, version)}, key, clear);} finally {clear.fill(0);}
  const record: StoredPrivateIdentity = {profileId, keyVersion: version, publicKey, deviceKey: key, ciphertext, iv};
  await privateKeyStorage.add(record);
  const saved = await readPrivateDeviceJwk(profileId, version, publicKey);
  if (!saved) throw new Error('Private chat keys could not be confirmed on this device.');
  return saved;
}

export async function preparePrivateDeviceIdentity(profileId: string, version: number) {
  const existing = await readPrivateDeviceJwk(profileId, version);
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveKey']);
  const [jwk, publicKey] = await Promise.all([crypto.subtle.exportKey('jwk', pair.privateKey), crypto.subtle.exportKey('jwk', pair.publicKey)]);
  // A concurrent tab's transaction may win. Reuse its key, never replace it.
  const deviceKey = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = encoder.encode(JSON.stringify(jwk));
  let ciphertext: ArrayBuffer;
  try {ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad(profileId, version)}, deviceKey, clear);} finally {clear.fill(0);}
  await privateKeyStorage.add({profileId, keyVersion: version, publicKey, deviceKey, ciphertext, iv});
  const saved = await readPrivateDeviceJwk(profileId, version);
  if (!saved) throw new Error('Private chat setup could not be confirmed on this device.');
  return saved;
}

export async function removePrivateDeviceKey(profileId: string, version: number) {validateOwner(profileId, version); await privateKeyStorage.remove(profileId, version);}

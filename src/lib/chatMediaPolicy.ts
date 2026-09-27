/** Chat is not document transfer. Keep identity/compliance upload workflows separate. */
export const CHAT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const CHAT_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const CHAT_VOICE_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'] as const;
export const CHAT_MEDIA_ACCEPT = [...CHAT_PHOTO_TYPES, ...CHAT_VIDEO_TYPES].join(',');
export const CHAT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_MEDIA_ONLY_MESSAGE = 'Choose a photo or video. Document and audio-file uploads are not supported.';
const recordedNotes = new WeakSet<Blob>();
export const normaliseChatMediaType = (value: string) => value.toLowerCase().split(';', 1)[0].trim();
export function isChatVisualType(type: string): boolean {
  return [...CHAT_PHOTO_TYPES, ...CHAT_VIDEO_TYPES].some(value => value === normaliseChatMediaType(type));
}
export function isChatVoiceType(type: string): boolean {
  return CHAT_VOICE_TYPES.some(value => value === normaliseChatMediaType(type));
}
export function isSelectableChatMedia(file: Pick<File, 'type' | 'size'>): boolean {
  return isChatVisualType(file.type) && file.size > 0 && file.size <= CHAT_MEDIA_MAX_BYTES;
}
/** Recorder provenance within this client, not a claim that a hostile client is trusted. */
export function markRecordedVoiceNote<T extends Blob>(file: T): T {
  if (!isChatVoiceType(file.type)) throw new Error('This voice recording format is not supported.');
  recordedNotes.add(file); return file;
}
function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
const extensions: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/gif': ['gif'],
  'video/mp4': ['mp4', 'm4v'], 'video/webm': ['webm'], 'video/quicktime': ['mov'],
  'audio/webm': ['webm'], 'audio/mp4': ['mp4', 'm4a'], 'audio/ogg': ['ogg', 'oga'], 'audio/wav': ['wav'], 'audio/x-wav': ['wav'],
};
/** Bounded format/signature check. This is defence in depth, not a malware scanner.
 * Called before upload and again after authenticated private-message decryption.
 * The server cannot inspect E2EE plaintext; never weaken encryption to inspect it.
 */
export async function validateMessageMedia(blob: Blob, metadata: { type: string; name?: string }, allowVoice = true): Promise<void> {
  const type = normaliseChatMediaType(metadata.type);
  if (!isChatVisualType(type) && !(allowVoice && isChatVoiceType(type))) throw new Error(CHAT_MEDIA_ONLY_MESSAGE);
  if (!blob.size || blob.size > CHAT_MEDIA_MAX_BYTES) throw new Error('Photos, videos and voice notes must be 25MB or smaller and cannot be empty.');
  const name = metadata.name || '';
  if (name && (/[\\/]/.test(name) || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !extensions[type]?.includes(name.split('.').at(-1)!.toLowerCase()))) {
    throw new Error('The attachment name does not match its media type.');
  }
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  let valid = false;
  if (type === 'image/jpeg') valid = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (type === 'image/png') valid = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  else if (type === 'image/gif') valid = ['GIF87a','GIF89a'].includes(ascii(bytes, 0, 6));
  else if (type === 'image/webp') valid = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  else if (type.endsWith('/webm')) valid = [26,69,223,163].every((value, index) => bytes[index] === value) && ascii(bytes, 0, bytes.length).includes('webm');
  else if (type === 'audio/ogg') valid = ascii(bytes, 0, 4) === 'OggS';
  else if (type === 'audio/wav' || type === 'audio/x-wav') valid = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE';
  else if (['video/mp4', 'video/quicktime', 'audio/mp4'].includes(type)) valid = bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp';
  if (!valid) throw new Error('This attachment is not a supported photo, video or voice recording.');
}
export async function validateChatUpload(file: File, allowVoice = true): Promise<void> {
  if (isChatVoiceType(file.type) && (!allowVoice || !recordedNotes.has(file))) {
    throw new Error('Use the microphone to record a voice note. Audio-file uploads are not supported.');
  }
  await validateMessageMedia(file, { type: file.type, name: file.name }, allowVoice);
}

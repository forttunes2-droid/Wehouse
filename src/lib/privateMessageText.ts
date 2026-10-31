export const MAX_PRIVATE_MESSAGE_TEXT_BYTES=32768;
export function assertPrivateMessageText(content:string):void {
  if(new TextEncoder().encode(content).byteLength>MAX_PRIVATE_MESSAGE_TEXT_BYTES)
    throw new Error('This message is too long. Split it into smaller messages.');
}

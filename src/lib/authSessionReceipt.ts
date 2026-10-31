/** Only the authoritative ended-session receipt ends a local login. Network,
 * configuration and MFA failures must not be mistaken for remote sign-out. */
export function isEndedSessionReceipt(error:unknown){
  if(!error||typeof error!=='object')return false;
  const value=error as {code?:unknown;hint?:unknown};
  return value.code==='PT401'&&value.hint==='session_ended';
}

/** Server-only preparation for an approved NIN provider. No adapter is enabled.
 * Construct these dependencies on the server; never accept them from a client.
 * This module does not change signup, face-review state or workspace authority.
 */
export type IdentityPurpose = 'property_partner' | 'service_worker';
export type NinOutcome = 'verified' | 'not_verified' | 'review_required';
export type NinReceipt = {
  accountId: string; purpose: IdentityPurpose; provider: string;
  reference: string; outcome: NinOutcome; checkedAt: string; expiresAt: string;
};
export type NinProviderResult = {
  accountId: string; reference: string; documentCountry: 'NG'; documentType: 'nin';
  outcome: NinOutcome; nameMatches: boolean; birthDateMatches: boolean;
};
export interface NinProvider {
  id: string;
  /** Authenticate provider server responses; bind account/name/birth date.
   * Deduplicate/reconcile requestKey on the server, including uncertain timeouts.
   * Never construct a positive response from browser claims or NIN length alone.
   */
  verify(input: { accountId: string; nin: string; fullName: string; birthDate: string; requestKey: string }): Promise<NinProviderResult>;
}
export type NinDependencies = {
  policy: { enabled: boolean; approved: boolean; purposes: IdentityPurpose[]; validitySeconds: number };
  provider: NinProvider | null;
  fingerprintSecret: string;
  authenticate: () => Promise<{ accountId: string; active: boolean; liveSession: boolean; fullName: string; birthDate: string } | null>;
  allowedAttempt: (accountId: string) => Promise<boolean>;
  /** Must be an ownership-bound server store. Never store the raw NIN or provider body. */
  receipts: {
    find: (accountId: string, purpose: IdentityPurpose, fingerprint: string) => Promise<NinReceipt | null>;
    save: (fingerprint: string, receipt: NinReceipt) => Promise<void>;
  };
  now?: () => Date;
};
export type NinRequest = { purpose: string; nin: string; consent: boolean };
export type NinResponse =
  | { status: 'unavailable' | 'not_required' | 'rejected' | 'unconfirmed'; code: string }
  | { status: 'confirmed'; receipt: NinReceipt; replayed: boolean };

export const NIN_REQUIRED_FOR_SIGNUP = false;
const purposes: IdentityPurpose[] = ['property_partner', 'service_worker'];

async function fingerprint(secret: string, accountId: string, purpose: string, nin: string, fullName: string, birthDate: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([accountId,purpose,nin,fullName.trim(),birthDate])));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2,'0')).join('');
}

export async function verifyNigerianIdentity(request: NinRequest, dependencies: NinDependencies): Promise<NinResponse> {
  if (!request || typeof request.purpose !== 'string') return { status:'rejected',code:'INVALID_VERIFICATION_PURPOSE' };
  if (request.purpose === 'account_creation') return { status:'not_required', code:'NIN_NOT_REQUIRED_FOR_SIGNUP' };
  const { policy, provider } = dependencies;
  if (!policy.enabled || !policy.approved || !provider || dependencies.fingerprintSecret.length < 32
    || !Number.isFinite(policy.validitySeconds) || policy.validitySeconds <= 0) {
    return { status:'unavailable', code:'NIN_PROVIDER_NOT_READY' };
  }
  if (!purposes.includes(request.purpose as IdentityPurpose)) return { status:'rejected', code:'INVALID_VERIFICATION_PURPOSE' };
  const purpose = request.purpose as IdentityPurpose;
  if (!policy.purposes.includes(purpose)) return { status:'not_required', code:'NIN_NOT_REQUIRED_FOR_THIS_ACTION' };
  try {
    const account = await dependencies.authenticate();
    if (!account?.accountId || !account.active || !account.liveSession) return { status:'rejected', code:'ACTIVE_SESSION_REQUIRED' };
    if (!account.fullName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(account.birthDate)) return { status:'rejected', code:'ACCOUNT_IDENTITY_DETAILS_REQUIRED' };
    if (!request.consent) return { status:'rejected', code:'CONSENT_REQUIRED' };
    const nin = typeof request.nin === 'string' ? request.nin.trim() : '';
    if (!/^\d{11}$/.test(nin)) return { status:'rejected', code:'NIN_FORMAT_INVALID' };
    if (!await dependencies.allowedAttempt(account.accountId)) return { status:'rejected', code:'TRY_LATER' };
    const key = await fingerprint(dependencies.fingerprintSecret, account.accountId, purpose, nin, account.fullName, account.birthDate);
    const now = (dependencies.now || (()=>new Date()))();
    const previous = await dependencies.receipts.find(account.accountId,purpose,key);
    if (previous && previous.accountId === account.accountId && previous.purpose === purpose
      && previous.provider === provider.id && ['verified','not_verified','review_required'].includes(previous.outcome)
      && Date.parse(previous.expiresAt) > now.getTime()) {
      return { status:'confirmed', receipt:previous, replayed:true };
    }
    const result = await provider.verify({ accountId:account.accountId, nin, fullName:account.fullName, birthDate:account.birthDate, requestKey:key });
    if (!result || result.accountId !== account.accountId || result.documentCountry !== 'NG' || result.documentType !== 'nin'
      || !result.reference?.trim() || !['verified','not_verified','review_required'].includes(result.outcome)) {
      return { status:'unconfirmed', code:'PROVIDER_RESPONSE_NOT_CONFIRMED' };
    }
    const outcome: NinOutcome = result.outcome === 'verified' && (result.nameMatches !== true || result.birthDateMatches !== true)
      ? 'review_required' : result.outcome;
    const receipt: NinReceipt = { accountId:account.accountId,purpose,provider:provider.id,reference:result.reference,
      outcome,checkedAt:now.toISOString(),expiresAt:new Date(now.getTime()+policy.validitySeconds*1000).toISOString() };
    await dependencies.receipts.save(key,receipt);
    return { status:'confirmed',receipt,replayed:false };
  } catch {
    // A provider or storage failure cannot become a verified identity claim.
    // Raw identity data, request body and provider errors are deliberately not logged.
    return { status:'unconfirmed',code:'IDENTITY_CHECK_NOT_CONFIRMED' };
  }
}

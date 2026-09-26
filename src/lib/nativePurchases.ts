import { isAndroid, isIOS } from '@/lib/native';
import { supabase } from '@/lib/supabase';

export type NativeStorePlan = {
  productId: string;
  basePlanId?: string;
  offerToken?: string;
  price: string;
};
export type NativePurchaseResult = { success: boolean; charged?: boolean; requires_review?: boolean; error?: string };
type PendingPurchase = { functionName: string; productId: string; type: 'subscription' | 'consumable'; verifyBody: Record<string, unknown> };
function pendingKey(userId: string) { return `wh_native_purchase_pending_${userId}`; }
function pending(userId: string): PendingPurchase[] {
  try { return JSON.parse(localStorage.getItem(pendingKey(userId)) || '[]') as PendingPurchase[]; }
  catch { return []; }
}
function remember(userId: string, entry: PendingPurchase) {
  localStorage.setItem(pendingKey(userId), JSON.stringify([
    ...pending(userId).filter(item => !(item.functionName === entry.functionName
      && item.productId === entry.productId && item.verifyBody.reference === entry.verifyBody.reference)), entry,
  ]));
}
function forget(userId: string, entry: PendingPurchase) {
  localStorage.setItem(pendingKey(userId), JSON.stringify(pending(userId).filter(item =>
    !(item.functionName === entry.functionName && item.productId === entry.productId
      && item.verifyBody.reference === entry.verifyBody.reference))));
}

export async function getNativeStorePlan(productId: string, type: 'subscription' | 'consumable'): Promise<NativeStorePlan> {
  if (!isIOS() && !isAndroid()) throw new Error('An app store is required');
  const { NativePurchases, PURCHASE_TYPE } = await import('@capgo/native-purchases');
  const supported = await NativePurchases.isBillingSupported();
  if (!supported.isBillingSupported) throw new Error('Store billing is unavailable on this device');
  const { products } = await NativePurchases.getProducts({
    productIdentifiers: [productId], productType: type === 'subscription' ? PURCHASE_TYPE.SUBS : PURCHASE_TYPE.INAPP,
  });
  const matches = products.filter(product => isAndroid() && type === 'subscription'
    ? product.planIdentifier === productId : product.identifier === productId);
  if (matches.length !== 1) throw new Error('This store product is unavailable or has multiple offers');
  return {
    productId, basePlanId: isAndroid() && type === 'subscription' ? matches[0].identifier : undefined,
    offerToken: matches[0].offerToken, price: matches[0].priceString,
  };
}

export async function purchaseNativeStoreProduct(plan: NativeStorePlan, type: 'subscription' | 'consumable',
  verifyBody: Record<string, unknown>, functionName: string): Promise<NativePurchaseResult> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Sign in again before purchasing');
  const { NativePurchases, PURCHASE_TYPE } = await import('@capgo/native-purchases');
  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: plan.productId,
    planIdentifier: plan.basePlanId,
    offerToken: plan.offerToken,
    productType: type === 'subscription' ? PURCHASE_TYPE.SUBS : PURCHASE_TYPE.INAPP,
    appAccountToken: user.id,
    autoAcknowledgePurchases: false,
    isConsumable: false,
  });
  if (isAndroid() && transaction.purchaseState !== '1')
    throw new Error('The store is still processing this purchase');
  const entry = { functionName, productId: plan.productId, type, verifyBody };
  remember(user.id, entry);
  const { data, error: verifyError } = await supabase.functions.invoke(functionName, {
    body: { ...verifyBody, platform: isIOS() ? 'apple' : 'google',
      product_id: plan.productId, transaction_id: transaction.transactionId,
      purchase_token: transaction.purchaseToken },
  });
  if (verifyError || (!data?.success && !data?.charged))
    throw new Error(data?.error || verifyError?.message || 'Store verification is pending. Restore this purchase later.');
  // Google is acknowledged or consumed by the server after entitlement commit.
  // StoreKit transactions must be finished on the device after server success.
  if (isIOS()) await NativePurchases.acknowledgePurchase({ purchaseToken: transaction.transactionId });
  forget(user.id, entry);
  return data as NativePurchaseResult;
}

export async function recoverPendingNativeSponsored(): Promise<number> {
  if (!isIOS() && !isAndroid()) return 0;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const entries = pending(user.id).filter(item => item.functionName === 'native-sponsored' && item.type === 'consumable');
  if (!entries.length) return 0;
  const { NativePurchases, PURCHASE_TYPE } = await import('@capgo/native-purchases');
  const { purchases } = await NativePurchases.getPurchases({
    productType: PURCHASE_TYPE.INAPP, appAccountToken: user.id,
  });
  let recovered = 0;
  for (const entry of entries) {
    const transaction = purchases.find(item => item.productIdentifier === entry.productId
      && (!isAndroid() || item.purchaseState === '1'));
    if (!transaction) continue;
    const { data, error } = await supabase.functions.invoke(entry.functionName, {
      body: { ...entry.verifyBody, platform: isIOS() ? 'apple' : 'google',
        product_id: entry.productId, transaction_id: transaction.transactionId,
        purchase_token: transaction.purchaseToken },
    });
    if (error || (!data?.success && !data?.charged))
      throw new Error(data?.error || error?.message || 'Paid store order needs support review');
    if (isIOS()) await NativePurchases.acknowledgePurchase({ purchaseToken: transaction.transactionId });
    forget(user.id, entry);
    recovered += 1;
  }
  return recovered;
}

export async function restoreNativeStoreSubscriptions(productIds: string[]): Promise<number> {
  if (!isIOS() && !isAndroid()) return 0;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in again before restoring');
  const { NativePurchases, PURCHASE_TYPE } = await import('@capgo/native-purchases');
  await NativePurchases.restorePurchases();
  const { purchases } = await NativePurchases.getPurchases({
    productType: PURCHASE_TYPE.SUBS, appAccountToken: user.id,
    onlyCurrentEntitlements: true,
  });
  let restored = 0;
  for (const transaction of purchases.filter(item => productIds.includes(item.productIdentifier))) {
    const { data, error } = await supabase.functions.invoke('native-worker-pro', {
      body: { platform: isIOS() ? 'apple' : 'google', product_id: transaction.productIdentifier,
        transaction_id: transaction.transactionId, purchase_token: transaction.purchaseToken },
    });
    if (error || !data?.success) throw new Error(data?.error || error?.message || 'Store restoration needs support review');
    if (isIOS()) await NativePurchases.acknowledgePurchase({ purchaseToken: transaction.transactionId });
    restored += 1;
  }
  return restored;
}

export type PropertyDraftFileBundle = {
  property: File[];
  rooms: Record<string, File[]>;
  accessVideo: File | null;
};

const DATABASE = 'wehouse-property-drafts';
const STORE = 'files';

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const key = (batchId: string, draftId: string) => `${batchId}:${draftId}`;

export async function loadPropertyDraftFiles(batchId: string, draftId: string): Promise<PropertyDraftFileBundle | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise<PropertyDraftFileBundle | null>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(key(batchId, draftId));
    request.onsuccess = () => resolve((request.result || null) as PropertyDraftFileBundle | null);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export async function savePropertyDraftFiles(batchId: string, draftId: string, bundle: PropertyDraftFileBundle): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(bundle, key(batchId, draftId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export async function removePropertyDraftFiles(batchId: string, draftId: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE, 'readwrite').objectStore(STORE).delete(key(batchId, draftId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export async function removePropertyDraftBatch(batchId: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(`${batchId}:`)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

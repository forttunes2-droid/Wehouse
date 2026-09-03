export type PropertyDraftFileBundle = {
  property: File[];
  rooms: Record<string, File[]>;
  accessVideo: File | null;
};

type StoredDraftFile = { blob: Blob; name: string; type: string; lastModified: number };
type StoredPropertyDraftFileBundle = {
  property: StoredDraftFile[];
  rooms: Record<string, StoredDraftFile[]>;
  accessVideo: StoredDraftFile | null;
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
    request.onsuccess = () => {
      const value = request.result as StoredPropertyDraftFileBundle | PropertyDraftFileBundle | null;
      if (!value) return resolve(null);
      resolve({
        property: (value.property || []).map(toFile).filter((file): file is File => Boolean(file)),
        rooms: Object.fromEntries(Object.entries(value.rooms || {}).map(([roomId, files]) => [roomId, (files as Array<StoredDraftFile | File | Blob>).map(toFile).filter((file): file is File => Boolean(file))])),
        accessVideo: value.accessVideo ? toFile(value.accessVideo) : null,
      });
    };
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export async function savePropertyDraftFiles(batchId: string, draftId: string, bundle: PropertyDraftFileBundle): Promise<void> {
  const database = await openDatabase();
  if (!database) throw new Error('Draft media storage is unavailable on this device');
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const stored: StoredPropertyDraftFileBundle = {
      property: bundle.property.map(toStoredFile),
      rooms: Object.fromEntries(Object.entries(bundle.rooms).map(([roomId, files]) => [roomId, files.map(toStoredFile)])),
      accessVideo: bundle.accessVideo ? toStoredFile(bundle.accessVideo) : null,
    };
    transaction.objectStore(STORE).put(stored, key(batchId, draftId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

function toStoredFile(file: File): StoredDraftFile {
  return { blob: file, name: file.name, type: file.type, lastModified: file.lastModified };
}

function toFile(value: StoredDraftFile | File | Blob): File | null {
  if (value instanceof File) return value;
  if (value instanceof Blob) return new File([value], 'draft-media', { type: value.type, lastModified: Date.now() });
  if (value && value.blob instanceof Blob) {
    return new File([value.blob], value.name || 'draft-media', {
      type: value.type || value.blob.type,
      lastModified: value.lastModified || Date.now(),
    });
  }
  return null;
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

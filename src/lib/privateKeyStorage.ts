export type StoredPrivateIdentity = {
  profileId: string;
  keyVersion: number;
  publicKey: JsonWebKey;
  deviceKey: CryptoKey;
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  confirmed?: boolean;
};

export interface PrivateKeyStorage {
  get(profileId: string, keyVersion: number, publicKey?: JsonWebKey): Promise<StoredPrivateIdentity | undefined>;
  add(record: StoredPrivateIdentity): Promise<boolean>;
  remove(profileId: string, keyVersion: number): Promise<void>;
  confirm(profileId:string,keyVersion:number,publicKey:JsonWebKey):Promise<void>;
}

const databaseName = 'wehouse-private-device-keys-v1';
const storeName = 'identities';

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('Allow site storage to use private chats on this device.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Private device storage took too long to open. Try again.')), 8000);
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(request.result);
    }
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, {keyPath: ['profileId', 'keyVersion', 'publicKey.x', 'publicKey.y']});
      store.createIndex('version', ['profileId', 'keyVersion']);
    };
    request.onerror = () => finish(new Error('Private chat keys could not be stored on this device. Check your browser’s site-storage settings.'));
    request.onblocked = () => finish(new Error('Close other WeHouse tabs and retry private chat storage.'));
    request.onsuccess = () => {if (finished) request.result.close(); else finish();};
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    let result: T;
    const timer = setTimeout(() => {try {tx.abort();} catch {/* Already completed. */}}, 8000);
    const finish = () => {clearTimeout(timer); database.close();};
    tx.oncomplete = () => {finish(); resolve(result);};
    tx.onerror = () => {finish(); reject(new Error('Private chat storage could not complete. Allow site storage and retry.'));};
    tx.onabort = () => {finish(); reject(new Error('Private chat storage was interrupted. Try again.'));};
    try {operation(tx.objectStore(storeName), value => {result = value;});}
    catch {try {tx.abort();} catch {/* Transaction already ended. */}}
  });
}

export const privateKeyStorage: PrivateKeyStorage = {
  get: (profileId, version, publicKey) => transaction('readonly', (store, result) => {
    const request = publicKey ? store.get([profileId, version, publicKey.x!, publicKey.y!]) : store.index('version').get([profileId, version]);
    request.onsuccess = () => result(request.result as StoredPrivateIdentity | undefined);
  }),
  add: record => transaction('readwrite', (store, result) => {
    // Read and insert in one transaction: two tabs cannot overwrite one another.
    const existing = store.get([record.profileId, record.keyVersion, record.publicKey.x!, record.publicKey.y!]);
    existing.onsuccess = () => {
      if (existing.result) return result(false);
      const added = store.add(record);
      added.onsuccess = () => result(true);
    };
  }),
  confirm:(profileId,version,publicKey)=>transaction('readwrite',(store,result)=>{
    const cursor=store.index('version').openCursor(IDBKeyRange.only([profileId,version]));
    cursor.onsuccess=()=>{const row=cursor.result;if(!row)return result(undefined);
      const key=(row.value as StoredPrivateIdentity).publicKey;
      if(key.x===publicKey.x&&key.y===publicKey.y)row.update({...row.value,confirmed:true});
      else row.delete(); // Discard only candidates rejected by the server receipt.
      row.continue();
    };
  }),
  remove: (profileId, version) => transaction('readwrite', (store, result) => {
    const cursor = store.index('version').openKeyCursor(IDBKeyRange.only([profileId, version]));
    cursor.onsuccess = () => {const row = cursor.result; if (row) {store.delete(row.primaryKey); row.continue();} else result(undefined);};
  }),
};

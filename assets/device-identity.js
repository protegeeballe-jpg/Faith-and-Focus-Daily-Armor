/** Stores and retrieves a persistent browser device identity. */

export const DEVICE_IDENTITY_VERSION = 1;

const DATABASE_NAME = 'faith_focus_device_identity_v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'deviceKeys';
const PRIMARY_RECORD_KEY = 'primary';
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('The saved device public key is not a valid byte sequence.');
}

function isP256SigningKey(key) {
  return Boolean(key
    && key.type === 'private'
    && key.extractable === false
    && key.algorithm?.name === 'ECDSA'
    && key.algorithm?.namedCurve === 'P-256'
    && Array.from(key.usages || []).includes('sign'));
}

function createIndexedDbAdapter(indexedDBRef) {
  if (!indexedDBRef || typeof indexedDBRef.open !== 'function') {
    throw new Error('This browser cannot securely remember a device key. Enable IndexedDB/site storage and try again; an in-memory key will not be used.');
  }

  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBRef.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('The device identity database could not be opened.'));
      };
      request.onblocked = () => {
        databasePromise = null;
        reject(new Error('The device identity database is busy in another tab. Close other Faith & Focus tabs and try again.'));
      };
    });

    return databasePromise;
  }

  return {
    async get(key) {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(key);
        let result;
        request.onsuccess = () => { result = request.result ?? null; };
        request.onerror = () => reject(request.error || new Error('The saved device key could not be read.'));
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('The device identity read failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('The device identity read was interrupted.'));
      });
    },

    async putIfAbsent(key, value) {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);
        let outcome = null;
        request.onsuccess = () => {
          if (request.result !== undefined) {
            outcome = { record: request.result, created: false };
            return;
          }
          const addRequest = store.add(value, key);
          addRequest.onsuccess = () => {
            // Verify the structured-cloned CryptoKey actually round-trips from
            // IndexedDB before allowing the caller to use it for enrollment.
            const confirmationRequest = store.get(key);
            confirmationRequest.onsuccess = () => {
              outcome = { record: confirmationRequest.result, created: true };
            };
            confirmationRequest.onerror = () => reject(
              confirmationRequest.error || new Error('The persisted device key could not be read back.')
            );
          };
          addRequest.onerror = () => reject(
            addRequest.error || new Error('The device key could not be added to persistent storage.')
          );
        };
        request.onerror = () => reject(request.error || new Error('The existing device identity could not be checked.'));
        transaction.oncomplete = () => resolve(outcome);
        transaction.onerror = () => reject(transaction.error || new Error('The device key could not be saved.'));
        transaction.onabort = () => reject(transaction.error || new Error('The device key save was interrupted.'));
      });
    }
  };
}

async function validateRecord(record, cryptoApi) {
  if (!record || typeof record !== 'object'
      || record.version !== DEVICE_IDENTITY_VERSION
      || !isP256SigningKey(record.privateKey)
      || !Number.isFinite(record.createdAt)
      || record.createdAt <= 0) {
    throw new Error('The saved device identity is incomplete or unsupported. Sign in again on this device to establish a new device identity.');
  }

  let spki;
  try {
    spki = asBytes(record.publicKeySpki);
  } catch {
    throw new Error('The saved device public key is damaged. Sign in again on this device to establish a new device identity.');
  }
  if (spki.byteLength < 64 || spki.byteLength > 256) {
    throw new Error('The saved device public key has an invalid size. Sign in again on this device to establish a new device identity.');
  }

  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', spki));
  const deviceId = toBase64Url(digest);
  if (record.deviceId !== deviceId) {
    throw new Error('The saved device identity fingerprint does not match its public key. Sign in again on this device to establish a new device identity.');
  }

  let publicKey;
  try {
    publicKey = await cryptoApi.subtle.importKey(
      'spki', spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  } catch {
    throw new Error('The saved device public key cannot be opened. Sign in again on this device to establish a new device identity.');
  }

  // Check that the stored private key matches the saved public key.
  const selfTest = cryptoApi.getRandomValues(new Uint8Array(32));
  const signature = await cryptoApi.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    record.privateKey,
    selfTest
  );
  const matches = await cryptoApi.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    selfTest
  );
  selfTest.fill(0);
  if (!matches) {
    throw new Error('The saved device signing key does not match its public key. Sign in again on this device to establish a new device identity.');
  }

  return {
    version: DEVICE_IDENTITY_VERSION,
    deviceId,
    publicKeySpki: toBase64Url(spki),
    privateKey: record.privateKey,
    createdAt: record.createdAt
  };
}

/**
 * Returns the persisted device identity without creating one.
 * A missing record returns null so callers can distinguish a new device.
 */
export async function getStoredDeviceIdentity({
  cryptoApi = globalThis.crypto,
  indexedDBRef = globalThis.indexedDB,
  storageAdapter = null
} = {}) {
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Secure browser cryptography is unavailable. Open Faith & Focus in a modern HTTPS browser.');
  }
  const storage = storageAdapter || createIndexedDbAdapter(indexedDBRef);
  const record = await storage.get(PRIMARY_RECORD_KEY);
  if (record === null || record === undefined) return null;
  return validateRecord(record, cryptoApi);
}

/**
 * Returns an existing identity or atomically persists a new non-exportable
 * P-256 private key. The created flag is true only for the tab that won the
 * IndexedDB put-if-absent transaction. No ephemeral fallback is permitted.
 */
export async function getOrCreateDeviceIdentity({
  cryptoApi = globalThis.crypto,
  indexedDBRef = globalThis.indexedDB,
  storageAdapter = null
} = {}) {
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Secure browser cryptography is unavailable. Open Faith & Focus in a modern HTTPS browser.');
  }
  const storage = storageAdapter || createIndexedDbAdapter(indexedDBRef);
  const existing = await storage.get(PRIMARY_RECORD_KEY);
  if (existing !== null && existing !== undefined) {
    return { identity: await validateRecord(existing, cryptoApi), created: false };
  }

  let keyPair;
  try {
    keyPair = await cryptoApi.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );
  } catch {
    throw new Error('This browser could not create a persistent device signing key. Update the browser or enable secure site storage.');
  }
  if (!isP256SigningKey(keyPair.privateKey)) {
    throw new Error('The browser did not create a non-exportable device private key. Device enrollment was stopped.');
  }

  const spki = new Uint8Array(await cryptoApi.subtle.exportKey('spki', keyPair.publicKey));
  const fingerprint = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', spki));
  const candidate = {
    version: DEVICE_IDENTITY_VERSION,
    deviceId: toBase64Url(fingerprint),
    publicKeySpki: spki,
    privateKey: keyPair.privateKey,
    createdAt: Date.now()
  };

  let outcome;
  try {
    outcome = await storage.putIfAbsent(PRIMARY_RECORD_KEY, candidate);
  } catch (error) {
    if (error?.name === 'QuotaExceededError') {
      throw new Error('There is not enough browser storage to save this device key. Free site storage and try again; no temporary key was used.');
    }
    throw error;
  }
  if (!outcome?.record) {
    throw new Error('The device key could not be confirmed as saved. No network synchronization was started.');
  }

  return {
    identity: await validateRecord(outcome.record, cryptoApi),
    created: outcome.created === true
  };
}

/** Sign a message with the persisted device key. */
export async function signDeviceMessage(identity, message, cryptoApi = globalThis.crypto) {
  if (!identity || !isP256SigningKey(identity.privateKey)) {
    throw new TypeError('A valid persisted device identity is required before signing.');
  }
  if (typeof message !== 'string' || message.length < 1 || encoder.encode(message).byteLength > 4096) {
    throw new TypeError('The device challenge message is invalid or too large.');
  }
  const signature = new Uint8Array(await cryptoApi.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    encoder.encode(message)
  ));
  return toBase64Url(signature);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  DEVICE_IDENTITY_VERSION,
  getStoredDeviceIdentity,
  getOrCreateDeviceIdentity,
  signDeviceMessage
} from '../assets/device-identity.js';

function createMemoryAdapter(initial = null) {
  let record = initial;
  let writes = 0;
  return {
    async get(key) {
      assert.equal(key, 'primary');
      return record;
    },
    async putIfAbsent(key, value) {
      assert.equal(key, 'primary');
      if (record !== null) return { record, created: false };
      record = value;
      writes += 1;
      return { record, created: true };
    },
    get writes() { return writes; }
  };
}

test('a missing key is reported without silently creating an identity', async () => {
  const storageAdapter = createMemoryAdapter();
  assert.equal(await getStoredDeviceIdentity({ cryptoApi: webcrypto, storageAdapter }), null);
  assert.equal(storageAdapter.writes, 0);
});

test('creates a persisted P-256 identity with a non-exportable private key', async () => {
  const storageAdapter = createMemoryAdapter();
  const first = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter });

  assert.equal(first.created, true);
  assert.equal(first.identity.version, DEVICE_IDENTITY_VERSION);
  assert.match(first.identity.deviceId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.identity.privateKey.type, 'private');
  assert.equal(first.identity.privateKey.extractable, false);
  assert.equal(first.identity.privateKey.algorithm.name, 'ECDSA');
  assert.equal(first.identity.privateKey.algorithm.namedCurve, 'P-256');
  assert.deepEqual(first.identity.privateKey.usages, ['sign']);
  await assert.rejects(
    webcrypto.subtle.exportKey('pkcs8', first.identity.privateKey),
    /not extractable|OperationError/i
  );

  const second = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter });
  assert.equal(second.created, false);
  assert.equal(second.identity.deviceId, first.identity.deviceId);
  assert.equal(second.identity.createdAt, first.identity.createdAt);
  assert.equal(storageAdapter.writes, 1);
});

test('the persisted private key signs a challenge verifiable by the corresponding public key', async () => {
  const storageAdapter = createMemoryAdapter();
  const { identity } = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter });
  const challenge = 'FaithFocus|device-handshake|v1|vault-example|challenge-example';
  const signature = await signDeviceMessage(identity, challenge, webcrypto);
  const binary = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/') + '=', 'base64');
  const spki = Buffer.from(identity.publicKeySpki.replace(/-/g, '+').replace(/_/g, '/') + '=', 'base64');
  const publicKey = await webcrypto.subtle.importKey(
    'spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  );
  assert.equal(await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, binary, new TextEncoder().encode(challenge)
  ), true);
});

test('new storage creates a different device identity after IndexedDB data loss', async () => {
  const originalStore = createMemoryAdapter();
  const clearedStore = createMemoryAdapter();
  const original = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter: originalStore });
  const replacement = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter: clearedStore });

  assert.equal(original.created, true);
  assert.equal(replacement.created, true);
  assert.notEqual(replacement.identity.deviceId, original.identity.deviceId);
  assert.equal(await getStoredDeviceIdentity({ cryptoApi: webcrypto, storageAdapter: clearedStore }).then(Boolean), true);
});

test('corrupt stored identity fails closed and is not overwritten by a new key', async () => {
  const storageAdapter = createMemoryAdapter({ version: 99, deviceId: 'bad', privateKey: null });
  await assert.rejects(
    getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter }),
    /incomplete or unsupported/
  );
  assert.equal(storageAdapter.writes, 0);
});

test('rejects unavailable IndexedDB rather than using an ephemeral in-memory key', async () => {
  await assert.rejects(
    getOrCreateDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef: undefined }),
    /cannot securely remember a device key/
  );
});

test('challenge signing rejects missing identities and oversized messages', async () => {
  await assert.rejects(signDeviceMessage(null, 'challenge', webcrypto), /persisted device identity/);
  const storageAdapter = createMemoryAdapter();
  const { identity } = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, storageAdapter });
  await assert.rejects(signDeviceMessage(identity, '', webcrypto), /challenge message/);
  await assert.rejects(signDeviceMessage(identity, 'x'.repeat(4097), webcrypto), /challenge message/);
});

class FakeTransaction {
  constructor(storeMap) {
    this.storeMap = storeMap;
    this.pending = 0;
    this.completionScheduled = false;
    this.completed = false;
  }

  objectStore() {
    return {
      get: key => this.runRequest(() => this.storeMap.get(key)),
      add: (value, key) => this.runRequest(() => {
        if (this.storeMap.has(key)) throw new Error('ConstraintError');
        this.storeMap.set(key, structuredClone(value));
        return key;
      })
    };
  }

  runRequest(operation) {
    const request = {};
    this.pending += 1;
    queueMicrotask(() => {
      try {
        request.result = operation();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
        this.error = error;
        this.onerror?.();
      } finally {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
    return request;
  }

  scheduleCompletion() {
    if (this.completionScheduled || this.completed) return;
    this.completionScheduled = true;
    queueMicrotask(() => {
      this.completionScheduled = false;
      if (this.pending !== 0 || this.completed) return;
      this.completed = true;
      this.oncomplete?.();
    });
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: name => this.stores.has(name) };
  }

  createObjectStore(name) {
    this.stores.set(name, new Map());
    return {};
  }

  transaction(name) {
    const storeMap = this.stores.get(name);
    if (!storeMap) throw new Error('Object store does not exist.');
    return new FakeTransaction(storeMap);
  }

  close() {}
}

class FakeIndexedDB {
  database = null;

  open() {
    const request = {};
    queueMicrotask(() => {
      const isNew = !this.database;
      if (isNew) this.database = new FakeDatabase();
      request.result = this.database;
      if (isNew) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }

  clearSiteDataForTest() {
    this.database = null;
  }
}

test('the actual IndexedDB adapter persists a CryptoKey across module-store instances', async () => {
  const indexedDBRef = new FakeIndexedDB();
  const missing = await getStoredDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef });
  assert.equal(missing, null);

  const first = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef });
  const second = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.identity.deviceId, first.identity.deviceId);
  assert.equal(second.identity.privateKey.extractable, false);
});

test('the actual IndexedDB adapter detects cleared site data and creates a new identity only after caller requests it', async () => {
  const indexedDBRef = new FakeIndexedDB();
  const original = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef });
  indexedDBRef.clearSiteDataForTest();

  assert.equal(await getStoredDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef }), null);
  const replacement = await getOrCreateDeviceIdentity({ cryptoApi: webcrypto, indexedDBRef });
  assert.equal(replacement.created, true);
  assert.notEqual(replacement.identity.deviceId, original.identity.deviceId);
});

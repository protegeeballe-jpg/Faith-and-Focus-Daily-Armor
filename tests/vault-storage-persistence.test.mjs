import test from 'node:test';
import assert from 'node:assert/strict';

class FakeTransaction {
  constructor(database, storeName) {
    this.store = database.stores.get(storeName);
    this.pending = 0;
    this.completed = false;
    this.aborted = false;
  }

  queue(action) {
    const request = { result: undefined, error: null };
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) return;
      try {
        request.result = action();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
        this.error = error;
        this.abort();
      } finally {
        this.pending -= 1;
        this.completeWhenIdle();
      }
    });
    return request;
  }

  write(action) {
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) return;
      try {
        action();
      } catch (error) {
        this.error = error;
        this.onerror?.();
        this.abort();
      } finally {
        this.pending -= 1;
        this.completeWhenIdle();
      }
    });
  }

  completeWhenIdle() {
    queueMicrotask(() => {
      if (!this.aborted && !this.completed && this.pending === 0) {
        this.completed = true;
        this.oncomplete?.();
      }
    });
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }

  objectStore() {
    const transaction = this;
    return {
      get(key) {
        return transaction.queue(() => {
          const value = transaction.store.get(key);
          return value === undefined ? undefined : structuredClone(value);
        });
      },
      getAll() {
        return transaction.queue(() =>
          [...transaction.store.values()].map(value => structuredClone(value))
        );
      },
      put(value) {
        transaction.write(() => transaction.store.set(value.dateString, structuredClone(value)));
      },
      clear() {
        transaction.write(() => transaction.store.clear());
      }
    };
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    const storeNames = new Set();
    this.objectStoreNames = { contains: name => storeNames.has(name) };
    this.createObjectStore = (name) => {
      storeNames.add(name);
      this.stores.set(name, new Map());
      return { createIndex() {} };
    };
  }

  transaction(storeName) {
    return new FakeTransaction(this, storeName);
  }
}

class FakeIndexedDB {
  constructor() {
    this.databases = new Map();
  }

  open(name) {
    const request = {};
    queueMicrotask(() => {
      let database = this.databases.get(name);
      if (!database) {
        database = new FakeDatabase();
        this.databases.set(name, database);
        request.result = database;
        request.onupgradeneeded?.();
      } else {
        request.result = database;
      }
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }
}

test('failed cloud authorization and stale upload confirmation preserve the local encrypted packet', async () => {
  globalThis.indexedDB = new FakeIndexedDB();
  const {
    getLocalDailyPacket,
    putLocalDailyPacket,
    markLocalDailyPacketSynced
  } = await import('../assets/vault-storage.js');

  const dateString = '2026-11-15';
  const originalPacket = {
    format: 'faith-focus-encrypted-daily-packet',
    version: 1,
    dateString,
    algorithm: 'AES-256-GCM',
    compression: 'none',
    iv: 'original-iv',
    ciphertext: 'original-ciphertext'
  };

  await putLocalDailyPacket({
    dateString,
    packet: originalPacket,
    localUpdatedAt: Date.now(),
    remoteUpdatedAt: null,
    dirty: true
  });

  const expiredSession = Object.assign(new Error('Device session expired.'), { status: 401 });
  await assert.rejects(
    async () => {
      const response = await Promise.reject(expiredSession);
      await markLocalDailyPacketSynced(dateString, 'remote-version', originalPacket, {
        requirePacketMatch: true,
        expectedPacket: originalPacket
      });
      return response;
    },
    error => error.status === 401
  );

  let local = await getLocalDailyPacket(dateString);
  assert.deepEqual(local.packet, originalPacket);
  assert.equal(local.dirty, true);

  const newerLocalPacket = { ...originalPacket, ciphertext: 'newer-local-ciphertext' };
  await putLocalDailyPacket({
    dateString,
    packet: newerLocalPacket,
    localUpdatedAt: Date.now() + 1,
    remoteUpdatedAt: null,
    dirty: true
  });

  const staleUpload = await markLocalDailyPacketSynced(
    dateString,
    'remote-version',
    originalPacket,
    { requirePacketMatch: true, expectedPacket: originalPacket }
  );
  assert.equal(staleUpload.stillMatchesUploadedSnapshot, false);

  local = await getLocalDailyPacket(dateString);
  assert.deepEqual(local.packet, newerLocalPacket);
  assert.equal(local.dirty, true);
  assert.equal(local.remoteUpdatedAt, 'remote-version');
});

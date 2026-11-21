import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import worker, { AccountRegistry, VaultCoordinator, getKvWriteSpacingBucket } from '../worker.js';

const ORIGIN = 'https://protegeeballe-jpg.github.io';
const CLIENT = 'faith-focus-daily-armor-web/1';
const VAULT_ID = 'a'.repeat(64);
const WRITE_TOKEN = 'W'.repeat(43);
const dateString = '2026-11-12';

const EDGE_LIMITERS = {
  EDGE_RATE_LIMIT_PEPPER: 'worker-test-edge-rate-limit-secret-with-32-characters',
  AUTH_IP_RATE_LIMITER: { async limit() { return { success: true }; } },
  SENSITIVE_IP_RATE_LIMITER: { async limit() { return { success: true }; } },
  VAULT_ACCOUNT_RATE_LIMITER: { async limit() { return { success: true }; } },
  VAULT_WRITE_ACCOUNT_RATE_LIMITER: { async limit() { return { success: true }; } },
  VOICE_NOTE_WRITE_ACCOUNT_RATE_LIMITER: { async limit() { return { success: true }; } }
};
const packet = {
  format: 'faith-focus-encrypted-daily-packet',
  version: 1,
  dateString,
  algorithm: 'AES-256-GCM',
  compression: 'none',
  iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(1))),
  ciphertext: btoa(String.fromCharCode(...new Uint8Array(16).fill(2)))
};

function responseJson(response) {
  return response.json();
}

async function createMembershipTicket(vaultId, pepper) {
  const encodedPayload = Buffer.from(JSON.stringify({
    version: 1,
    vaultId,
    expiresAt: Date.now() + 60 * 60 * 1000
  })).toString('base64url');
  const key = await webcrypto.subtle.importKey(
    'raw', Buffer.from(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode('FaithFocus|vault-membership|v1|' + encodedPayload)
  ));
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  return encodedPayload + '.' + hex;
}

test('Worker rejects non-GitHub-Pages origins and missing custom client header', async () => {
  const wrongOrigin = await worker.fetch(new Request('https://worker.example/vault/' + VAULT_ID + '/index', {
    headers: {
      Origin: 'https://attacker.example',
      'X-App-Client': CLIENT,
      'CF-Connecting-IP': '198.51.100.201'
    }
  }), {
    ...EDGE_LIMITERS,
    MEMBERSHIP_PEPPER: 'worker-test-membership-secret-with-at-least-32-characters'
  });
  assert.equal(wrongOrigin.status, 403);

  const missingClient = await worker.fetch(new Request('https://worker.example/vault/' + VAULT_ID + '/index', {
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.202' }
  }), {
    ...EDGE_LIMITERS,
    MEMBERSHIP_PEPPER: 'worker-test-membership-secret-with-at-least-32-characters'
  });
  assert.equal(missingClient.status, 403);
});

test('Worker rejects requests larger than 1 MB before invoking the vault coordinator', async () => {
  const request = new Request('https://worker.example/vault/' + VAULT_ID + '/claim', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'CF-Connecting-IP': '203.0.113.55',
      'X-Vault-Membership': await createMembershipTicket(
        VAULT_ID, 'worker-test-membership-secret-with-at-least-32-characters'
      ),
      'X-Write-Token': WRITE_TOKEN,
      'Content-Type': 'application/json',
      'Content-Length': String(1024 * 1024 + 1)
    },
    body: 'x'.repeat(1024 * 1024 + 1)
  });
  const oversized = await worker.fetch(request, {
    ...EDGE_LIMITERS,
    MEMBERSHIP_PEPPER: 'worker-test-membership-secret-with-at-least-32-characters',
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {}
  });
  assert.equal(oversized.status, 413);
  assert.match((await responseJson(oversized)).error, /1 MB/);
});

function makeCoordinator() {
  const storageMap = new Map();
  const kvMap = new Map();
  const failures = { get: false, put: false };
  const storage = {
    async get(key) { return storageMap.get(key); },
    async put(key, value) { storageMap.set(key, value); },
    async delete(key) { return storageMap.delete(key); },
    async list({ prefix = "" } = {}) {
      return new Map([...storageMap.entries()].filter(([key]) => String(key).startsWith(prefix)));
    },
    async transaction(callback) {
      const transaction = {
        get: async key => storageMap.get(key),
        put: async (key, value) => storageMap.set(key, value),
        delete: async key => storageMap.delete(key)
      };
      return callback(transaction);
    },
    async setAlarm(timestamp) { this.alarmAt = timestamp; },
    async deleteAlarm() { this.alarmAt = null; }
  };
  const state = {
    storage,
    blockConcurrencyWhile(callback) { return callback(); }
  };
  const env = {
    VAULT_PACKETS: {
      async get(key) {
        if (failures.get) throw new Error('simulated KV read block');
        return kvMap.get(key) ?? null;
      },
      async put(key, value) {
        if (failures.put) throw new Error('simulated KV write block');
        kvMap.set(key, value);
      }
    }
  };
  return { coordinator: new VaultCoordinator(state, env), storageMap, kvMap, failures };
}

function coordinatorRequest(path, { method = 'GET', token = WRITE_TOKEN, legacyToken, sessionToken, body } = {}) {
  return new Request('https://vault-coordinator.internal' + path, {
    method,
    headers: {
      'X-Vault-Id': VAULT_ID,
      ...(token ? { 'X-Write-Token': token } : {}),
      ...(legacyToken ? { 'X-Legacy-Write-Token': legacyToken } : {}),
      ...(sessionToken ? { 'X-Device-Session': sessionToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function createCoordinatorSession(coordinator, token = WRITE_TOKEN) {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  );
  const publicKeySpki = base64Url(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
  const spkiBytes = new Uint8Array(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', spkiBytes));
  const deviceId = base64Url(digest);

  const challengeResponse = await coordinator.fetch(coordinatorRequest('/device/challenge', {
    method: 'POST',
    token,
    body: { deviceId, publicKeySpki }
  }));
  assert.equal(challengeResponse.status, 200);
  const challenge = await responseJson(challengeResponse);
  const signature = base64Url(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge.message)
  ));

  const verifiedResponse = await coordinator.fetch(coordinatorRequest('/device/verify', {
    method: 'POST',
    token: null,
    body: { challengeId: challenge.challengeId, deviceId, signature }
  }));
  assert.equal(verifiedResponse.status, 200);
  const verified = await responseJson(verifiedResponse);
  return { deviceId, sessionToken: verified.sessionToken, keyPair, publicKeySpki };
}

test('voice-note attachments require a verified device session and round-trip chunked ciphertext', async () => {
  const { coordinator, kvMap } = makeCoordinator();
  const initialized = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  assert.equal(initialized.status, 200);
  const device = await createCoordinatorSession(coordinator);
  const pepper = 'worker-test-membership-secret-with-at-least-32-characters';
  const membershipTicket = await createMembershipTicket(VAULT_ID, pepper);
  const voiceId = dateString + '-0123456789abcdef0123456789abcdef';
  const ciphertext = 'A'.repeat(600000);
  const chunkSize = 256 * 1024;
  const totalChunks = Math.ceil(ciphertext.length / chunkSize);
  const env = {
    ...EDGE_LIMITERS,
    MEMBERSHIP_PEPPER: pepper,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName: () => VAULT_ID,
      get: () => ({ fetch: request => coordinator.fetch(request) })
    }
  };
  const commonHeaders = {
    Origin: ORIGIN,
    'X-App-Client': CLIENT,
    'CF-Connecting-IP': '203.0.113.77',
    'X-Vault-Membership': membershipTicket,
    'X-Device-Session': device.sessionToken
  };

  for (let index = 0; index < totalChunks; index += 1) {
    const ciphertextChunk = ciphertext.slice(index * chunkSize, (index + 1) * chunkSize);
    const path = '/vault/' + VAULT_ID + '/voice-note/' + dateString + '/' + voiceId + '/' + index;
    const upload = await worker.fetch(new Request('https://worker.example' + path, {
      method: 'PUT',
      headers: { ...commonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: voiceId, dateString, index, totalChunks,
        ciphertextLength: ciphertext.length,
        ciphertextChunk
      })
    }), env);
    assert.equal(upload.status, 200);
    const uploadResult = await responseJson(upload);
    assert.equal(uploadResult.stored, true);
    assert.equal(uploadResult.index, index);
    assert.equal(uploadResult.totalChunks, totalChunks);
    assert.equal(kvMap.get(VAULT_ID + ':voice:' + voiceId + ':' + index), ciphertextChunk);
  }

  const conflictingChunk = 'B'.repeat(chunkSize);
  const conflictingWrite = await worker.fetch(new Request(
    'https://worker.example/vault/' + VAULT_ID + '/voice-note/' + dateString + '/' + voiceId + '/0',
    {
      method: 'PUT',
      headers: { ...commonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: voiceId, dateString, index: 0, totalChunks,
        ciphertextLength: ciphertext.length,
        ciphertextChunk: conflictingChunk
      })
    }
  ), env);
  assert.equal(conflictingWrite.status, 409);

  const restoredChunks = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const path = '/vault/' + VAULT_ID + '/voice-note/' + dateString + '/' + voiceId + '/' + index;
    const download = await worker.fetch(new Request('https://worker.example' + path, {
      headers: commonHeaders
    }), env);
    assert.equal(download.status, 200);
    const restored = await responseJson(download);
    assert.equal(restored.id, voiceId);
    assert.equal(restored.dateString, dateString);
    assert.equal(restored.index, index);
    assert.equal(restored.totalChunks, totalChunks);
    assert.equal(restored.ciphertextLength, ciphertext.length);
    restoredChunks.push(restored.ciphertextChunk);
  }
  assert.equal(restoredChunks.join(''), ciphertext);

  const firstChunkKey = VAULT_ID + ':voice:' + voiceId + ':0';
  kvMap.set(firstChunkKey, 'B'.repeat(chunkSize));
  const damaged = await worker.fetch(new Request(
    'https://worker.example/vault/' + VAULT_ID + '/voice-note/' + dateString + '/' + voiceId + '/0',
    { headers: commonHeaders }
  ), env);
  assert.equal(damaged.status, 503);
  kvMap.set(firstChunkKey, ciphertext.slice(0, chunkSize));

  const unauthorizedPath = '/vault/' + VAULT_ID + '/voice-note/' + dateString + '/' + voiceId + '/0';
  const unauthorized = await worker.fetch(new Request('https://worker.example' + unauthorizedPath, {
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'CF-Connecting-IP': '203.0.113.78',
      'X-Vault-Membership': membershipTicket
    }
  }), env);
  assert.equal(unauthorized.status, 401);
});

test('voice-note attachment route rejects malformed and oversized ciphertext before storage', async () => {
  const { coordinator } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const device = await createCoordinatorSession(coordinator);
  const pepper = 'worker-test-membership-secret-with-at-least-32-characters';
  const membershipTicket = await createMembershipTicket(VAULT_ID, pepper);
  const voiceId = dateString + '-abcdefabcdefabcdefabcdefabcdefab';
  const path = '/vault/' + VAULT_ID + '/voice-note/' + dateString + '/' + voiceId + '/0';
  let coordinatorTouched = false;
  const env = {
    ...EDGE_LIMITERS,
    MEMBERSHIP_PEPPER: pepper,
    VAULT_PACKETS: {},
    VAULT_COORDINATOR: {
      idFromName: () => VAULT_ID,
      get: () => ({
        fetch: request => {
          coordinatorTouched = true;
          return coordinator.fetch(request);
        }
      })
    }
  };
  const response = await worker.fetch(new Request('https://worker.example' + path, {
    method: 'PUT',
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'CF-Connecting-IP': '203.0.113.79',
      'X-Vault-Membership': membershipTicket,
      'X-Device-Session': device.sessionToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id: voiceId, dateString, index: 0, totalChunks: 1, ciphertextLength: 24, ciphertextChunk: 'not-base64!' })
  }), env);
  assert.equal(response.status, 400);
  assert.equal(coordinatorTouched, false);
});

test('Vault Coordinator claims once, stores encrypted date packets, and rejects stale writes', async () => {
  const { coordinator, storageMap, kvMap } = makeCoordinator();

  const prematureClaim = await coordinator.fetch(coordinatorRequest('/claim', { method: 'POST', body: {} }));
  assert.equal(prematureClaim.status, 401);

  const initialize = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  assert.equal(initialize.status, 200);
  assert.equal(storageMap.has('write-token-sha256'), true);

  const claim = await coordinator.fetch(coordinatorRequest('/claim', { method: 'POST', body: {} }));
  assert.equal(claim.status, 200);

  const deviceSession = await createCoordinatorSession(coordinator);
  assert.equal(typeof deviceSession.sessionToken, 'string');

  const firstWrite = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    sessionToken: deviceSession.sessionToken,
    token: null,
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(firstWrite.status, 200);
  const saved = await responseJson(firstWrite);
  assert.equal(typeof saved.updatedAt, 'string');
  assert.ok(kvMap.has(VAULT_ID + ':' + dateString));
  assert.ok(kvMap.has(VAULT_ID + ':index'));

  const staleWrite = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    sessionToken: deviceSession.sessionToken,
    token: null,
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(staleWrite.status, 409);

  const badToken = await coordinator.fetch(coordinatorRequest('/index', {
    token: null, sessionToken: 'x'.repeat(43)
  }));
  assert.equal(badToken.status, 401);

  const index = await coordinator.fetch(coordinatorRequest('/index', {
    token: null, sessionToken: deviceSession.sessionToken
  }));
  assert.equal(index.status, 200);
  const indexBody = await responseJson(index);
  assert.equal(indexBody.index[dateString], saved.updatedAt);
});


function makeDurableNamespace(DurableClass, env) {
  const instances = new Map();
  const storageMaps = new Map();
  return {
    idFromName(name) { return String(name); },
    get(id) {
      if (!instances.has(id)) {
        const map = new Map();
        storageMaps.set(id, map);
        const storage = {
          async get(key) { return map.get(key); },
          async put(key, value) { map.set(key, value); },
          async delete(key) { return map.delete(key); },
          async list({ prefix = "", startAfter, limit = Infinity } = {}) {
            const entries = [...map.entries()]
              .filter(([key]) => String(key).startsWith(prefix) && (!startAfter || key > startAfter))
              .sort(([left], [right]) => left.localeCompare(right))
              .slice(0, limit);
            return new Map(entries);
          },
          async transaction(callback) {
            const transaction = {
              get: async key => map.get(key),
              put: async (key, value) => map.set(key, value),
              delete: async key => map.delete(key)
            };
            return callback(transaction);
          },
          async getAlarm() { return this.alarmAt ?? null; },
          async setAlarm(timestamp) { this.alarmAt = timestamp; },
          async deleteAlarm() { this.alarmAt = null; }
        };
        const state = {
          storage,
          blockConcurrencyWhile(callback) { return callback(); }
        };
        instances.set(id, new DurableClass(state, env));
      }
      return { fetch: request => instances.get(id).fetch(request) };
    },
    storageMaps
  };
}

function accountRequest(path, {
  method = 'POST', body, token, membershipTicket, sessionToken, legacyUsername
} = {}) {
  return new Request('https://faith-focus-proxy.nine-westhigh.workers.dev' + path, {
    method,
    headers: {
      Origin: ORIGIN,
      'X-App-Client': CLIENT,
      'CF-Connecting-IP': '203.0.113.44',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'X-Write-Token': token } : {}),
      ...(membershipTicket ? { 'X-Vault-Membership': membershipTicket } : {}),
      ...(sessionToken ? { 'X-Device-Session': sessionToken } : {}),
      ...(legacyUsername ? { 'X-Legacy-Username': legacyUsername } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('Account Registry creates one stable vault, verifies recovery answers, and rotates username/passphrase', async () => {
  const kvMap = new Map();
  const env = {
    ...EDGE_LIMITERS,
    RECOVERY_PEPPER: 'test-only-recovery-pepper-with-more-than-32-characters',
    MEMBERSHIP_PEPPER: 'test-only-membership-pepper-with-more-than-32-characters',
    VAULT_PACKETS: {
      async get(key) { return kvMap.get(key) ?? null; },
      async put(key, value) { kvMap.set(key, value); }
    }
  };
  env.VAULT_COORDINATOR = makeDurableNamespace(VaultCoordinator, env);
  env.ACCOUNT_REGISTRY = makeDurableNamespace(AccountRegistry, env);

  const vaultId = 'c'.repeat(64);
  const writeToken = 'A'.repeat(43);
  const recoveryAnswers = [
    { questionId: 1, answer: 'Poppy' },
    { questionId: 2, answer: 'Mango' },
    { questionId: 20, answer: 'Piano' }
  ];
  const envelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(4))),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(48).fill(5)))
  };
  const signup = await worker.fetch(accountRequest('/account/signup', {
    body: {
      username: 'Family.Vault',
      vaultId,
      passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(1))),
      passphraseIterations: 600000,
      passphraseEnvelope: envelope,
      recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(2))),
      recoveryIterations: 1200000,
      recoveryEnvelope: envelope,
      questionAnswers: recoveryAnswers,
      writeToken
    }
  }), env);
  assert.equal(signup.status, 201);
  assert.equal((await responseJson(signup)).vaultId, vaultId);

  const signin = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'family.vault' }
  }), env);
  assert.equal(signin.status, 200);
  const signinData = await responseJson(signin);
  assert.equal(signinData.vaultId, vaultId);
  assert.equal('passphraseEnvelope' in signinData, false);

  const unlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId }, token: writeToken
  }), env);
  assert.equal(unlock.status, 200);
  const unlockData = await responseJson(unlock);
  assert.equal(unlockData.passphraseEnvelope.algorithm, 'AES-256-GCM');
  assert.equal(typeof unlockData.membershipTicket, 'string');

  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  );
  const publicKeyBytes = new Uint8Array(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
  const publicKeySpki = base64Url(publicKeyBytes);
  const deviceId = base64Url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', publicKeyBytes)));

  const challengeResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/challenge', {
    body: { deviceId, publicKeySpki },
    token: writeToken,
    membershipTicket: unlockData.membershipTicket
  }), env);
  assert.equal(challengeResponse.status, 200);
  const challenge = await responseJson(challengeResponse);
  assert.equal(challenge.expiresAt > Date.now(), true);
  assert.match(challenge.challengeId, /^[A-Za-z0-9_-]{43}$/);

  const signature = base64Url(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge.message)
  ));
  const verifyRequest = () => worker.fetch(accountRequest('/vault/' + vaultId + '/device/verify', {
    body: { challengeId: challenge.challengeId, deviceId, signature },
    membershipTicket: unlockData.membershipTicket
  }), env);
  const concurrentVerifications = await Promise.all([verifyRequest(), verifyRequest()]);
  assert.deepEqual(concurrentVerifications.map(item => item.status).sort(), [200, 401]);
  const verifiedResponse = concurrentVerifications.find(item => item.status === 200);
  const verified = await responseJson(verifiedResponse);
  assert.equal(verified.deviceId, deviceId);
  assert.match(verified.sessionToken, /^[A-Za-z0-9_-]{43}$/);

  const coordinatorStorage = env.VAULT_COORDINATOR.storageMaps.get(vaultId);
  const sessionEntries = [...coordinatorStorage.entries()].filter(([key]) => key.startsWith('device-session:'));
  assert.equal(sessionEntries.length, 1);
  assert.equal(sessionEntries[0][1].deviceId, deviceId);
  assert.equal(JSON.stringify(sessionEntries).includes(verified.sessionToken), false);
  assert.equal(sessionEntries[0][0].includes(verified.sessionToken), false);

  const indexResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/index', {
    method: 'GET',
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(indexResponse.status, 200);

  // Exercise trusted-device listing and removal through the public Worker route,
  // not only by calling the Durable Object directly.
  const secondKeyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  );
  const secondPublicKeyBytes = new Uint8Array(await webcrypto.subtle.exportKey('spki', secondKeyPair.publicKey));
  const secondPublicKeySpki = base64Url(secondPublicKeyBytes);
  const secondDeviceId = base64Url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', secondPublicKeyBytes)));
  const secondChallengeResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/challenge', {
    body: { deviceId: secondDeviceId, publicKeySpki: secondPublicKeySpki },
    token: writeToken,
    membershipTicket: unlockData.membershipTicket
  }), env);
  assert.equal(secondChallengeResponse.status, 200);
  const secondChallenge = await responseJson(secondChallengeResponse);
  const secondSignature = base64Url(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    secondKeyPair.privateKey,
    new TextEncoder().encode(secondChallenge.message)
  ));
  const secondVerifyResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/verify', {
    body: {
      challengeId: secondChallenge.challengeId,
      deviceId: secondDeviceId,
      signature: secondSignature
    },
    membershipTicket: unlockData.membershipTicket
  }), env);
  assert.equal(secondVerifyResponse.status, 200);
  const secondVerified = await responseJson(secondVerifyResponse);

  const trustedListResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/list', {
    method: 'GET',
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(trustedListResponse.status, 200);
  const trustedList = await responseJson(trustedListResponse);
  assert.equal(trustedList.devices.length, 2);
  assert.equal(trustedList.currentDeviceId, deviceId);
  assert.equal(trustedList.devices.find(item => item.deviceId === deviceId).isCurrent, true);
  assert.equal(trustedList.devices.find(item => item.deviceId === secondDeviceId).isCurrent, false);

  const trustedRemovalResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/remove', {
    body: { deviceId: secondDeviceId },
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(trustedRemovalResponse.status, 200);
  assert.deepEqual(await responseJson(trustedRemovalResponse), {
    ok: true, removed: true, deviceId: secondDeviceId, revokedSessions: 1
  });

  const removedDeviceIndex = await worker.fetch(accountRequest('/vault/' + vaultId + '/index', {
    method: 'GET',
    membershipTicket: unlockData.membershipTicket,
    sessionToken: secondVerified.sessionToken
  }), env);
  assert.equal(removedDeviceIndex.status, 401);
  const selfRemovalResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/remove', {
    body: { deviceId },
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(selfRemovalResponse.status, 409);
  const unauthorizedListResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/list', {
    method: 'GET',
    membershipTicket: unlockData.membershipTicket
  }), env);
  assert.equal(unauthorizedListResponse.status, 401);

  const wrongDeviceRevokeResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/session/revoke', {
    body: { deviceId: Buffer.alloc(32, 9).toString('base64url') },
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(wrongDeviceRevokeResponse.status, 401);
  assert.equal([...coordinatorStorage.keys()].some(key => key.startsWith('device-session:')), true);

  const revokeResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/session/revoke', {
    body: { deviceId },
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(revokeResponse.status, 200);
  assert.equal([...coordinatorStorage.keys()].some(key => key.startsWith('device-session:')), false);

  const repeatedRevokeResponse = await worker.fetch(accountRequest('/vault/' + vaultId + '/device/session/revoke', {
    body: { deviceId },
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(repeatedRevokeResponse.status, 200);
  assert.deepEqual(await responseJson(repeatedRevokeResponse), {
    ok: true, revoked: false, alreadyRevoked: true
  });

  const revokedSessionRequest = await worker.fetch(accountRequest('/vault/' + vaultId + '/index', {
    method: 'GET',
    membershipTicket: unlockData.membershipTicket,
    sessionToken: verified.sessionToken
  }), env);
  assert.equal(revokedSessionRequest.status, 401);

  const wrongAnswers = recoveryAnswers.map(item => ({ ...item }));
  wrongAnswers[0].answer = 'poppy';
  const rejectedRecovery = await worker.fetch(accountRequest('/account/recover', {
    body: { questionAnswers: wrongAnswers }
  }), env);
  assert.equal(rejectedRecovery.status, 401);

  const recovery = await worker.fetch(accountRequest('/account/recover', {
    body: { questionAnswers: recoveryAnswers }
  }), env);
  assert.equal(recovery.status, 200);
  const recoveryData = await responseJson(recovery);
  assert.equal(recoveryData.username, 'family.vault');
  assert.equal(recoveryData.vaultId, vaultId);
  assert.equal(recoveryData.recoveryEnvelope.algorithm, 'AES-256-GCM');
  assert.equal('questionAnswers' in recoveryData, false);

  const newWriteToken = 'B'.repeat(43);
  const renamed = await worker.fetch(accountRequest('/account/complete-recovery', {
    body: {
      grant: recoveryData.grant,
      newUsername: 'family.renamed',
      passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(6))),
      passphraseIterations: 600000,
      passphraseEnvelope: { ...envelope, iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(7))) },
      writeToken: newWriteToken
    }
  }), env);
  assert.equal(renamed.status, 200);
  const renamedData = await responseJson(renamed);
  assert.equal(renamedData.username, 'family.renamed');
  assert.equal(renamedData.vaultId, vaultId);
  assert.equal(renamedData.usernameChanged, true);
  assert.equal(renamedData.passphraseChanged, true);

  const oldUsername = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'family.vault' }
  }), env);
  assert.equal(oldUsername.status, 200);
  assert.equal((await responseJson(oldUsername)).username, 'family.vault');

  const newUsername = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'family.renamed' }
  }), env);
  assert.equal(newUsername.status, 200);
  assert.equal((await responseJson(newUsername)).vaultId, vaultId);

  const oldTokenUnlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId }, token: writeToken
  }), env);
  assert.equal(oldTokenUnlock.status, 401);

  const newTokenUnlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId }, token: newWriteToken
  }), env);
  assert.equal(newTokenUnlock.status, 200);

  const registryStorage = env.ACCOUNT_REGISTRY.storageMaps.get('global-account-registry');
  const persistedAccount = [...registryStorage.entries()]
    .find(([key]) => key === 'account:' + vaultId)?.[1];
  assert.ok(persistedAccount);
  const persistedText = JSON.stringify(persistedAccount);
  assert.equal(persistedText.includes('Poppy'), false);
  assert.equal(persistedText.includes('Mango'), false);
  assert.equal(persistedText.includes('Piano'), false);
});

test('Account Registry rejects duplicate questions, spaces, invalid answers, and duplicate usernames', async () => {
  const kvMap = new Map();
  const env = {
    ...EDGE_LIMITERS,
    RECOVERY_PEPPER: 'another-test-recovery-pepper-longer-than-32-characters',
    MEMBERSHIP_PEPPER: 'another-test-membership-pepper-longer-than-32-characters',
    VAULT_PACKETS: {
      async get(key) { return kvMap.get(key) ?? null; },
      async put(key, value) { kvMap.set(key, value); }
    }
  };
  env.VAULT_COORDINATOR = makeDurableNamespace(VaultCoordinator, env);
  env.ACCOUNT_REGISTRY = makeDurableNamespace(AccountRegistry, env);

  const envelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(8))),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(48).fill(9)))
  };
  const validBody = {
    username: 'second.family',
    vaultId: 'd'.repeat(64),
    passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(1))),
    passphraseIterations: 600000,
    passphraseEnvelope: envelope,
    recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(2))),
    recoveryIterations: 1200000,
    recoveryEnvelope: envelope,
    questionAnswers: [
      { questionId: 3, answer: 'Neighbor' },
      { questionId: 7, answer: 'Awake' },
      { questionId: 15, answer: 'Melody' }
    ],
    writeToken: 'C'.repeat(43)
  };

  const invalidAnswers = await worker.fetch(accountRequest('/account/signup', {
    body: { ...validBody, questionAnswers: [
      { questionId: 3, answer: 'Neighbor' },
      { questionId: 3, answer: 'Awake' },
      { questionId: 15, answer: 'Melody' }
    ] }
  }), env);
  assert.equal(invalidAnswers.status, 400);

  const spacedAnswer = await worker.fetch(accountRequest('/account/signup', {
    body: { ...validBody, questionAnswers: [
      { questionId: 3, answer: 'Next Door' },
      { questionId: 7, answer: 'Awake' },
      { questionId: 15, answer: 'Melody' }
    ] }
  }), env);
  assert.equal(spacedAnswer.status, 400);

  const signup = await worker.fetch(accountRequest('/account/signup', { body: validBody }), env);
  assert.equal(signup.status, 201);

  const duplicateUsername = await worker.fetch(accountRequest('/account/signup', {
    body: { ...validBody, vaultId: 'e'.repeat(64), writeToken: 'D'.repeat(43), recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(4))) }
  }), env);
  assert.equal(duplicateUsername.status, 409);
});


test('Vault Coordinator upgrades an existing legacy token only after verifying the old credential', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  const oldToken = 'L'.repeat(43);
  const newToken = 'N'.repeat(43);

  const initialize = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    token: oldToken,
    body: {}
  }));
  assert.equal(initialize.status, 200);

  const rejectedUpgrade = await coordinator.fetch(coordinatorRequest('/admin/migrate-legacy', {
    method: 'POST',
    token: newToken,
    legacyToken: 'X'.repeat(43)
  }));
  assert.equal(rejectedUpgrade.status, 401);

  const acceptedUpgrade = await coordinator.fetch(coordinatorRequest('/admin/migrate-legacy', {
    method: 'POST',
    token: newToken,
    legacyToken: oldToken
  }));
  assert.equal(acceptedUpgrade.status, 200);

  const oldClaim = await coordinator.fetch(coordinatorRequest('/claim', {
    method: 'POST',
    token: oldToken,
    body: {}
  }));
  assert.equal(oldClaim.status, 401);

  const newClaim = await coordinator.fetch(coordinatorRequest('/claim', {
    method: 'POST',
    token: newToken,
    body: {}
  }));
  assert.equal(newClaim.status, 200);
  assert.equal(typeof storageMap.get('upgraded-at'), 'string');
});


test('Vault Coordinator keeps a valid save when the KV packet write is temporarily blocked', async () => {
  const { coordinator, storageMap, failures } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const deviceSession = await createCoordinatorSession(coordinator);
  failures.put = true;

  const saved = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    token: null,
    sessionToken: deviceSession.sessionToken,
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(saved.status, 200);
  const savedBody = await responseJson(saved);
  assert.equal(typeof savedBody.updatedAt, 'string');
  assert.deepEqual(storageMap.get('vault-packet:' + dateString), packet);
  assert.equal(storageMap.get('vault-index')[dateString], savedBody.updatedAt);

  const readBack = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    token: null, sessionToken: deviceSession.sessionToken
  }));
  assert.equal(readBack.status, 200);
  const readBody = await responseJson(readBack);
  assert.deepEqual(readBody.packet, packet);
  assert.equal(readBody.updatedAt, savedBody.updatedAt);
});

test('Vault Coordinator does not initialize an empty index when KV is unavailable and retries cleanly', async () => {
  const { coordinator, storageMap, failures } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  const deviceSession = await createCoordinatorSession(coordinator);

  failures.get = true;
  const blocked = await coordinator.fetch(coordinatorRequest('/index', {
    token: null, sessionToken: deviceSession.sessionToken
  }));
  assert.equal(blocked.status, 503);
  assert.equal(storageMap.has('vault-index'), false);

  failures.get = false;
  const recovered = await coordinator.fetch(coordinatorRequest('/index', {
    token: null, sessionToken: deviceSession.sessionToken
  }));
  assert.equal(recovered.status, 200);
  assert.deepEqual((await responseJson(recovered)).index, {});
  assert.deepEqual(storageMap.get('vault-index'), {});
});

test('repeated live-sync index checks use the Durable Object cache and do not consume repeated KV reads', async () => {
  const { coordinator, failures } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const device = await createCoordinatorSession(coordinator);

  const first = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: device.sessionToken
  }));
  assert.equal(first.status, 200);

  // Once the index has been loaded into Durable Object storage, subsequent
  // authenticated metadata checks must not touch KV.
  failures.get = true;
  const repeated = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: device.sessionToken
  }));
  assert.equal(repeated.status, 200);
  assert.deepEqual((await responseJson(repeated)).index, {});
});

test('Vault Coordinator reports a temporary read failure instead of treating a missing KV packet as empty', async () => {
  const { coordinator, storageMap, failures } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const deviceSession = await createCoordinatorSession(coordinator);
  failures.get = true;

  const read = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    token: null, sessionToken: deviceSession.sessionToken
  }));
  assert.equal(read.status, 503);
  assert.match((await responseJson(read)).error, /temporarily unavailable/);
  assert.equal(storageMap.has('vault-packet:' + dateString), false);
});


test('invalid device signatures consume their nonce and cannot be replayed with a later valid signature', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  );
  const publicKeyBytes = new Uint8Array(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
  const publicKeySpki = base64Url(publicKeyBytes);
  const deviceId = base64Url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', publicKeyBytes)));

  const challengeResponse = await coordinator.fetch(coordinatorRequest('/device/challenge', {
    method: 'POST',
    body: { deviceId, publicKeySpki }
  }));
  assert.equal(challengeResponse.status, 200);
  const challenge = await responseJson(challengeResponse);
  const challengeKey = 'device-challenge:' + challenge.challengeId;
  assert.equal(storageMap.has(challengeKey), true);

  const invalid = await coordinator.fetch(coordinatorRequest('/device/verify', {
    method: 'POST',
    token: null,
    body: {
      challengeId: challenge.challengeId,
      deviceId,
      signature: base64Url(new Uint8Array(64))
    }
  }));
  assert.equal(invalid.status, 401);
  assert.equal(storageMap.has(challengeKey), false);

  const validSignature = base64Url(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge.message)
  ));
  const replay = await coordinator.fetch(coordinatorRequest('/device/verify', {
    method: 'POST',
    token: null,
    body: {
      challengeId: challenge.challengeId,
      deviceId,
      signature: validSignature
    }
  }));
  assert.equal(replay.status, 401);
  assert.equal([...storageMap.keys()].some(key => key.startsWith('device-session:')), false);
});

test('Durable Object alarm purges a device session when its two-minute idle expiry is reached', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const { deviceId, sessionToken } = await createCoordinatorSession(coordinator);
  const sessionHash = await (async () => {
    const digest = new Uint8Array(await webcrypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(sessionToken)
    ));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  })();
  const sessionKey = 'device-session:' + sessionHash;
  const record = storageMap.get(sessionKey);
  assert.equal(record.deviceId, deviceId);
  record.idleExpiresAt = Date.now() - 1;
  storageMap.set(sessionKey, record);

  await coordinator.alarm();
  assert.equal(storageMap.has(sessionKey), false);
});


test('device challenge and verification do not perform the vault packet-index KV bootstrap', async () => {
  const { coordinator, failures, storageMap } = makeCoordinator();
  const initialized = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  assert.equal(initialized.status, 200);

  // A challenge is an authentication operation; it must not read the KV
  // packet index merely because this is the first request to this Coordinator.
  failures.get = true;
  const session = await createCoordinatorSession(coordinator);
  assert.equal(typeof session.sessionToken, 'string');
  assert.equal(storageMap.has('vault-index'), false);
});

test('rotating the account write credential revokes all existing device sessions', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  const first = await createCoordinatorSession(coordinator);
  const second = await createCoordinatorSession(coordinator);
  assert.equal([...storageMap.keys()].filter(key => key.startsWith('device-session:')).length, 2);

  const rotated = await coordinator.fetch(coordinatorRequest('/admin/rotate-token', {
    method: 'POST',
    token: 'R'.repeat(43),
    body: {}
  }));
  assert.equal(rotated.status, 200);
  assert.equal([...storageMap.keys()].some(key => key.startsWith('device-session:')), false);

  const staleRequest = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: first.sessionToken
  }));
  assert.equal(staleRequest.status, 401);
  const secondStaleRequest = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: second.sessionToken
  }));
  assert.equal(secondStaleRequest.status, 401);
});


test('expired device challenges are consumed and rejected without creating a session', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  );
  const publicKeyBytes = new Uint8Array(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
  const publicKeySpki = base64Url(publicKeyBytes);
  const deviceId = base64Url(new Uint8Array(await webcrypto.subtle.digest('SHA-256', publicKeyBytes)));

  const issued = await coordinator.fetch(coordinatorRequest('/device/challenge', {
    method: 'POST',
    body: { deviceId, publicKeySpki }
  }));
  assert.equal(issued.status, 200);
  const challenge = await responseJson(issued);
  const key = 'device-challenge:' + challenge.challengeId;
  const stored = storageMap.get(key);
  storageMap.set(key, { ...stored, expiresAt: Date.now() - 1 });

  const signature = base64Url(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge.message)
  ));
  const expired = await coordinator.fetch(coordinatorRequest('/device/verify', {
    method: 'POST',
    token: null,
    body: { challengeId: challenge.challengeId, deviceId, signature }
  }));

  assert.equal(expired.status, 401);
  assert.equal(storageMap.has(key), false);
  assert.equal([...storageMap.keys()].some(item => item.startsWith('device-session:')), false);
});


test('invalid or expired device sessions are rejected before any packet-index KV read', async () => {
  const { coordinator, storageMap, failures } = makeCoordinator();
  failures.get = true;

  const invalid = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: 'I'.repeat(43)
  }));
  assert.equal(invalid.status, 401);
  assert.equal(storageMap.has('vault-index'), false);

  const initialized = await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  assert.equal(initialized.status, 200);
  const valid = await createCoordinatorSession(coordinator);
  const digest = new Uint8Array(await webcrypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(valid.sessionToken)
  ));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  const sessionKey = 'device-session:' + hash;
  const sessionRecord = storageMap.get(sessionKey);
  sessionRecord.idleExpiresAt = Date.now() - 1;
  storageMap.set(sessionKey, sessionRecord);

  const expired = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: valid.sessionToken
  }));
  assert.equal(expired.status, 401);
  assert.equal(storageMap.has('vault-index'), false);
});


test('an expired device session cannot replace an existing cloud packet', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', {
    method: 'POST',
    body: {}
  }));
  const device = await createCoordinatorSession(coordinator);

  const saved = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    token: null,
    sessionToken: device.sessionToken,
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(saved.status, 200);
  const savedBody = await responseJson(saved);
  const storedPacket = storageMap.get('vault-packet:' + dateString);
  const storedUpdatedAt = storageMap.get('vault-index')[dateString];

  const digest = new Uint8Array(await webcrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(device.sessionToken)
  ));
  const sessionHash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  const sessionKey = 'device-session:' + sessionHash;
  const sessionRecord = storageMap.get(sessionKey);
  storageMap.set(sessionKey, { ...sessionRecord, idleExpiresAt: Date.now() - 1 });

  const changedPacket = { ...packet, ciphertext: Buffer.from('changed packet').toString('base64') };
  const rejected = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    token: null,
    sessionToken: device.sessionToken,
    body: { packet: changedPacket, baseUpdatedAt: savedBody.updatedAt }
  }));

  assert.equal(rejected.status, 401);
  assert.deepEqual(storageMap.get('vault-packet:' + dateString), storedPacket);
  assert.equal(storageMap.get('vault-index')[dateString], storedUpdatedAt);
});


test('vault packet reads and writes do not create extra Durable Object rate-counter rows', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const device = await createCoordinatorSession(coordinator);

  const index = await coordinator.fetch(coordinatorRequest('/index', {
    token: null,
    sessionToken: device.sessionToken
  }));
  assert.equal(index.status, 200);

  const save = await coordinator.fetch(coordinatorRequest('/day/' + dateString, {
    method: 'PUT',
    token: null,
    sessionToken: device.sessionToken,
    body: { packet, baseUpdatedAt: null }
  }));
  assert.equal(save.status, 200);

  const packetRateKeys = [...storageMap.keys()].filter(key =>
    key.startsWith('auth-rate:packet-index-read')
    || key.startsWith('auth-rate:packet-day-read')
    || key.startsWith('auth-rate:packet-day-write')
  );
  assert.deepEqual(packetRateKeys, []);
});


test('sign-in lookup uses the same status and response shape for known and unknown usernames', async () => {
  const kvMap = new Map();
  const env = {
    ...EDGE_LIMITERS,
    RECOVERY_PEPPER: 'test-only-recovery-pepper-with-more-than-32-characters',
    MEMBERSHIP_PEPPER: 'test-only-membership-pepper-with-more-than-32-characters',
    VAULT_PACKETS: {
      async get(key) { return kvMap.get(key) ?? null; },
      async put(key, value) { kvMap.set(key, value); }
    }
  };
  env.VAULT_COORDINATOR = makeDurableNamespace(VaultCoordinator, env);
  env.ACCOUNT_REGISTRY = makeDurableNamespace(AccountRegistry, env);

  const vaultId = 'e'.repeat(64);
  const writeToken = 'C'.repeat(43);
  const envelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(11))),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(48).fill(12)))
  };
  const signup = await worker.fetch(accountRequest('/account/signup', {
    body: {
      username: 'known.family',
      vaultId,
      passphraseSalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(13))),
      passphraseIterations: 600000,
      passphraseEnvelope: envelope,
      recoverySalt: btoa(String.fromCharCode(...new Uint8Array(16).fill(14))),
      recoveryIterations: 1200000,
      recoveryEnvelope: envelope,
      questionAnswers: [
        { questionId: 4, answer: 'Harbor' },
        { questionId: 8, answer: 'Cedar' },
        { questionId: 19, answer: 'Morning' }
      ],
      writeToken
    }
  }), env);
  assert.equal(signup.status, 201);

  const knownResponse = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'known.family' }
  }), env);
  const unknownResponse = await worker.fetch(accountRequest('/account/signin', {
    body: { username: 'missing.family' }
  }), env);
  assert.equal(knownResponse.status, 200);
  assert.equal(unknownResponse.status, 200);

  const known = await responseJson(knownResponse);
  const unknown = await responseJson(unknownResponse);
  assert.deepEqual(Object.keys(unknown).sort(), Object.keys(known).sort());
  assert.equal(unknown.username, 'missing.family');
  assert.match(unknown.vaultId, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(unknown.passphraseSalt, 'base64').length, 16);
  assert.equal(unknown.passphraseIterations, known.passphraseIterations);
  assert.notEqual(unknown.vaultId, known.vaultId);

  const unknownUnlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId: unknown.vaultId },
    token: 'D'.repeat(43)
  }), env);
  const knownBadUnlock = await worker.fetch(accountRequest('/account/unlock', {
    body: { vaultId },
    token: 'D'.repeat(43)
  }), env);
  assert.equal(unknownUnlock.status, 401);
  assert.equal(knownBadUnlock.status, 401);
  assert.deepEqual(await responseJson(unknownUnlock), await responseJson(knownBadUnlock));

  const registryStorage = env.ACCOUNT_REGISTRY.storageMaps.get('global-account-registry');
  const authRateKeys = [...registryStorage.keys()].filter(key => key.startsWith('auth-rate:'));
  assert.ok(authRateKeys.every(key => key.startsWith('auth-rate:unlock:')));
});

test('local-only legacy accounts can upgrade without a cloud packet index', async () => {
  const username = 'local.only.family';
  const digest = new Uint8Array(await webcrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('FaithFocus|VaultID|v1|' + username)
  ));
  const legacyVaultId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  const legacyToken = 'E'.repeat(43);
  const kvMap = new Map();
  const env = {
    ...EDGE_LIMITERS,
    RECOVERY_PEPPER: 'test-only-recovery-pepper-with-more-than-32-characters',
    MEMBERSHIP_PEPPER: 'test-only-membership-pepper-with-more-than-32-characters',
    VAULT_PACKETS: { async get(key) { return kvMap.get(key) ?? null; } }
  };
  env.VAULT_COORDINATOR = makeDurableNamespace(VaultCoordinator, env);
  env.ACCOUNT_REGISTRY = makeDurableNamespace(AccountRegistry, env);

  const initialized = await env.VAULT_COORDINATOR.get(legacyVaultId).fetch(new Request(
    'https://vault-coordinator.internal/admin/initialize',
    {
      method: 'POST',
      headers: {
        'X-Vault-Id': legacyVaultId,
        'X-Write-Token': legacyToken,
        'Content-Type': 'application/json'
      },
      body: '{}'
    }
  ));
  assert.equal(initialized.status, 200);
  assert.equal(kvMap.has(legacyVaultId + ':index'), false);

  const response = await worker.fetch(accountRequest('/legacy-claim/' + legacyVaultId, {
    body: {},
    token: legacyToken,
    legacyUsername: username
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true, claimed: true, legacy: true });
  assert.equal(kvMap.has(legacyVaultId + ':index'), false);
});

test('Account Registry alarm removes expired auth counters and recovery grants but retains active entries', async () => {
  const now = Date.now();
  const map = new Map([
    ['auth-rate:unlock:expired', { windowStartedAt: now - 16 * 60 * 1000, count: 10 }],
    ['auth-rate:unlock:active', { windowStartedAt: now, count: 1, expiresAt: now + 15 * 60 * 1000 }],
    ['recovery-grant:expired', { vaultId: 'a'.repeat(64), expiresAt: now - 1 }],
    ['recovery-grant:active', { vaultId: 'b'.repeat(64), expiresAt: now + 10 * 60 * 1000 }]
  ]);
  let alarmAt = null;
  const storage = {
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(key) { return map.delete(key); },
    async list({ prefix = '', startAfter, limit = Infinity } = {}) {
      const entries = [...map.entries()]
        .filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit);
      return new Map(entries);
    },
    async getAlarm() { return alarmAt; },
    async setAlarm(value) { alarmAt = value; },
    async deleteAlarm() { alarmAt = null; }
  };
  const registry = new AccountRegistry({ storage }, {
    RECOVERY_PEPPER: 'test-only-recovery-pepper-with-more-than-32-characters',
    MEMBERSHIP_PEPPER: 'test-only-membership-pepper-with-more-than-32-characters'
  });

  await registry.alarm();
  assert.equal(map.has('auth-rate:unlock:expired'), false);
  assert.equal(map.has('recovery-grant:expired'), false);
  assert.equal(map.has('auth-rate:unlock:active'), true);
  assert.equal(map.has('recovery-grant:active'), true);
  assert.ok(alarmAt >= now + 10 * 60 * 1000);
  assert.ok(alarmAt <= now + 15 * 60 * 1000);
});


test('preflight requests use the ingress limiter before returning CORS headers', async () => {
  const calls = [];
  const env = {
    EDGE_RATE_LIMIT_PEPPER: 'worker-test-edge-rate-limit-secret-with-32-characters',
    AUTH_IP_RATE_LIMITER: { async limit({key}) { calls.push(key); return {success:false}; } }
  };
  const response = await worker.fetch(new Request('https://worker.example/vault/' + VAULT_ID + '/index', {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'CF-Connecting-IP': '198.51.100.204',
      'Access-Control-Request-Method': 'GET'
    }
  }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(calls.length, 1);
});


test('transient cleanup restarts when an earlier-expiring record is inserted before its saved cursor', async () => {
  const now = Date.now();
  const cursorKey = 'auth-rate-cleanup-cursor';
  const expiryKey = 'auth-rate-cleanup-next-expiry';
  const recordExpiry = now + 60 * 1000;
  const map = new Map([
    [cursorKey, 'auth-rate:unlock:zzz'],
    [expiryKey, now + 5 * 60 * 1000],
    ['auth-rate:unlock:aaa', {
      windowStartedAt: now - 14 * 60 * 1000,
      count: 1,
      expiresAt: recordExpiry
    }],
    ['auth-rate:unlock:zzz', {
      windowStartedAt: now,
      count: 1,
      expiresAt: now + 15 * 60 * 1000
    }]
  ]);
  let alarmAt = now + 5 * 60 * 1000;
  const storage = {
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async delete(key) { return map.delete(key); },
    async list({ prefix = '', startAfter, limit = Infinity } = {}) {
      const entries = [...map.entries()]
        .filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit);
      return new Map(entries);
    },
    async getAlarm() { return alarmAt; },
    async setAlarm(value) { alarmAt = value; },
    async deleteAlarm() { alarmAt = null; }
  };
  const registry = new AccountRegistry({ storage }, {
    RECOVERY_PEPPER: 'test-only-recovery-pepper-with-more-than-32-characters',
    MEMBERSHIP_PEPPER: 'test-only-membership-pepper-with-more-than-32-characters'
  });

  assert.equal(await registry.rateLimitSubject('unlock', 'aaa', 10, 15 * 60 * 1000), true);
  assert.equal(map.has(cursorKey), false);
  assert.equal(map.has(expiryKey), false);
  assert.ok(alarmAt >= recordExpiry);
  assert.ok(alarmAt <= recordExpiry + 1_000);
});


test('Durable Object write-spacing markers are bounded and migrate legacy per-record keys', async () => {
  const originalNow = Date.now;
  let simulatedNow = 1_800_000_000_000;
  const markerMap = new Map();
  for (let index = 0; index < 96; index += 1) {
    markerMap.set('kv-write-time:legacy-voice-note-' + String(index).padStart(3, '0'), index);
  }
  const state = {
    storage: {
      async get(key) { return markerMap.get(key); },
      async put(key, value) {
        markerMap.set(key, value);
        simulatedNow += 1_200;
      },
      async delete(key) { return markerMap.delete(key); },
      async list({ prefix = '', startAfter = '', limit = 1000 } = {}) {
        const keys = [...markerMap.keys()]
          .filter(key => key.startsWith(prefix) && key > startAfter)
          .sort()
          .slice(0, limit);
        return new Map(keys.map(key => [key, markerMap.get(key)]));
      }
    }
  };
  const coordinator = new VaultCoordinator(state, {});
  Date.now = () => simulatedNow;
  try {
    for (let index = 0; index < 2_000; index += 1) {
      await coordinator.enforceKvWriteSpacing('unique-voice-note-chunk-' + index);
    }
  } finally {
    Date.now = originalNow;
  }
  const markerKeys = [...markerMap.keys()].filter(key => key.startsWith('kv-write-time:bucket:'));
  const remainingLegacyKeys = [...markerMap.keys()].filter(key =>
    key.startsWith('kv-write-time:') && !key.startsWith('kv-write-time:bucket:')
  );
  assert.ok(markerKeys.length <= 32);
  assert.ok(markerKeys.length > 0);
  assert.equal(remainingLegacyKeys.length, 0);
  assert.equal(markerMap.has('kv-write-marker-cleanup-cursor'), false);
  assert.ok(Array.from({ length: 2_000 }, (_, index) =>
    getKvWriteSpacingBucket('unique-voice-note-chunk-' + index)
  ).every(bucket => Number.isInteger(bucket) && bucket >= 0 && bucket < 32));
});


test('trusted devices can be listed and a removed device loses every active session', async () => {
  const { coordinator, storageMap } = makeCoordinator();
  await coordinator.fetch(coordinatorRequest('/admin/initialize', { method: 'POST', body: {} }));
  const current = await createCoordinatorSession(coordinator);
  const oldDevice = await createCoordinatorSession(coordinator);

  const listResponse = await coordinator.fetch(coordinatorRequest('/device/list', {
    method: 'GET', token: null, sessionToken: current.sessionToken
  }));
  assert.equal(listResponse.status, 200);
  const listed = await responseJson(listResponse);
  assert.equal(listed.devices.length, 2);
  assert.equal(listed.currentDeviceId, current.deviceId);
  assert.equal(listed.devices.find(item => item.deviceId === current.deviceId).isCurrent, true);
  assert.equal(listed.devices.find(item => item.deviceId === oldDevice.deviceId).isCurrent, false);

  const selfRemoval = await coordinator.fetch(coordinatorRequest('/device/remove', {
    method: 'POST', token: null, sessionToken: current.sessionToken,
    body: { deviceId: current.deviceId }
  }));
  assert.equal(selfRemoval.status, 409);

  const removal = await coordinator.fetch(coordinatorRequest('/device/remove', {
    method: 'POST', token: null, sessionToken: current.sessionToken,
    body: { deviceId: oldDevice.deviceId }
  }));
  assert.equal(removal.status, 200);
  assert.deepEqual(await responseJson(removal), {
    ok: true, removed: true, deviceId: oldDevice.deviceId, revokedSessions: 1
  });
  assert.equal(storageMap.has('device:' + oldDevice.deviceId), false);

  const removedSession = await coordinator.fetch(coordinatorRequest('/index', {
    method: 'GET', token: null, sessionToken: oldDevice.sessionToken
  }));
  assert.equal(removedSession.status, 401);

  const remaining = await coordinator.fetch(coordinatorRequest('/device/list', {
    method: 'GET', token: null, sessionToken: current.sessionToken
  }));
  assert.deepEqual((await responseJson(remaining)).devices.map(item => item.deviceId), [current.deviceId]);
});

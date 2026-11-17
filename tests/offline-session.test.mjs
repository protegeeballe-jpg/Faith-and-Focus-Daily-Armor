import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  createVaultAccount, unlockVaultAccount, encryptDailyBundle, decryptDailyBundle,
  wipeWriteToken
} from '../assets/vault-crypto.js';
import { readFileSync } from 'node:fs';

const session = readFileSync(new URL('../assets/vault-session.js', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../assets/vault-storage.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../assets/vault-sync.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const answers = [
  { questionId: 1, answer: 'Maple' },
  { questionId: 2, answer: 'Harbor' },
  { questionId: 3, answer: 'Comet' }
];

test('a device-local envelope unlocks existing encrypted data without storing a password', async () => {
  const account = await createVaultAccount(
    'offline.family',
    'a-strong-local-passphrase-2026',
    answers,
    webcrypto
  );
  const localProfile = {
    version: 1,
    username: account.accountRecord.username,
    vaultId: account.accountRecord.vaultId,
    passphraseSalt: account.accountRecord.passphraseSalt,
    passphraseIterations: account.accountRecord.passphraseIterations,
    passphraseEnvelope: account.accountRecord.passphraseEnvelope
  };

  assert.deepEqual(
    Object.keys(localProfile).sort(),
    ['passphraseEnvelope', 'passphraseIterations', 'passphraseSalt', 'username', 'vaultId', 'version'].sort()
  );
  assert.equal(Object.hasOwn(localProfile, 'password'), false);

  const localSession = await unlockVaultAccount(
    localProfile,
    'a-strong-local-passphrase-2026',
    webcrypto
  );
  const bundle = {
    format: 'faith-focus-daily-bundle',
    version: 1,
    dateString: '2026-11-17',
    records: {
      'mindful_pokes_data_2026-11-17': JSON.stringify({ prayer: true })
    },
    voiceNotes: []
  };
  const packet = await encryptDailyBundle(
    bundle,
    localSession.encryptionKey,
    async value => Buffer.from(value, 'utf8').toString('base64'),
    webcrypto
  );
  assert.equal(packet.compression, 'gzip-base64');
  const restored = await decryptDailyBundle(
    packet,
    localSession.encryptionKey,
    async value => Buffer.from(value, 'base64').toString('utf8'),
    webcrypto
  );
  assert.deepEqual(restored, bundle);
  assert.equal(JSON.stringify(packet).includes('prayer'), false);

  wipeWriteToken(localSession.writeToken);
  wipeWriteToken(account.writeToken);
});

test('a wrong passphrase cannot unwrap the device-local key envelope', async () => {
  const account = await createVaultAccount(
    'offline.family',
    'a-strong-local-passphrase-2026',
    answers,
    webcrypto
  );
  const profile = {
    username: account.accountRecord.username,
    vaultId: account.accountRecord.vaultId,
    passphraseSalt: account.accountRecord.passphraseSalt,
    passphraseIterations: account.accountRecord.passphraseIterations,
    passphraseEnvelope: account.accountRecord.passphraseEnvelope
  };
  await assert.rejects(
    unlockVaultAccount(profile, 'a-different-passphrase-2026', webcrypto),
    /did not unlock this account/
  );
  wipeWriteToken(account.writeToken);
});

test('offline sign-in uses only the saved envelope and discards online credentials', () => {
  const offlineUnlock = session.slice(
    session.indexOf('async function unlockOfflineVault('),
    session.indexOf('async function cacheOfflineVaultProfile(')
  );
  assert.match(offlineUnlock, /getOfflineVaultProfile\(username\)/);
  assert.match(offlineUnlock, /unlockVaultAccount\(profile, passphrase\)/);
  assert.match(offlineUnlock, /wipeWriteToken\(credentials\.writeToken\)/);
  assert.match(offlineUnlock, /credentials\.writeToken = null/);
  assert.match(offlineUnlock, /credentials\.offlineOnly = true/);
  assert.doesNotMatch(offlineUnlock, /accountRequest\(|establishDeviceSession\(|startVaultSync\(/);
  const login = session.slice(
    session.indexOf('async function submitVaultLogin(event) {'),
    session.indexOf('async function submitVaultSignup(event) {')
  );
  const deviceVerification = login.indexOf('await establishDeviceSession(credentials, unlocked.membershipTicket);');
  assert.ok(deviceVerification >= 0);
  const migrationAt = login.indexOf('const migration =', deviceVerification);
  assert.ok(migrationAt > deviceVerification);
  const deviceVerificationFlow = login.slice(deviceVerification, migrationAt);
  assert.match(deviceVerificationFlow, /try\s*\{\s*await establishDeviceSession/);
  assert.match(deviceVerificationFlow, /catch \(sessionError\)/);
  assert.match(deviceVerificationFlow, /isOfflineFallbackEligible\(sessionError\)/);
  assert.match(deviceVerificationFlow, /await openOfflineSession\(\)/);
  assert.match(deviceVerificationFlow, /throw sessionError/);
  assert.match(login, /offlineProfileSaved = await cacheOfflineVaultProfile\(/);
});

test('offline-only mode cannot create or use cloud sessions', () => {
  assert.match(session, /if \(window\.navigator\?\.onLine === false\)\s*\{\s*await openOfflineSession\(\);\s*return;/);
  assert.match(sync, /if \(activeVault\?\.offlineOnly === true\)\s*\{\s*throw new Error/);
  assert.match(sync, /if \(!activeVault \|\| activeVault\.offlineOnly === true\) return Promise\.resolve\(\)/);
  assert.match(sync, /async function performVaultSync\(\)\s*\{\s*if \(!activeVault \|\| activeVault\.offlineOnly === true\) return;/);
  const localStart = sync.slice(
    sync.indexOf('export async function startLocalVaultStorage('),
    sync.indexOf('export async function startVaultSync(')
  );
  assert.match(localStart, /credentials\?\.offlineOnly !== true/);
  assert.match(localStart, /\|\| credentials\.writeToken/);
  assert.match(localStart, /\|\| credentials\.vaultMembershipTicket/);
  assert.match(localStart, /\|\| credentials\.deviceSessionToken/);
  assert.match(localStart, /await captureExistingLocalDates\(\)/);
  assert.doesNotMatch(localStart, /vaultRequest\(|synchronizeVault\(/);
});

test('offline edits continue through the compressed encrypted local packet path', () => {
  const capture = sync.slice(
    sync.indexOf('async function captureDailyPacket('),
    sync.indexOf('function scheduleCapture(')
  );
  assert.match(capture, /encryptDailyBundle\(bundle, activeVault\.encryptionKey, compressData\)/);
  assert.match(capture, /await putLocalDailyPacket\(/);
  assert.match(capture, /dirty: true/);
  assert.match(sync, /if \(activeVault\) scheduleCapture\(event\?\.detail\?\.dateString/);
  assert.match(session, /startLocalVaultStorage\(credentials\)/);
});

test('offline mode keeps the two-minute lock and prohibits credential changes', () => {
  assert.match(session, /SESSION_INACTIVITY_MS = 2 \* 60 \* 1000/);
  assert.match(session, /credentialsToRevoke\.offlineOnly === true/);
  assert.match(session, /if \(window\.navigator\?\.onLine === false\)\s*\{\s*setStatus\('vault-recovery-message', 'Account recovery requires an internet connection/);
  assert.match(session, /if \(window\.navigator\?\.onLine === false\)\s*\{\s*setStatus\('vault-recovery-message', 'Username and passphrase changes require an internet connection/);
});

test('the local profile store keeps a narrow allow-list and expires stale aliases on account rename', () => {
  assert.match(storage, /const DATABASE_VERSION = 2/);
  assert.match(storage, /createObjectStore\(OFFLINE_PROFILE_STORE, \{ keyPath: 'username' \}\)/);
  assert.match(storage, /profiles\.createIndex\('vaultId', 'vaultId', \{ unique: false \}\)/);
  assert.match(storage, /version: OFFLINE_PROFILE_VERSION/);
  assert.match(storage, /passphraseEnvelope: profile\?\.passphraseEnvelope/);
  assert.match(storage, /passphraseIterations: profile\?\.passphraseIterations/);
  assert.match(storage, /cursor\.value\.username !== safeProfile\.username/);
  assert.match(storage, /export async function deleteOfflineVaultProfilesForVault/);
  assert.doesNotMatch(storage, /password:|writeToken:|deviceSessionToken:|vaultMembershipTicket:/);
});

test('the service worker installs the updated offline-capable app shell', () => {
  assert.match(worker, /faith-focus-shell-v23-stable-app/);
  for (const resource of ['./assets/vault-storage.js', './assets/vault-sync.js', './assets/vault-session.js']) {
    assert.ok(worker.includes("'" + resource + "'"), 'Missing offline resource: ' + resource);
  }
});

test('IndexedDB upgrades recover cleanly after another tab releases the database', () => {
  assert.match(storage, /let settled = false/);
  assert.match(storage, /if \(settled\) \{\s*database\.close\(\);\s*return;/);
  assert.match(storage, /database\.onversionchange = \(\) => \{\s*database\.close\(\);\s*databasePromise = null;/);
  assert.match(storage, /request\.onblocked = \(\) => \{\s*if \(settled\) return;\s*settled = true;\s*databasePromise = null;\s*reject\(/);
  assert.match(storage, /request\.onerror = \(\) => \{\s*if \(settled\) return;\s*settled = true;\s*databasePromise = null;/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasVerifiedDeviceSession, selectVaultReconciliationDates } from '../assets/vault-sync.js';

const syncSource = readFileSync(new URL('../assets/vault-sync.js', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('../assets/vault-session.js', import.meta.url), 'utf8');

function validSession() {
  return {
    vaultId: 'v'.repeat(64),
    encryptionKey: {},
    writeToken: new Uint8Array(32),
    vaultMembershipTicket: 'M'.repeat(43),
    deviceId: 'D'.repeat(43),
    deviceSessionToken: 'S'.repeat(43),
    deviceSessionExpiresAt: Date.now() + 60_000
  };
}

test('vault synchronization requires a complete, current verified device session', () => {
  const credentials = validSession();
  assert.equal(hasVerifiedDeviceSession(credentials), true);

  for (const field of ['vaultId', 'encryptionKey', 'writeToken', 'vaultMembershipTicket', 'deviceId', 'deviceSessionToken', 'deviceSessionExpiresAt']) {
    const incomplete = { ...credentials };
    delete incomplete[field];
    assert.equal(hasVerifiedDeviceSession(incomplete), false, 'Missing ' + field + ' must be rejected');
  }

  assert.equal(hasVerifiedDeviceSession({ ...credentials, deviceSessionToken: 'invalid' }), false);
  assert.equal(hasVerifiedDeviceSession({ ...credentials, deviceId: 'invalid' }), false);
  assert.equal(hasVerifiedDeviceSession({ ...credentials, deviceSessionExpiresAt: Date.now() - 1 }), false);
});

test('each account-opening path verifies the device before starting vault synchronization', () => {
  const requiredSequences = [
    /await establishDeviceSession\(credentials, unlocked\.membershipTicket\);[\s\S]*?await startVaultSync\(credentials\);/,
    /await establishDeviceSession\(credentials, registered\.membershipTicket\);[\s\S]*?await startVaultSync\(credentials\);/,
    /await establishDeviceSession\(credentials, migrated\.membershipTicket\);[\s\S]*?await startVaultSync\(credentials\);/
  ];
  for (const sequence of requiredSequences) assert.match(sessionSource, sequence);
  assert.equal((sessionSource.match(/await startVaultSync\(credentials\)/g) || []).length, 3);
});

test('live cross-device sync uses an authenticated WebSocket and changed-date reconciliation', () => {
  assert.match(syncSource, /new WebSocket\\(url,\\s*\\[/);
  assert.match(syncSource, /faith-focus-sync-v1/);
  assert.match(syncSource, /session\\.vaultMembershipTicket/);
  assert.match(syncSource, /session\\.deviceSessionToken/);
  assert.match(syncSource, /message\\.type !== 'vault:changed'/);
  assert.match(syncSource, /queueVaultSync\\(\\{ dateString: message\\.dateString, immediate: true \\}\\)/);
  assert.match(syncSource, /VAULT_EVENT_RECONNECT_MAX_MS/);
  assert.match(syncSource, /document\\.visibilityState !== 'visible'/);
  assert.doesNotMatch(syncSource, /REMOTE_INDEX_POLL|pollRemoteVaultIndex|scheduleRemoteIndexPoll|setInterval\\(/);
});

test('local packets remain dirty until the cloud accepts their upload', () =>{
  const captureStart = syncSource.indexOf('async function captureDailyPacket(');
  const uploadStart = syncSource.indexOf('async function uploadDailyPacket(');
  const localWrite = syncSource.indexOf('await putLocalDailyPacket({', captureStart);
  const dirtyFlag = syncSource.indexOf('dirty: true', localWrite);
  const cloudWrite = syncSource.indexOf('const result = await vaultRequest(', uploadStart);
  const markSynced = syncSource.indexOf('await markLocalDailyPacketSynced(', cloudWrite);

  assert.ok(captureStart >= 0 && uploadStart > captureStart);
  assert.ok(localWrite > captureStart && dirtyFlag > localWrite);
  assert.ok(cloudWrite > uploadStart && markSynced > cloudWrite);
  assert.match(syncSource, /deviceSessionExpiresAt <= Date\.now\(\)/);
});

test('Diary writes and voice notes share a debounced cloud queue with guarded foreground refresh', () => {
  assert.doesNotMatch(syncSource, /installVaultSyncRefresh|setInterval|scheduleCloudPush|cloudDebounceTimer|refreshVaultFromForeground/);
  assert.match(syncSource, /const DAILY_SYNC_DEBOUNCE_MS = 1200/);
  assert.match(syncSource, /const DAILY_SYNC_MIN_INTERVAL_MS = 3500/);
  assert.ok(syncSource.includes('queueVaultSync({ dateString });'));
  assert.match(syncSource, /function queueVaultSync\(/);
  assert.match(syncSource, /await uploadPendingVoiceNoteAttachments\(pendingDate\)/);
  assert.match(syncSource, /await uploadAllPendingVoiceNoteAttachments\(\)/);
  assert.match(syncSource, /await synchronizeVault\(\{ dateStrings: dates, refreshAll: shouldRefreshAll \}\)/);
  assert.match(syncSource, /function handleLocalDataChanged\(event\)[\s\S]*?scheduleCapture\(/);
  assert.match(syncSource, /function handleOnline\(\)/);
  assert.ok(syncSource.includes("window.addEventListener('online', handleOnline);"));
  assert.ok(syncSource.includes("window.removeEventListener('online', handleOnline);"));
  assert.ok(syncSource.includes("queueVaultSync({ refreshAll: true, immediate: true });"));

  const flushStart = syncSource.indexOf('function flushLocalVaultChanges()');
  const flushEnd = syncSource.indexOf('export async function stopVaultSync()', flushStart);
  const flushSource = syncSource.slice(flushStart, flushEnd);
  assert.doesNotMatch(flushSource, /synchronizeVault|vaultRequest\(/);
  assert.match(syncSource.slice(flushEnd), /clearTimeout\(dailySyncTimer\)/);
});


test('startup listeners are installed before the first cloud await and buffered changes flush afterward', () => {
  const start = syncSource.slice(
    syncSource.indexOf('export async function startVaultSync(credentials) {'),
    syncSource.indexOf('function handleLocalDataChanged(event)')
  );
  const localListeners = start.indexOf('installVaultLocalListeners();');
  const onlineListener = start.indexOf('installVaultOnlineListener();');
  const firstCloudAwait = start.indexOf("await vaultRequest('/vault/' + activeVault.vaultId + '/claim'");
  assert.ok(localListeners >= 0 && localListeners < firstCloudAwait);
  assert.ok(onlineListener >= 0 && onlineListener < firstCloudAwait);
  assert.match(syncSource, /let vaultSyncInitializing = false/);
  assert.match(syncSource, /if \(vaultSyncInitializing\) return/);
  assert.ok(start.indexOf('vaultSyncInitializing = false;') > start.indexOf('await synchronizeVault()'));
  assert.match(start, /if \(pendingDailySyncDates\.size \|\| pendingFullVaultRefresh\)\s*\{\s*queueVaultSync\(\{ refreshAll: true, immediate: true \}\)/);
  assert.match(start, /removeVaultSyncListeners\(\)/);
  assert.match(syncSource, /function installVaultLocalListeners\(\)/);
});


test('routine sync reconciles only changed dates while full refresh reconciles the remote index', () => {
  const index = {
    '2026-11-18': 'remote-a',
    '2026-11-19': 'remote-b',
    '2026-11-20': 'remote-c',
    'not-a-date': 'invalid'
  };
  assert.deepEqual(
    selectVaultReconciliationDates(index, ['2026-11-20', '2026-11-20', 'not-a-date'], false),
    ['2026-11-20']
  );
  assert.deepEqual(
    selectVaultReconciliationDates(index, ['2026-11-20'], true),
    ['2026-11-18', '2026-11-19', '2026-11-20']
  );
  assert.deepEqual(selectVaultReconciliationDates(index, [], false), []);
});

test('Diary encrypted write batches are captured once after both encrypted records are committed', () => {
  const writingSource = readFileSync(new URL('../assets/writing-security.js', import.meta.url), 'utf8');
  const captureStart = writingSource.indexOf('function enqueuePrivateWritingSnapshot(');
  const captureEnd = writingSource.indexOf('async function savePrivateWritingForDate(', captureStart);
  const writer = writingSource.slice(captureStart, captureEnd);
  assert.match(writer, /window\.__faithFocusVaultBatchWrite=true/);
  assert.ok(writer.indexOf("localStorage.setItem(getSecureWritingStorageKey('diary'") <
    writer.indexOf("localStorage.setItem(getSecureWritingStorageKey('notes'"));
  assert.ok(writer.indexOf("localStorage.setItem(getSecureWritingStorageKey('notes'") <
    writer.indexOf("window.dispatchEvent(new CustomEvent('faith-focus:local-data-changed'"));
  assert.match(syncSource, /!window\.__faithFocusVaultBatchWrite/);
});

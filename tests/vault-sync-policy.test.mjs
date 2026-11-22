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

test('voice attachment upload failure never suppresses sign-in vault reconciliation', () => {
  const startup = syncSource.slice(
    syncSource.indexOf('export async function startVaultSync(credentials) {'),
    syncSource.indexOf('function handleLocalDataChanged(event)')
  );
  assert.match(startup, /await uploadAllPendingVoiceNoteAttachments\(\)/);
  assert.match(startup, /await synchronizeVault\(\{ refreshAll: true, allowUploads: voiceAttachmentsReady \}\)/);
  assert.doesNotMatch(startup, /if \(voiceAttachmentsReady\)\s*\{\s*await synchronizeVault/);
  assert.match(syncSource, /async function restoreDailyBundle[\s\S]*?let voiceNotesReady = true/);
  assert.match(syncSource, /return \{ voiceNotesReady, applied: true \}/);
  assert.match(syncSource, /async function performVaultSync\(\{ dateStrings = \[\], refreshAll = false, allowUploads = true \}/);
});

test('one failed date does not stop other dates from reconciling', () => {
  assert.match(syncSource, /const failedDates = \[\]/);
  assert.match(syncSource, /One date could not be reconciled; continuing with the remaining dates/);
  assert.match(syncSource, /Some encrypted dates or voice notes remain queued/);
});

test('cross-device reconciliation avoids Cloudflare writes when the merged packet already matches remote', () => {
  assert.match(syncSource, /canonicalBundle\(mergedBundle\) === canonicalBundle\(remoteBundle\)/);
  assert.match(syncSource, /markLocalDailyPacketSynced\([\s\S]*?remote\.packet/);
  assert.match(syncSource, /allowUploads/);
});

test('live cross-device sync uses an authenticated WebSocket and changed-date reconciliation', () => {
  assert.ok(syncSource.includes('new WebSocket(url, ['));
  assert.ok(syncSource.includes("'faith-focus-sync-v1'"));
  assert.ok(syncSource.includes('session.vaultMembershipTicket'));
  assert.ok(syncSource.includes('session.deviceSessionToken'));
  assert.ok(syncSource.includes("message.type !== 'vault:changed'"));
  assert.ok(syncSource.includes('queueVaultSync({ dateString: message.dateString, immediate: true })'));
  assert.ok(syncSource.includes('VAULT_EVENT_RECONNECT_MAX_MS'));
  assert.ok(syncSource.includes("document.visibilityState !== 'visible'"));
  assert.doesNotMatch(syncSource, /REMOTE_INDEX_POLL|pollRemoteVaultIndex|scheduleRemoteIndexPoll/);
  assert.equal(syncSource.includes('setInterval('), false);
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
  assert.match(syncSource, /await synchronizeVault\(\{[\s\S]*?dateStrings: dates,[\s\S]*?refreshAll: shouldRefreshAll,[\s\S]*?allowUploads: voiceAttachmentsReady/);
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


test('regular sign-in waits for full vault reconciliation before revealing the app', () => {
  const loginStart = sessionSource.indexOf('async function submitVaultLogin(event)');
  const signupStart = sessionSource.indexOf('async function submitVaultSignup(event)', loginStart);
  assert.ok(loginStart >= 0 && signupStart > loginStart);
  const login = sessionSource.slice(loginStart, signupStart);
  const onlineLogin = login.slice(login.indexOf('await establishDeviceSession(credentials, unlocked.membershipTicket);'));
  const restore = onlineLogin.indexOf('await startVaultSyncBeforeOpening(credentials)');
  const reveal = onlineLogin.indexOf('showApplication();', restore);
  assert.ok(restore >= 0 && reveal > restore);
  assert.match(sessionSource, /function showVaultSyncStartupWarning\(startup\)/);
  assert.match(sessionSource, /Some saved entries or voice notes are still queued/);
  assert.match(sessionSource, /No saved dates were returned by this account/);
  assert.match(syncSource, /localDateCount: finalLocalRecords\.length/);
  assert.match(syncSource, /pendingVoiceNoteHydrationDates\.add\(bundle\.dateString\)/);
  assert.match(syncSource, /pendingVoiceNoteHydrationDates\.delete\(bundle\.dateString\)/);
  assert.match(syncSource, /complete: pendingDates\.length === 0/);
  assert.match(syncSource, /voiceAttachmentsReady\s*\}/);
});

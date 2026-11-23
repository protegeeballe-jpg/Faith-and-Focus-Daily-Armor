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
  assert.match(startup, /uploadSummary\.pending === 0/);
  assert.match(startup, /synchronizeVault\(\{ refreshAll: true, forceRemoteRead: true \}\)/);
  assert.doesNotMatch(startup, /allowUploads|if \(voiceAttachmentsReady\)\s*\{\s*await synchronizeVault/);
  assert.match(syncSource, /async function restoreDailyBundle[\s\S]*?let voiceNotesReady = true/);
  assert.match(syncSource, /return \{ voiceNotesReady, applied: true \}/);
  assert.match(syncSource, /async function performVaultSync\(\{ dateStrings = \[\], refreshAll = false, forceRemoteRead = false \}/);
  assert.match(syncSource, /pendingVoiceNoteCount: voiceNoteStoreAvailable \? pendingVoiceNotes\.length : null/);
});

test('one failed date does not stop other dates from reconciling', () => {
  assert.match(syncSource, /const failedDates = \[\]/);
  assert.match(syncSource, /One date could not be reconciled; continuing with the remaining dates/);
  assert.match(syncSource, /Some encrypted dates or voice notes remain queued/);
});

test('full sign-in refresh rehydrates every indexed date even when local version metadata matches', () => {
  const startup = syncSource.slice(
    syncSource.indexOf('export async function startVaultSync(credentials) {'),
    syncSource.indexOf('function handleLocalDataChanged(event)')
  );
  assert.match(startup, /synchronizeVault\(\{ refreshAll: true, forceRemoteRead: true \}\)/);
  assert.match(syncSource, /async function reconcileDay\(dateString, remoteUpdatedAt, \{ forceRemoteRead = false \}/);
  assert.match(syncSource, /async function reconcileDayOnce\(dateString, remoteUpdatedAt, \{ forceRemoteRead = false \}/);
  assert.doesNotMatch(syncSource, /allowUploads/);
  const cleanRestore = syncSource.slice(syncSource.indexOf('const localRemote = local.remoteUpdatedAt'), syncSource.indexOf('export function selectVaultReconciliationDates'));
  assert.match(cleanRestore, /if \(forceRemoteRead \|\| remoteVersionChanged\)/);
  assert.match(cleanRestore, /const remote = await fetchRemoteDay\(dateString\)/);
  assert.match(cleanRestore, /await restoreDailyBundle\(bundle, \{ expectedLocalChangeVersion: localChangeVersion \}\)/);
  assert.match(cleanRestore, /await markLocalDailyPacketSynced\(/);
  assert.doesNotMatch(cleanRestore, /method: 'PUT'/);
});

test('sign-in capture preserves clean packets until the remote copy has been rehydrated', () => {
  const capture = syncSource.slice(
    syncSource.indexOf('async function captureExistingLocalDates()'),
    syncSource.indexOf('export async function startLocalVaultStorage(')
  );
  assert.match(capture, /const existing = await getLocalDailyPacket\(dateString\)/);
  assert.match(capture, /if \(existing && existing\.dirty !== true\) continue/);
  assert.match(capture, /await captureDailyPacket\(dateString\)/);
});

test('ADD can await one date-specific sync without forcing a full vault upload', () => {
  const start = syncSource.indexOf('export async function syncDailyDateNow(dateString)');
  const end = syncSource.indexOf('function queueVaultSync(', start);
  assert.ok(start >= 0 && end > start);
  const syncDate = syncSource.slice(start, end);
  assert.match(syncDate, /await captureDailyPacket\(dateString\)/);
  assert.match(syncDate, /await uploadPendingVoiceNoteAttachments\(dateString\)/);
  assert.match(syncDate, /synchronizeVault\(\{ dateStrings: \[dateString\] \}\)/);
  assert.doesNotMatch(syncDate, /allowUploads|voiceAttachmentsReady/);
  assert.match(syncDate, /error\?\.code === 'VAULT_SESSION_EXPIRED'/);
  assert.doesNotMatch(syncDate, /refreshAll:\s*true/);
  assert.match(syncDate, /localChangeSyncQueue\.catch\(\(\) => \{\}\)\.then/);
});

test('cross-device reconciliation avoids Cloudflare writes when the merged packet already matches remote', () => {
  assert.match(syncSource, /canonicalBundle\(mergedBundle\) === canonicalBundle\(remoteBundle\)/);
  assert.match(syncSource, /markLocalDailyPacketSynced\([\s\S]*?remote\.packet/);
  const resolver = syncSource.indexOf('await resolveLocalVoiceNoteIdentityConflicts(localBundle, remoteBundle)');
  const merge = syncSource.indexOf('await mergeDailyBundles(localBundle, remoteBundle', resolver);
  assert.ok(resolver >= 0 && merge > resolver, 'voice-note ID collisions must be resolved before bundle merging');
  assert.match(syncSource, /const filteredMergedBundle = await filterUnconfirmedVoiceNotes\(mergedBundle, remoteBundle\)/);
  assert.doesNotMatch(syncSource, /allowUploads/);
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
  assert.match(syncSource, /await synchronizeVault\(\{[\s\S]*?dateStrings: dates,[\s\S]*?refreshAll: shouldRefreshAll[\s\S]*?\}\)/);
  assert.doesNotMatch(syncSource, /allowUploads/);
  const queueStart = syncSource.indexOf('const operation = localChangeSyncQueue.catch(() => {}).then(async () => {', syncSource.indexOf('function queueVaultSync('));
  const queueEnd = syncSource.indexOf('localChangeSyncQueue = operation.catch', queueStart);
  const queuedOperation = syncSource.slice(queueStart, queueEnd);
  assert.ok(queuedOperation.indexOf('try {') < queuedOperation.indexOf('await uploadAllPendingVoiceNoteAttachments()'));
  assert.ok(queuedOperation.indexOf('await synchronizeVault({') > queuedOperation.indexOf('catch (error)'));
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
  assert.doesNotMatch(sessionSource, /showVaultSyncStartupWarning|Restoring your saved entries/);
  assert.match(syncSource, /localDateCount: finalLocalRecords\.length/);
  assert.match(syncSource, /pendingVoiceNoteHydrationDates\.add\(bundle\.dateString\)/);
  assert.match(syncSource, /pendingVoiceNoteHydrationDates\.delete\(bundle\.dateString\)/);
  assert.match(syncSource, /complete: pendingDates\.length === 0 && voiceNoteStoreAvailable/);
  assert.match(syncSource, /voiceAttachmentsReady\s*\}/);
});

test('voice-note attachment hydration failures do not gate merged daily packet publication', () => {
  const start = syncSource.indexOf('async function reconcileDayOnce(');
  const end = syncSource.indexOf('function canonicalBundle(', start);
  const reconcile = syncSource.slice(start, end);
  const publish = reconcile.indexOf("const result = await vaultRequest('/vault/' + activeVault.vaultId + '/day/' + dateString");
  assert.ok(publish > 0);
  assert.doesNotMatch(reconcile, /await hydrateVoiceNoteAttachments\(dateString, mergedBundle\.voiceNotes\)/);
  assert.match(reconcile, /Local manifests that have not been accepted by the Worker are excluded/);
  assert.match(reconcile, /A newer local edit was kept safely/);
});

test('conflicting local voice-note identifiers are re-keyed atomically before daily merge', () => {
  assert.match(syncSource, /async function resolveLocalVoiceNoteIdentityConflicts\(localBundle, remoteBundle\)/);
  assert.match(syncSource, /await rekeyEncryptedVoiceNoteRecord\(id, activeVault\.encryptionKey\)/);
  assert.match(syncSource, /\.filter\(note => !rekeyedIds\.has\(note\.id\)\)/);
  assert.match(syncSource, /currentLocal\.packet !== local\.packet/);
  assert.match(syncSource, /VOICE_NOTE_IDENTITY_CONFLICT/);
  assert.match(syncSource, /function sameVoiceNoteManifest\(/);
});

test('local voice-note upload state is included in reconciliation completeness', () => {
  assert.match(syncSource, /pendingVoiceNotes = \(await exportEncryptedVoiceNotes\(\)\)/);
  assert.match(syncSource, /\.filter\(record => record\.remoteUploaded !== true/);
  assert.match(syncSource, /pendingVoiceNotes\.map\(record => record\.dateString\)/);
  assert.match(syncSource, /complete: pendingDates\.length === 0 && voiceNoteStoreAvailable/);
});

test('remote voice-note identity recovery does not trigger a local capture before restore finishes', () => {
  const hydrateStart = syncSource.indexOf('async function hydrateVoiceNoteAttachments(');
  const hydrateEnd = syncSource.indexOf('async function captureDailyPacket(', hydrateStart);
  const hydrate = syncSource.slice(hydrateStart, hydrateEnd);
  assert.match(hydrate, /rekeyedLocalRecord = true/);
  assert.match(hydrate, /scheduleVoiceNoteUploadRetry\(dateString\)/);
  assert.doesNotMatch(hydrate, /scheduleCapture\(/);
  assert.match(syncSource, /if \(rekeyedLocalVoiceNote\) scheduleVoiceNoteUploadRetry\(bundle\.dateString\)/);
});

test('a missing voice-upload route is retryable without blocking daily reconciliation', () => {
  assert.match(syncSource, /response\.status === 404 && uploading\) error\.transient = true/);
  assert.match(syncSource, /if \(retryableFailure\) scheduleVoiceNoteUploadRetry\(dateString\)/);
  assert.match(syncSource, /daily packet reconciliation will continue independently/);
});

test('legacy embedded audio is retained before colliding identifiers are resolved', () => {
  assert.match(syncSource, /if \(!localRecord && typeof localPacketRecord\?\.ciphertext === 'string'\)/);
  assert.match(syncSource, /saveEncryptedVoiceNoteRecord\(localPacketRecord, \{ remoteUploaded: false \}\)/);
  assert.match(syncSource, /An embedded local voice recording could not be safely retained/);
  assert.match(syncSource, /scheduleVoiceNoteUploadRetry\(localBundle\.dateString\)/);
});

test('voice upload retry timers are cleared when a vault session ends or fails to start', () => {
  assert.match(syncSource, /function clearVoiceNoteUploadRetries\(\)/);
  assert.match(syncSource, /voiceUploadRetryTimers\.forEach\(timer => window\.clearTimeout\(timer\)\)/);
  const startup = syncSource.slice(
    syncSource.indexOf('export async function startVaultSync(credentials) {'),
    syncSource.indexOf('function handleLocalDataChanged(event)')
  );
  assert.match(startup, /clearVoiceNoteUploadRetries\(\)/);
  const stop = syncSource.slice(syncSource.indexOf('export async function stopVaultSync()'));
  assert.match(stop, /clearVoiceNoteUploadRetries\(\)/);
  assert.ok(
    stop.indexOf('clearVoiceNoteUploadRetries()') < stop.indexOf('await flushLocalVaultChanges()'),
    'retry timers must be cancelled before a session flush can await'
  );
});

test('voice-note identity reuse requires byte-exact remote attachment confirmation', () => {
  assert.match(syncSource, /async function voiceNoteContentMatchesRemoteAttachment\(localRecord, remoteRecord\)/);
  assert.match(syncSource, /remote\.ciphertextChunk !== expectedChunk/);
  assert.match(syncSource, /await voiceNoteContentMatchesRemoteAttachment\(retainedLocalRecord, remoteRecord\)/);
  assert.match(syncSource, /await voiceNoteContentMatchesRemoteAttachment\(local, note\)/);
  assert.match(syncSource, /markEncryptedVoiceNoteUploaded\(id, retainedLocalRecord\)/);
});

test('legacy inline audio is committed to IndexedDB before later attachment hydration can fail', () => {
  const start = syncSource.indexOf('async function hydrateVoiceNoteAttachments(');
  const end = syncSource.indexOf('async function captureDailyPacket(', start);
  const hydrate = syncSource.slice(start, end);
  const inline = hydrate.indexOf("if (typeof note.ciphertext === 'string')");
  const save = hydrate.indexOf('await saveEncryptedVoiceNoteRecord(note, { remoteUploaded: false })', inline);
  const readBack = hydrate.indexOf('await getEncryptedVoiceNoteRecord(note.id)', save);
  const laterDownload = hydrate.indexOf('await requestVoiceNoteAttachment(dateString, note.id', inline);
  assert.ok(inline >= 0 && save > inline && readBack > save && laterDownload > readBack);
  assert.match(hydrate, /A legacy encrypted voice recording could not be retained in local storage/);
});

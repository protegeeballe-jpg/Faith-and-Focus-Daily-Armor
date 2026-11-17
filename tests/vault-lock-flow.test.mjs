import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const session = readFileSync(new URL('../assets/vault-session.js', import.meta.url), 'utf8');
const writing = readFileSync(new URL('../assets/writing-security.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const vaultSync = readFileSync(new URL('../assets/vault-sync.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('account lock conceals every main application view before awaiting cleanup', () => {
  const lock = extract(
    session,
    'export async function lockAccount(',
    'export function isVaultAccountUnlocked()'
  );
  assert.ok(lock.indexOf('activeCredentials = null;') < lock.indexOf('await localSavePromise'));
  assert.ok(lock.indexOf('concealApplicationViews();') < lock.indexOf('await localSavePromise'));
  assert.ok(lock.indexOf('showLogin(message);') < lock.indexOf('await localSavePromise'));
  assert.match(lock, /revokeDeviceSession\(credentialsToRevoke\)/);
  assert.match(lock, /confirmed === true/);
  assert.match(lock, /await stopVaultSync\(\)/);
  assert.match(lock, /pendingSyncStartup\) await pendingSyncStartup/);
  assert.match(lock, /clearVaultEncryptionKey\(\)/);
  assert.doesNotMatch(lock, /resetInactivityTimer\(\)/);
});

test('the lock-time Diary flush snapshots visible text before its first await', () => {
  const flush = extract(
    writing,
    'export async function flushAndSaveCurrentPrivateWritingForLock()',
    '\n}\n'
  );
  const snapshotAt = flush.indexOf('getPrivateWritingPayload()');
  const firstAwaitAt = flush.indexOf('await ');
  assert.ok(snapshotAt >= 0);
  assert.ok(firstAwaitAt > snapshotAt);
  assert.match(flush, /enqueuePrivateWritingSnapshot\(dateStr,snapshot,key\)/);
});

test('locking clears decrypted writing, notebook content, location history and voice playback', () => {
  assert.match(app, /window\.addEventListener\('faith-focus:app-locked', concealUnlockedApplication\)/);
  assert.match(app, /document\.querySelectorAll\('#private-diary-entry,\.text-input'\)/);
  assert.match(app, /diary-archive-entry-written/);
  assert.match(app, /diary-archive-entry-locations/);
  assert.match(app, /diary-archive-entry-voice-notes/);
  assert.match(app, /diary-location-log/);
  assert.match(app, /diaryArchiveVoiceUrls\.forEach\(url => URL\.revokeObjectURL\(url\)\)/);
  assert.match(app, /clearDiaryVoiceNotePlayback\(\)/);
  assert.match(session, /\['view-launcher', 'little-garden', 'view-diary', 'view-checklist'\]/);
  assert.match(html, /class="fixed inset-0 bg-amber-50 z-50/);
});

test('stopping vault synchronization clears its in-memory context even when flushing fails', () => {
  const stop = extract(
    vaultSync,
    'export async function stopVaultSync() {',
    'export async function exportEncryptedVaultPackets() {'
  );
  assert.match(stop, /finally/);
  assert.match(stop, /activeVault = null/);
  assert.match(stop, /activeVaultRequestControllers\.clear\(\)/);
  assert.match(stop, /removeEventListener\('faith-focus:local-data-changed'/);
});


test('sign-in opens after local key setup while cloud reconciliation continues separately', () => {
  const login = extract(
    session,
    'async function submitVaultLogin(event) {',
    'async function submitVaultSignup(event) {'
  );
  const onlineLogin = login.slice(
    login.indexOf('await establishDeviceSession(credentials, unlocked.membershipTicket);')
  );
  assert.ok(onlineLogin.indexOf('adoptVaultEncryptionKey(credentials.encryptionKey, passphrase)')
    < onlineLogin.indexOf('startVaultSyncInBackground(credentials)'));
  assert.ok(onlineLogin.indexOf('startVaultSyncInBackground(credentials)')
    < onlineLogin.indexOf('showApplication()'));
  assert.doesNotMatch(onlineLogin, /await\s+startVaultSync\(credentials\)/);
  assert.match(session, /function startVaultSyncInBackground\(credentials\)/);
  assert.match(session, /await startVaultSync\(credentials\)/);
});

test('background synchronization cannot reattach after its account session is locked', () => {
  assert.match(vaultSync, /let vaultSyncGeneration = 0/);
  assert.match(vaultSync, /const generation = \+\+vaultSyncGeneration/);
  assert.match(vaultSync, /if \(!isCurrent\(\)\) return false/);
  assert.match(vaultSync, /export async function stopVaultSync\(\)/);
  assert.match(vaultSync, /vaultSyncGeneration \+= 1/);
});

test('checklist reflection text remains on the encrypted autosave path', () => {
  assert.match(app, /document\.querySelectorAll\('#private-diary-entry,\.text-input'\)\.forEach\(field=>\{\s*field\.addEventListener\('input',schedulePrivateWritingSave\)/s);
  assert.match(writing, /function schedulePrivateWritingSave\(\)/);
  assert.match(writing, /savePrivateWritingForDate\(writingLoadedDate\)/);
  assert.match(writing, /const PRIVATE_NOTE_IDS=\['note-success','note-priorities','note-gratitude-others','note-gratitude-god'\]/);
});

test('the account passphrase is reused for Diary migration only after cryptographic verification', () => {
  const login = extract(
    session,
    'async function submitVaultLogin(event) {',
    'async function submitVaultSignup(event) {'
  );
  const onlineLogin = login.slice(
    login.indexOf('credentials = await finishVaultLogin(account, loginMaterial, unlocked.passphraseEnvelope);')
  );
  const deriveAt = onlineLogin.indexOf('finishVaultLogin(account, loginMaterial, unlocked.passphraseEnvelope)');
  const adoptAt = onlineLogin.indexOf('adoptVaultEncryptionKey(credentials.encryptionKey, passphrase)');
  const clearAt = onlineLogin.indexOf("passphrase = ''", adoptAt);
  assert.ok(deriveAt >= 0 && adoptAt > deriveAt && clearAt > adoptAt);

  const verify = extract(
    writing,
    'async function derivePreviousWritingKeyFromPassphrase(passphrase){',
    'async function migratePreviousDiaryRecords(previousKey){'
  );
  assert.match(verify, /derivePrivateWritingKey\(passphrase/);
  assert.match(verify, /crypto\.subtle\.decrypt/);
  assert.match(verify, /WRITING_CHECK_TEXT/);
  assert.match(verify, /hasLegacyEncryptedRecordReadableWithKey\(key\)/);

  const adopt = extract(
    writing,
    'export async function adoptVaultEncryptionKey(key,accountPassphrase=\'\'){',
    'export function clearVaultEncryptionKey(){'
  );
  assert.match(adopt, /derivePreviousWritingKeyFromPassphrase\(accountPassphrase\)/);
  assert.match(adopt, /return \{legacyMigrationRequired:true,legacyKeyUnavailable\}/);
  assert.match(adopt, /Enter the previous Diary passphrase once/);
});

test('the sign-in route always conceals the app and does not expose a translucent background', () => {
  const showLogin = extract(
    session,
    'function showLogin(message =',
    'function scheduleInactivityCheck() {'
  );
  assert.match(showLogin, /concealApplicationViews\(\)/);
  assert.match(showLogin, /view-pin.*classList\.remove\('hidden'\)/s);
  assert.match(html, /bg-amber-50 z-50/);
});


test('legacy vault upgrade remains available after uniform sign-in responses', () => {
  const login = extract(
    session,
    'async function submitVaultLogin(event) {',
    'async function submitVaultSignup(event) {'
  );
  assert.match(login, /const beginLegacyUpgrade = async/);
  assert.match(login, /if \(unlockError\.status !== 401\)/);
  assert.match(login, /await beginLegacyUpgrade\(\)/);
  assert.match(login, /redirect: 'error'/);
});

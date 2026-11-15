import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasVerifiedDeviceSession } from '../assets/vault-sync.js';

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

test('local packets remain dirty until the cloud accepts their upload', () => {
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

test('there is no background sync trigger after the sign-in reconciliation', () => {
  assert.doesNotMatch(syncSource, /installVaultSyncRefresh|setInterval|scheduleCloudPush|cloudDebounceTimer|pendingCloudDates|handleOnline|refreshVaultFromForeground/);
  assert.equal((syncSource.match(/await synchronizeVault\(\)/g) || []).length, 2);
  assert.match(syncSource, /window\.addEventListener\('faith-focus:local-data-changed', handleLocalDataChanged\)/);
  assert.match(syncSource, /window\.addEventListener\('pagehide', flushLocalVaultChanges\)/);

  const flushStart = syncSource.indexOf('function flushLocalVaultChanges()');
  const flushEnd = syncSource.indexOf('export async function stopVaultSync()', flushStart);
  const flushSource = syncSource.slice(flushStart, flushEnd);
  assert.doesNotMatch(flushSource, /synchronizeVault|vaultRequest\(/);
});

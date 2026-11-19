import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sync = readFileSync(new URL('../assets/vault-sync.js', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../assets/local-backup.js', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../assets/vault-storage.js', import.meta.url), 'utf8');
const transaction = readFileSync(new URL('../assets/backup-import-transaction.js', import.meta.url), 'utf8');

function section(source, start, end) {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, 'Missing start section: ' + start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, 'Missing end section: ' + end);
    return source.slice(from, to);
}

test('backup import preflights encrypted daily packets and voice-note conflicts before mutation', () => {
    const importer = section(
        sync,
        'export async function importEncryptedVaultPackets(',
        'export async function listTrustedDevices()'
    );
    const packetPreflight = importer.indexOf('decryptDailyBundle(item.packet');
    const voicePreflight = importer.indexOf('const existingVoiceNotes = await exportEncryptedVoiceNotes()');
    const conflictCheck = importer.indexOf('existingVoiceById.get(record.id)');
    const snapshot = importer.indexOf('const previousLocalValues = new Map()');
    const firstMutation = importer.indexOf('await mergePrivateVoiceNotes(voiceNotes)');
    assert.ok(packetPreflight >= 0 && voicePreflight > packetPreflight);
    assert.ok(conflictCheck > voicePreflight && snapshot > conflictCheck);
    assert.ok(firstMutation > snapshot, 'No local records may change before preflight and snapshots finish');
});

test('backup import delegates mutations and all rollback stores to the runtime transaction', () => {
    const importer = section(
        sync,
        'export async function importEncryptedVaultPackets(',
        'export async function listTrustedDevices()'
    );
    assert.match(importer, /runBackupImportTransaction\\(\\{/);
    assert.match(importer, /apply: async \\(\\) =>/);
    assert.match(importer, /await mergePrivateVoiceNotes\\(voiceNotes\\)/);
    assert.match(importer, /await restoreDailyBundle\\(bundle, \\{ dispatch: false \\}\\)/);
    assert.match(importer, /await importLocalDailyPackets\\(packets\\)/);
    assert.match(importer, /restoreLocalDailyPacketState\\(existingDailyPackets, affectedDates\\)/);
    assert.match(importer, /for \\(const \\[key, value\\] of previousLocalValues\\)/);
    assert.match(importer, /await restorePrivateVoiceNotes\\(existingVoiceNotes\\)/);
    assert.match(transaction, /for \\(const step of rollback\\)/);
    assert.match(transaction, /rollbackErrors\\.length/);
});

test('successful backup import announces restored data only after commit and explicitly queues online sync', () => {
    const importer = section(
        sync,
        'export async function importEncryptedVaultPackets(',
        'export async function listTrustedDevices()'
    );
    const commit = importer.indexOf('await importLocalDailyPackets(packets)');
    const restoredEvent = importer.indexOf('faith-focus:vault-data-restored');
    const queue = importer.indexOf('queueVaultSync({ refreshAll: true, immediate: true })');
    assert.ok(commit >= 0 && restoredEvent > commit && queue > restoredEvent);
    assert.match(importer, /activeVault\.offlineOnly !== true/);
    assert.match(importer, /next verified online sign-in/);
});

test('the user-facing importer uses one combined transaction path for packets and voice notes', () => {
    assert.match(backup, /importEncryptedVaultPackets\(backup\.packets, \{ voiceNotes: backup\.voiceNotes \}\)/);
    assert.doesNotMatch(backup, /mergePrivateVoiceNotes\(backup\.voiceNotes\)/);
});

test('packet rollback restores or deletes all affected dates in one IndexedDB readwrite transaction', () => {
    const rollback = section(
        storage,
        'export async function restoreLocalDailyPacketState(',
        'export async function clearLocalDailyPackets()'
    );
    assert.match(rollback, /database\.transaction\(PACKET_STORE, 'readwrite'\)/);
    assert.match(rollback, /store\.put\(byDate\.get\(dateString\)\)/);
    assert.match(rollback, /store\.delete\(dateString\)/);
    assert.match(rollback, /await done/);
});

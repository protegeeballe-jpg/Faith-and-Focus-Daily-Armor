import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
    DAILY_RESET_MARKER_PREFIX,
    createDailyResetMarker,
    parseDailyResetMarker,
    compareDailyResetMarkers
} from '../assets/daily-reset.js';
import { readFileSync } from 'node:fs';

const dateString = '2026-11-13';

test('daily reset markers are unique, versioned, and validated', () => {
    const first = createDailyResetMarker(1_800_000_000_000, webcrypto);
    const second = createDailyResetMarker(1_800_000_000_000, webcrypto);
    assert.equal(first.version, 1);
    assert.equal(first.resetAt, 1_800_000_000_000);
    assert.match(first.resetId, /^[a-f0-9]{32}$/);
    assert.notEqual(first.resetId, second.resetId);
    assert.deepEqual(parseDailyResetMarker(JSON.stringify(first)), first);
    assert.equal(parseDailyResetMarker('not-json'), null);
    assert.equal(parseDailyResetMarker({ ...first, resetAt: -1 }), null);
    assert.equal(parseDailyResetMarker({ ...first, resetId: 'bad' }), null);
    assert.match(DAILY_RESET_MARKER_PREFIX, /^faith_focus_reset_marker_v1_$/);
});

test('a newer reset generation outranks older or absent reset history', () => {
    const oldMarker = { version: 1, resetAt: 1000, resetId: 'a'.repeat(32) };
    const newMarker = { version: 1, resetAt: 2000, resetId: 'b'.repeat(32) };
    assert.equal(compareDailyResetMarkers(oldMarker, newMarker), -1);
    assert.equal(compareDailyResetMarkers(newMarker, oldMarker), 1);
    assert.equal(compareDailyResetMarkers(null, newMarker), -1);
    assert.equal(compareDailyResetMarkers(newMarker, null), 1);
    assert.equal(compareDailyResetMarkers(oldMarker, oldMarker), 0);
});

test('local restoration respects a newer local reset and applies a newer incoming reset', () => {
    const sync = readFileSync(new URL('../assets/vault-sync.js', import.meta.url), 'utf8');
    const restoreStart = sync.indexOf('async function restoreDailyBundle(');
    const restoreEnd = sync.indexOf('async function fetchRemoteIndex()', restoreStart);
    assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
    const restore = sync.slice(restoreStart, restoreEnd);
    assert.match(restore, /localResetIsNewer/);
    assert.match(restore, /incomingResetIsCurrentOrNewer/);
    assert.match(restore, /if \(localResetIsNewer && resettableKeys\.has\(key\)\) continue/);
    assert.match(restore, /removeItem\(notesKey\)/);
    assert.match(restore, /replaceGarden: incomingResetIsCurrentOrNewer/);
    assert.match(restore, /preserveGarden: localResetIsNewer/);
});

test('checklist reset records its generation before deleting resettable local data', () => {
    const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
    const start = app.indexOf('async function resetDayData()');
    const end = app.indexOf('async function handleDiaryKeyActionWithLocationLogs()', start);
    assert.ok(start >= 0 && end > start);
    const reset = app.slice(start, end);
    const markerWrite = reset.indexOf('DAILY_RESET_MARKER_PREFIX + dateStr');
    const checklistDelete = reset.indexOf('localStorage.removeItem(getStorageKey(dateStr))');
    const notesDelete = reset.indexOf("localStorage.removeItem(getSecureWritingStorageKey('notes',dateStr))");
    const gardenDelete = reset.indexOf('localStorage.removeItem(GARDEN_STORAGE_KEY)');
    assert.ok(markerWrite >= 0);
    assert.ok(checklistDelete > markerWrite);
    assert.ok(notesDelete > markerWrite);
    assert.ok(gardenDelete > markerWrite);
    assert.match(reset, /Personal Diary entries and all location logs will be kept/);
});

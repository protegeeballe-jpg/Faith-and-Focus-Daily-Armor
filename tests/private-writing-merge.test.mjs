import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
    buildPrivateWritingDiaryPayload,
    buildPrivateWritingNotesPayload,
    MAX_PRIVATE_DIARY_NOTES_PER_DAY,
    MAX_PRIVATE_DIARY_NOTE_CHARS,
    isCurrentPrivateWritingDate,
    isValidDiaryArchiveDate,
    mergeEncryptedPrivateWritingRecords
} from '../assets/writing-security.js';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const dateString = '2026-11-13';
const encoder = new TextEncoder();
const NOTE_META = '__privateNoteUpdatedAt';
const DIARY_META = '__privateDiaryUpdatedAt';

function toBase64(value) {
    return Buffer.from(value).toString('base64');
}

async function encryptPrivateRecord(kind, value, key) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const additionalData = encoder.encode(
        'Daily Mindful Pokes|private-writing|' + kind + '|v1|' + dateString
    );
    const ciphertext = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
        key,
        encoder.encode(JSON.stringify(value))
    );
    return JSON.stringify({
        version: 1,
        algorithm: 'AES-256-GCM',
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext))
    });
}

async function decryptPrivateRecord(kind, record, key) {
    const encrypted = JSON.parse(record);
    const additionalData = encoder.encode(
        'Daily Mindful Pokes|private-writing|' + kind + '|v1|' + dateString
    );
    const plaintext = await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(encrypted.iv, 'base64'), additionalData, tagLength: 128 },
        key,
        Buffer.from(encrypted.ciphertext, 'base64')
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}

test('the newest Diary revision replaces older cloud text while reflection fields use their newest revision', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localDiaryValue = buildPrivateWritingDiaryPayload('Edited Diary text without the deleted passage', 'Original Diary text with deleted passage', 100, 300);
    const localDiary = await encryptPrivateRecord('diary', localDiaryValue, key);
    // Existing devices may still have the original string-only encrypted format.
    const remoteDiary = await encryptPrivateRecord('diary', 'Original Diary text with deleted passage', key);
    const localNotes = await encryptPrivateRecord('notes', {
        'note-success': 'Laptop success',
        'note-priorities': 'Laptop priority',
        [NOTE_META]: { 'note-success': 100, 'note-priorities': 100 }
    }, key);
    const remoteNotes = await encryptPrivateRecord('notes', {
        'note-success': 'Phone success edited later',
        'note-gratitude-god': 'Phone gratitude',
        [NOTE_META]: { 'note-success': 200, 'note-gratitude-god': 200 }
    }, key);

    const merged = await mergeEncryptedPrivateWritingRecords(dateString, {
        diary: localDiary,
        notes: localNotes
    }, {
        diary: remoteDiary,
        notes: remoteNotes
    }, key);

    const diary = await decryptPrivateRecord('diary', merged.diary, key);
    const notes = await decryptPrivateRecord('notes', merged.notes, key);
    assert.equal(diary.text, 'Edited Diary text without the deleted passage');
    assert.equal(diary[DIARY_META], 300);
    assert.equal(notes['note-success'], 'Phone success edited later');
    assert.equal(notes['note-priorities'], 'Laptop priority');
    assert.equal(notes['note-gratitude-god'], 'Phone gratitude');
    assert.equal(notes[NOTE_META]['note-success'], 200);
});

test('a cleared Diary entry is a real revision and cannot be resurrected by a legacy cloud copy', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localDiaryValue = buildPrivateWritingDiaryPayload('', 'The Diary passage I deleted', 0, 400);
    const localDiary = await encryptPrivateRecord('diary', localDiaryValue, key);
    const remoteDiary = await encryptPrivateRecord('diary', 'The Diary passage I deleted', key);

    const merged = await mergeEncryptedPrivateWritingRecords(
        dateString,
        { diary: localDiary },
        { diary: remoteDiary },
        key
    );
    const diary = await decryptPrivateRecord('diary', merged.diary, key);
    assert.equal(diary.text, '');
    assert.equal(diary[DIARY_META], 400);
});

test('saving a Diary replacement advances its revision, while an unchanged save keeps it', () => {
    const edited = buildPrivateWritingDiaryPayload(
        'Keep the remaining lines only',
        'Original Diary entry with a line to delete',
        100,
        200
    );
    const unchanged = buildPrivateWritingDiaryPayload(
        'Keep the remaining lines only',
        'Keep the remaining lines only',
        edited[DIARY_META],
        300
    );

    assert.equal(edited.text, 'Keep the remaining lines only');
    assert.equal(edited[DIARY_META], 200);
    assert.equal(unchanged[DIARY_META], 200);
});

test('legacy Diary strings remain readable as revision zero and resolve deterministically', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localDiary = await encryptPrivateRecord('diary', 'Local legacy text', key);
    const remoteDiary = await encryptPrivateRecord('diary', 'Remote legacy text', key);
    const merged = await mergeEncryptedPrivateWritingRecords(
        dateString,
        { diary: localDiary },
        { diary: remoteDiary },
        key
    );
    const diary = await decryptPrivateRecord('diary', merged.diary, key);
    assert.equal(diary.text, 'Remote legacy text');
    assert.equal(diary[DIARY_META], 0);
});

test('a newer blank note is retained as a deletion instead of restoring stale text', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const localNotes = await encryptPrivateRecord('notes', {
        'note-success': '',
        [NOTE_META]: { 'note-success': 300 }
    }, key);
    // A legacy record has no revision metadata and is therefore older than the explicit clear.
    const remoteNotes = await encryptPrivateRecord('notes', {
        'note-success': 'The note that was deleted'
    }, key);

    const merged = await mergeEncryptedPrivateWritingRecords(
        dateString,
        { notes: localNotes },
        { notes: remoteNotes },
        key
    );
    const notes = await decryptPrivateRecord('notes', merged.notes, key);

    assert.equal(notes['note-success'], '');
    assert.equal(notes[NOTE_META]['note-success'], 300);
});

test('saving a replacement or clearing a note advances only that note field revision', () => {
    const next = buildPrivateWritingNotesPayload(
        { 'note-success': '', 'note-priorities': 'Keep this priority' },
        { 'note-success': 'Old success', 'note-priorities': 'Keep this priority' },
        { 'note-success': 100, 'note-priorities': 50 },
        200
    );

    assert.equal(next['note-success'], '');
    assert.equal(next['note-priorities'], 'Keep this priority');
    assert.equal(next[NOTE_META]['note-success'], 200);
    assert.equal(next[NOTE_META]['note-priorities'], 50);
});

test('unreadable encrypted writing blocks the merge without changing either source record', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const local = JSON.stringify({ version: 1, algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' });
    const remote = JSON.stringify({ version: 1, algorithm: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'BBBBBBBBBBBBBBBBBBBBBB==' });

    await assert.rejects(
        mergeEncryptedPrivateWritingRecords(dateString, { diary: local, notes: null }, { diary: remote, notes: null }, key),
        /Both device copies remain preserved/
    );
    assert.equal(JSON.parse(local).version, 1);
    assert.equal(JSON.parse(remote).version, 1);
});


test('only the current device date is writable in the private Diary', () => {
    assert.equal(isCurrentPrivateWritingDate('2026-11-13', '2026-11-13'), true);
    assert.equal(isCurrentPrivateWritingDate('2026-11-12', '2026-11-13'), false);
    assert.equal(isCurrentPrivateWritingDate('2026-11-14', '2026-11-13'), false);
    assert.equal(isCurrentPrivateWritingDate('not-a-date', '2026-11-13'), false);
});


test('archived Diary reader accepts real calendar dates and rejects impossible dates', () => {
    assert.equal(isValidDiaryArchiveDate('2026-11-17'), true);
    assert.equal(isValidDiaryArchiveDate('2024-02-29'), true);
    assert.equal(isValidDiaryArchiveDate('2026-02-29'), false);
    assert.equal(isValidDiaryArchiveDate('2026-13-01'), false);
    assert.equal(isValidDiaryArchiveDate('not-a-date'), false);
});


test('separate notes created on two devices merge by unique id without replacing one another', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const laptopId = dateString + '-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const phoneId = dateString + '-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const sharedId = dateString + '-cccccccccccccccccccccccccccccccc';
    const localEntries = [
        { id: laptopId, createdAt: 100, updatedAt: 100, text: 'Laptop thought' },
        { id: sharedId, createdAt: 150, updatedAt: 200, text: 'Shared note, laptop edit' }
    ];
    const remoteEntries = [
        { id: phoneId, createdAt: 110, updatedAt: 110, text: 'Phone thought' },
        { id: sharedId, createdAt: 150, updatedAt: 300, text: 'Shared note, newer phone edit' }
    ];
    const localDiary = await encryptPrivateRecord(
        'diary',
        buildPrivateWritingDiaryPayload('Main entry', 'Main entry', 10, 100, localEntries, dateString),
        key
    );
    const remoteDiary = await encryptPrivateRecord(
        'diary',
        buildPrivateWritingDiaryPayload('Main entry', 'Main entry', 10, 100, remoteEntries, dateString),
        key
    );

    const merged = await mergeEncryptedPrivateWritingRecords(
        dateString,
        { diary: localDiary, notes: null },
        { diary: remoteDiary, notes: null },
        key
    );
    const diary = await decryptPrivateRecord('diary', merged.diary, key);
    const notesById = new Map(diary.entries.map(entry => [entry.id, entry]));

    assert.equal(diary.text, 'Main entry');
    assert.equal(diary.entries.length, 3);
    assert.equal(notesById.get(laptopId).text, 'Laptop thought');
    assert.equal(notesById.get(phoneId).text, 'Phone thought');
    assert.equal(notesById.get(sharedId).text, 'Shared note, newer phone edit');
    assert.equal(notesById.get(sharedId).updatedAt, 300);
});

test('new Diary notes reject malformed, duplicate, cross-date, and over-limit records', () => {
    const valid = {
        id: dateString + '-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        createdAt: 100,
        updatedAt: 100,
        text: 'A separate thought'
    };
    assert.throws(
        () => buildPrivateWritingDiaryPayload('Main', 'Main', 1, 200, [{
            ...valid, id: '2026-11-12-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        }], dateString),
        /identifier is invalid or duplicated/
    );
    assert.throws(
        () => buildPrivateWritingDiaryPayload('Main', 'Main', 1, 200, [valid, valid], dateString),
        /identifier is invalid or duplicated/
    );
    assert.throws(
        () => buildPrivateWritingDiaryPayload('Main', 'Main', 1, 200, [{
            ...valid, text: 'x'.repeat(MAX_PRIVATE_DIARY_NOTE_CHARS + 1)
        }], dateString),
        /invalid text or revision data/
    );
    const tooMany = Array.from({length:MAX_PRIVATE_DIARY_NOTES_PER_DAY + 1}, (_, index) => ({
        ...valid,
        id: dateString + '-' + String(index + 1).padStart(32, '0')
    }));
    assert.throws(
        () => buildPrivateWritingDiaryPayload('Main', 'Main', 1, 200, tooMany, dateString),
        /invalid number of additional notes/
    );
    const overDailyLimit = Array.from({length:MAX_PRIVATE_DIARY_NOTES_PER_DAY}, (_, index) => ({
        ...valid,
        id: dateString + '-' + String(index + 1).padStart(32, '0'),
        text: 'x'.repeat(MAX_PRIVATE_DIARY_NOTE_CHARS)
    }));
    assert.throws(
        () => buildPrivateWritingDiaryPayload('Main', 'Main', 1, 200, overDailyLimit, dateString),
        /supported daily writing limit/
    );
});

test('legacy string-only encrypted Diary entries remain compatible with separate note additions', async () => {
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const legacyDiary = await encryptPrivateRecord('diary', 'Original daily entry', key);
    const newNote = {
        id: dateString + '-dddddddddddddddddddddddddddddddd',
        createdAt: 400,
        updatedAt: 400,
        text: 'A note added by the newer app'
    };
    const currentDiary = await encryptPrivateRecord(
        'diary',
        buildPrivateWritingDiaryPayload('Original daily entry', 'Original daily entry', 0, 400, [newNote], dateString),
        key
    );
    const merged = await mergeEncryptedPrivateWritingRecords(
        dateString,
        { diary: legacyDiary, notes: null },
        { diary: currentDiary, notes: null },
        key
    );
    const diary = await decryptPrivateRecord('diary', merged.diary, key);
    assert.equal(diary.text, 'Original daily entry');
    assert.equal(diary.entries.length, 1);
    assert.equal(diary.entries[0].text, 'A note added by the newer app');
});

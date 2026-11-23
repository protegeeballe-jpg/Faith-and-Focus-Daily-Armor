import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    createVoiceNoteAttachmentManifest,
    decryptVoiceNoteRecord,
    decryptVoiceNoteSegment,
    encryptVoiceNoteBlob,
    encryptVoiceNoteSegment,
    isVoiceNoteAttachmentManifest,
    isAllowedVoiceNoteMimeType,
    validateEncryptedVoiceNoteBackup,
    validateEncryptedVoiceNoteRecord
} from '../assets/voice-note-store.js';

const DATE = '2026-11-10';
const ID = DATE + '-0123456789abcdef0123456789abcdef';

async function createKey() {
    return webcrypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

test('voice notes are encrypted and decrypt to the original recording bytes', async () => {
    const key = await createKey();
    const original = new Blob([new Uint8Array([0, 1, 2, 3, 128, 255, 42])], { type: 'audio/webm;codecs=opus' });
    const encrypted = await encryptVoiceNoteBlob(original, key, DATE, ID, '2026-11-10T12:00:00.000Z');

    assert.equal(validateEncryptedVoiceNoteRecord(encrypted), true);
    assert.equal(encrypted.algorithm, 'AES-256-GCM');
    assert.notEqual(encrypted.ciphertext, 'AAECA4D/Kg==');

    const restored = await decryptVoiceNoteRecord(encrypted, key);
    assert.equal(restored.type, original.type);
    assert.deepEqual(
        new Uint8Array(await restored.arrayBuffer()),
        new Uint8Array(await original.arrayBuffer())
    );
});

test('voice-note ciphertext is bound to its date and identifier', async () => {
    const key = await createKey();
    const encrypted = await encryptVoiceNoteBlob(
        new Blob(['private audio bytes'], { type: 'audio/webm' }),
        key,
        DATE,
        ID,
        '2026-11-10T12:00:00.000Z'
    );

    await assert.rejects(
        decryptVoiceNoteRecord({ ...encrypted, dateString: '2026-11-11' }, key)
    );
    await assert.rejects(
        decryptVoiceNoteRecord({ ...encrypted, id: DATE + '-ffffffffffffffffffffffffffffffff' }, key)
    );
});

test('voice-note backup validation rejects malformed records and duplicate identifiers', async () => {
    const key = await createKey();
    const valid = await encryptVoiceNoteBlob(
        new Blob(['private audio bytes'], { type: 'audio/webm' }),
        key,
        DATE,
        ID,
        '2026-11-10T12:00:00.000Z'
    );

    assert.equal(validateEncryptedVoiceNoteBackup([valid]), true);
    assert.equal(validateEncryptedVoiceNoteBackup([]), true);
    assert.equal(validateEncryptedVoiceNoteBackup([valid, valid]), false);
    assert.equal(validateEncryptedVoiceNoteBackup([{ ...valid, ciphertext: 'not base64!' }]), false);
    assert.equal(validateEncryptedVoiceNoteBackup({ records: [valid] }), false);
});


test('daily sync manifests omit audio ciphertext but retain authenticated attachment metadata', async () => {
    const key = await createKey();
    const full = await encryptVoiceNoteBlob(
        new Blob(['encrypted audio fixture bytes'], { type: 'audio/webm;codecs=opus' }),
        key,
        DATE,
        ID,
        '2026-11-10T12:00:00.000Z'
    );
    const manifest = createVoiceNoteAttachmentManifest(full);

    assert.equal(Object.hasOwn(manifest, 'ciphertext'), false);
    assert.equal(manifest.attachmentVersion, 1);
    assert.equal(manifest.ciphertextBytes, Buffer.from(full.ciphertext, 'base64').byteLength);
    assert.equal(manifest.ciphertextLength, full.ciphertext.length);
    assert.equal(manifest.attachmentChunkCount, 1);
    assert.equal(validateEncryptedVoiceNoteRecord(manifest), true);
    assert.equal(isVoiceNoteAttachmentManifest(manifest), true);
    assert.equal(validateEncryptedVoiceNoteBackup([manifest]), false);
    assert.equal(validateEncryptedVoiceNoteBackup([full]), true);
});

test('oversized voice-note manifests and ciphertext are rejected', () => {
    const base = {
        id: ID,
        dateString: DATE,
        version: 1,
        algorithm: 'AES-256-GCM',
        mimeType: 'audio/webm',
        capturedAt: '2026-11-10T12:00:00.000Z',
        iv: 'AAAAAAAAAAAAAAAA'
    };
    assert.equal(validateEncryptedVoiceNoteRecord({
        ...base,
        attachmentVersion: 1,
        ciphertextBytes: 16 * 1024 * 1024 + 17
    }), false);
});


test('progressive voice-note segments are encrypted independently and bound to their order', async () => {
    const key = await createKey();
    const draft = { id: ID, dateString: DATE, mimeType: 'audio/webm;codecs=opus' };
    const original = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: draft.mimeType });
    const encrypted = await encryptVoiceNoteSegment(original, key, draft, 7, draft.mimeType);

    assert.equal(encrypted.segmentId, ID + '-000007');
    assert.notEqual(encrypted.ciphertext, Buffer.from(await original.arrayBuffer()).toString('base64'));
    const restored = await decryptVoiceNoteSegment(encrypted, key);
    assert.deepEqual(
        new Uint8Array(await restored.arrayBuffer()),
        new Uint8Array(await original.arrayBuffer())
    );
    await assert.rejects(
        decryptVoiceNoteSegment({ ...encrypted, sequence: 8, segmentId: ID + '-000008' }, key)
    );
    await assert.rejects(
        decryptVoiceNoteSegment({ ...encrypted, voiceNoteId: DATE + '-ffffffffffffffffffffffffffffffff' }, key)
    );
});

test('recording drafts are indexed separately from completed voice notes', () => {
    const source = readFileSync(new URL('../assets/voice-note-store.js', import.meta.url), 'utf8');
    assert.match(source, /const VOICE_NOTE_DB_VERSION = 3/);
    assert.match(source, /createObjectStore\(RECORDING_DRAFT_STORE_NAME/);
    assert.match(source, /createObjectStore\(RECORDING_SEGMENT_STORE_NAME/);
    assert.match(source, /recoverEncryptedVoiceNoteDrafts/);
    assert.match(source, /VOICE_NOTE_DRAFT_RECOVERY_AGE_MS = 2 \* 60 \* 1000/);
});


test('voice-note MIME validation accepts supported codecs and rejects actual line breaks', () => {
    assert.equal(isAllowedVoiceNoteMimeType('audio/ogg;codecs=vorbis'), true);
    assert.equal(isAllowedVoiceNoteMimeType('audio/webm;codecs=opus'), true);
    assert.equal(isAllowedVoiceNoteMimeType('audio/ogg;codecs=vorbis\\n'), false);
    assert.equal(isAllowedVoiceNoteMimeType('audio/ogg;codecs=vorbis\\r'), false);
});

test('uploaded acknowledgement is conditional on the exact ciphertext snapshot', () => {
    const source = readFileSync(new URL('../assets/voice-note-store.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function markEncryptedVoiceNoteUploaded(');
    const end = source.indexOf('\n}\n', start);
    const acknowledgement = source.slice(start, end + 3);

    assert.match(acknowledgement, /markEncryptedVoiceNoteUploaded\(id, expectedRecord = null\)/);
    assert.match(acknowledgement, /current\.ciphertext !== expectedRecord\.ciphertext/);
    assert.match(acknowledgement, /current\.iv !== expectedRecord\.iv/);
    assert.match(acknowledgement, /return marked/);
});

test('saving a voice-note record never overwrites different ciphertext under an existing ID', () => {
    const source = readFileSync(new URL('../assets/voice-note-store.js', import.meta.url), 'utf8');
    const start = source.indexOf('export async function saveEncryptedVoiceNoteRecord(');
    const end = source.indexOf('\n}\n', start);
    const save = source.slice(start, end + 3);

    assert.match(save, /store\.get\(record\.id\)/);
    assert.match(save, /existing\.ciphertext !== record\.ciphertext/);
    assert.match(save, /transaction\.abort\(\)/);
    assert.match(save, /existing copy was not replaced/);
});

const VOICE_NOTE_DB_NAME = 'faith_focus_private_voice_notes_v1';
const VOICE_NOTE_DB_VERSION = 3;
const VOICE_NOTE_STORE_NAME = 'voiceNotes';
const LEGACY_QUARANTINE_STORE_NAME = 'legacyQuarantine';
const RECORDING_DRAFT_STORE_NAME = 'voiceNoteDrafts';
const RECORDING_SEGMENT_STORE_NAME = 'voiceNoteSegments';
const MAX_VOICE_NOTE_SEGMENT_BYTES = 2 * 1024 * 1024;
const VOICE_NOTE_DRAFT_RECOVERY_AGE_MS = 2 * 60 * 1000;
const VOICE_NOTE_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-([a-f0-9]{32})$/;
const VOICE_NOTE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_VOICE_NOTE_BYTES = 16 * 1024 * 1024;
export const MAX_VOICE_NOTE_DURATION_MS = 30 * 60 * 1000;
export const VOICE_NOTE_TARGET_BITRATE = 48_000;
export const VOICE_NOTE_ATTACHMENT_CHUNK_CHARS = 256 * 1024;
export const MAX_VOICE_NOTE_ATTACHMENT_CHUNKS = 100;
const ALLOWED_VOICE_NOTE_MIME_TYPES = new Set([
    'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg',
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/aac',
    'audio/3gpp', 'audio/3gpp2', 'audio/flac', 'audio/x-flac'
]);

export function isAllowedVoiceNoteMimeType(value) {
    if (typeof value !== 'string' || value.length > 128 || /[\r\n]/.test(value)) return false;
    const [mediaType, ...parameters] = value.toLowerCase().split(';').map(part => part.trim());
    if (!ALLOWED_VOICE_NOTE_MIME_TYPES.has(mediaType)) return false;
    return parameters.every(parameter => /^codecs=[a-z0-9._,-]+$/.test(parameter));
}


function isValidDateString(value) {
    if (typeof value !== 'string' || !VOICE_NOTE_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function getVoiceNoteAad(dateString, id, mimeType) {
    return new TextEncoder().encode(
        'Faith & Focus: Daily Armor|private-voice-note|v1|' + dateString + '|' + id + '|' + mimeType
    );
}

function getVoiceNoteSegmentAad(dateString, id, sequence, mimeType) {
    return new TextEncoder().encode(
        'Faith & Focus: Daily Armor|private-voice-note-segment|v1|' + dateString + '|' + id + '|' + sequence + '|' + mimeType
    );
}

function makeVoiceNoteId(dateString) {
    const random = crypto.getRandomValues(new Uint8Array(16));
    return dateString + '-' + Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function encryptVoiceNoteBlob(blob, key, dateString, id, capturedAt = new Date().toISOString()) {
    if (!(blob instanceof Blob) || blob.size === 0) {
        throw new TypeError('A non-empty voice recording is required.');
    }
    if (!isAllowedVoiceNoteMimeType(blob.type || 'audio/webm')) {
        throw new TypeError('This voice-note format is not supported. Use WebM, MP4, Ogg, WAV, AAC, or FLAC audio.');
    }
    if (!key || !isValidDateString(dateString)) {
        throw new TypeError('An unlocked Diary and valid date are required to save a voice note.');
    }
    if (typeof id !== 'string' || !VOICE_NOTE_ID_PATTERN.test(id) || !id.startsWith(dateString + '-')) {
        throw new TypeError('The voice-note identifier is invalid.');
    }

    const mimeType = blob.type || 'audio/webm';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: getVoiceNoteAad(dateString, id, mimeType),
        tagLength: 128
    }, key, await blob.arrayBuffer());

    return {
        id,
        dateString,
        version: 1,
        algorithm: 'AES-256-GCM',
        mimeType,
        capturedAt,
        iv: toBase64(iv),
        ciphertext: toBase64(ciphertext)
    };
}

export function createVoiceNoteAttachmentManifest(record) {
    if (!validateEncryptedVoiceNoteRecord(record) || typeof record.ciphertext !== 'string') {
        throw new TypeError('A complete encrypted voice note is required to create its attachment manifest.');
    }
    return {
        id: record.id,
        dateString: record.dateString,
        version: record.version,
        algorithm: record.algorithm,
        mimeType: record.mimeType,
        capturedAt: record.capturedAt,
        iv: record.iv,
        attachmentVersion: 1,
        ciphertextBytes: fromBase64(record.ciphertext).byteLength,
        ciphertextLength: record.ciphertext.length,
        attachmentChunkCount: Math.ceil(record.ciphertext.length / VOICE_NOTE_ATTACHMENT_CHUNK_CHARS)
    };
}

export function isVoiceNoteAttachmentManifest(record) {
    return validateEncryptedVoiceNoteRecord(record)
        && typeof record.ciphertext !== 'string'
        && record.attachmentVersion === 1;
}

export async function decryptVoiceNoteRecord(record, key) {
    if (!validateEncryptedVoiceNoteRecord(record) || typeof record.ciphertext !== 'string' || !key) {
        throw new TypeError('The encrypted voice note is invalid or the Diary is locked.');
    }
    const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: fromBase64(record.iv),
        additionalData: getVoiceNoteAad(record.dateString, record.id, record.mimeType),
        tagLength: 128
    }, key, fromBase64(record.ciphertext));
    return new Blob([plaintext], { type: record.mimeType });
}

export function validateEncryptedVoiceNoteRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    const match = typeof record.id === 'string' ? VOICE_NOTE_ID_PATTERN.exec(record.id) : null;
    if (!match || match[1] !== record.dateString || !isValidDateString(record.dateString)) return false;
    if (record.version !== 1 || record.algorithm !== 'AES-256-GCM') return false;
    if (!isAllowedVoiceNoteMimeType(record.mimeType)) return false;
    if (typeof record.capturedAt !== 'string' || !Number.isFinite(Date.parse(record.capturedAt))) return false;
    if (typeof record.iv !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.iv)) return false;
    try {
        if (fromBase64(record.iv).length !== 12) return false;
        if (typeof record.ciphertext === 'string') {
            return record.attachmentVersion === undefined
                && /^[A-Za-z0-9+/]+={0,2}$/.test(record.ciphertext)
                && fromBase64(record.ciphertext).length >= 16
                && fromBase64(record.ciphertext).length <= MAX_VOICE_NOTE_BYTES + 16;
        }
        return !Object.hasOwn(record, 'ciphertext')
            && record.attachmentVersion === 1
            && Number.isSafeInteger(record.ciphertextBytes)
            && record.ciphertextBytes >= 16
            && record.ciphertextBytes <= MAX_VOICE_NOTE_BYTES + 16
            && Number.isSafeInteger(record.ciphertextLength)
            && record.ciphertextLength === Math.ceil(record.ciphertextBytes / 3) * 4
            && Number.isSafeInteger(record.attachmentChunkCount)
            && record.attachmentChunkCount === Math.ceil(record.ciphertextLength / VOICE_NOTE_ATTACHMENT_CHUNK_CHARS)
            && record.attachmentChunkCount >= 1
            && record.attachmentChunkCount <= MAX_VOICE_NOTE_ATTACHMENT_CHUNKS;
    } catch (error) {
        return false;
    }
}

export function validateEncryptedVoiceNoteBackup(records) {
    return Array.isArray(records)
        && records.length <= 10000
        && records.every(record => validateEncryptedVoiceNoteRecord(record)
            && typeof record.ciphertext === 'string'
            && record.attachmentVersion === undefined)
        && new Set(records.map(record => record.id)).size === records.length;
}

function openVoiceNoteDatabase() {
    if (!globalThis.indexedDB) {
        return Promise.reject(new Error('This browser does not support secure local voice-note storage.'));
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(VOICE_NOTE_DB_NAME, VOICE_NOTE_DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(VOICE_NOTE_STORE_NAME)) {
                const store = database.createObjectStore(VOICE_NOTE_STORE_NAME, { keyPath: 'id' });
                store.createIndex('dateString', 'dateString', { unique: false });
            }
            if (!database.objectStoreNames.contains(LEGACY_QUARANTINE_STORE_NAME)) {
                database.createObjectStore(LEGACY_QUARANTINE_STORE_NAME, { keyPath: 'quarantineId' });
            }
            if (!database.objectStoreNames.contains(RECORDING_DRAFT_STORE_NAME)) {
                const drafts = database.createObjectStore(RECORDING_DRAFT_STORE_NAME, { keyPath: 'id' });
                drafts.createIndex('dateString', 'dateString', { unique: false });
            }
            if (!database.objectStoreNames.contains(RECORDING_SEGMENT_STORE_NAME)) {
                const segments = database.createObjectStore(RECORDING_SEGMENT_STORE_NAME, { keyPath: 'segmentId' });
                segments.createIndex('voiceNoteId', 'voiceNoteId', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open local voice-note storage.'));
        request.onblocked = () => reject(new Error('Local voice-note storage is busy in another app tab. Close the other tab and try again.'));
    });
}

function waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Voice-note storage failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Voice-note storage was interrupted.'));
    });
}

function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Voice-note storage request failed.'));
    });
}

export async function encryptVoiceNoteSegment(blob, key, draft, sequence, mimeType) {
    if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_VOICE_NOTE_SEGMENT_BYTES) {
        throw new RangeError('A recording segment must contain between 1 byte and 2 MB of audio.');
    }
    if (!key || !draft || !isValidDateString(draft.dateString)
        || typeof draft.id !== 'string' || !draft.id.startsWith(draft.dateString + '-')
        || !VOICE_NOTE_ID_PATTERN.test(draft.id)
        || !Number.isSafeInteger(sequence) || sequence < 0 || sequence >= 1000
        || !isAllowedVoiceNoteMimeType(mimeType)) {
        throw new TypeError('The encrypted voice-note segment details are invalid.');
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: getVoiceNoteSegmentAad(draft.dateString, draft.id, sequence, mimeType),
        tagLength: 128
    }, key, await blob.arrayBuffer());
    return {
        segmentId: draft.id + '-' + String(sequence).padStart(6, '0'),
        voiceNoteId: draft.id,
        dateString: draft.dateString,
        sequence,
        version: 1,
        algorithm: 'AES-256-GCM',
        mimeType,
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(ciphertext))
    };
}

export async function decryptVoiceNoteSegment(record, key) {
    if (!record || !key || record.version !== 1 || record.algorithm !== 'AES-256-GCM'
        || !isValidDateString(record.dateString)
        || !VOICE_NOTE_ID_PATTERN.test(record.voiceNoteId || '')
        || !record.voiceNoteId.startsWith(record.dateString + '-')
        || !Number.isSafeInteger(record.sequence) || record.sequence < 0 || record.sequence >= 1000
        || record.segmentId !== record.voiceNoteId + '-' + String(record.sequence).padStart(6, '0')
        || !isAllowedVoiceNoteMimeType(record.mimeType)
        || typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') {
        throw new TypeError('The encrypted voice-note segment is invalid or the Diary is locked.');
    }
    const iv = fromBase64(record.iv);
    const ciphertext = fromBase64(record.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > MAX_VOICE_NOTE_SEGMENT_BYTES + 16) {
        throw new TypeError('The encrypted voice-note segment has an invalid size.');
    }
    const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv,
        additionalData: getVoiceNoteSegmentAad(record.dateString, record.voiceNoteId, record.sequence, record.mimeType),
        tagLength: 128
    }, key, ciphertext);
    return new Blob([plaintext], { type: record.mimeType });
}

export async function createEncryptedVoiceNoteDraft(dateString, mimeType) {
    if (!isValidDateString(dateString) || !isAllowedVoiceNoteMimeType(mimeType)) {
        throw new TypeError('A valid Diary date and supported recording format are required.');
    }
    const draft = {
        id: makeVoiceNoteId(dateString),
        dateString,
        mimeType,
        capturedAt: new Date().toISOString(),
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(RECORDING_DRAFT_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        transaction.objectStore(RECORDING_DRAFT_STORE_NAME).add(draft);
        await completed;
        return draft;
    } finally {
        database.close();
    }
}

export async function saveEncryptedVoiceNoteSegment(draft, blob, key, sequence, mimeType = draft?.mimeType) {
    const record = await encryptVoiceNoteSegment(blob, key, draft, sequence, mimeType);
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction([RECORDING_DRAFT_STORE_NAME, RECORDING_SEGMENT_STORE_NAME], 'readwrite');
        const completed = waitForTransaction(transaction);
        const drafts = transaction.objectStore(RECORDING_DRAFT_STORE_NAME);
        const request = drafts.get(draft.id);
        request.onsuccess = () => {
            const storedDraft = request.result;
            if (!storedDraft || storedDraft.dateString !== draft.dateString || storedDraft.mimeType !== mimeType) {
                try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
                return;
            }
            transaction.objectStore(RECORDING_SEGMENT_STORE_NAME).add(record);
            drafts.put({ ...storedDraft, updatedAt: Date.now() });
        };
        request.onerror = () => {
            try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
        };
        await completed;
    } finally {
        database.close();
    }
}

async function readEncryptedVoiceNoteDraft(draftId) {
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction([RECORDING_DRAFT_STORE_NAME, RECORDING_SEGMENT_STORE_NAME], 'readonly');
        const completed = waitForTransaction(transaction);
        const draftPromise = waitForRequest(transaction.objectStore(RECORDING_DRAFT_STORE_NAME).get(draftId));
        const segmentsPromise = waitForRequest(transaction.objectStore(RECORDING_SEGMENT_STORE_NAME).index('voiceNoteId').getAll(draftId));
        const [draft, segments] = await Promise.all([draftPromise, segmentsPromise]);
        await completed;
        return { draft, segments };
    } finally {
        database.close();
    }
}

export async function discardEmptyEncryptedVoiceNoteDraft(draftId) {
    if (typeof draftId !== 'string' || !VOICE_NOTE_ID_PATTERN.test(draftId)) return false;
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction([RECORDING_DRAFT_STORE_NAME, RECORDING_SEGMENT_STORE_NAME], 'readwrite');
        const completed = waitForTransaction(transaction);
        const segmentStore = transaction.objectStore(RECORDING_SEGMENT_STORE_NAME);
        const request = segmentStore.index('voiceNoteId').getAll(draftId);
        request.onsuccess = () => {
            if (request.result.length) {
                try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
                return;
            }
            transaction.objectStore(RECORDING_DRAFT_STORE_NAME).delete(draftId);
        };
        request.onerror = () => {
            try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
        };
        await completed;
        return true;
    } finally {
        database.close();
    }
}

export async function finalizeEncryptedVoiceNoteDraft(draftId, key) {
    if (!key || typeof draftId !== 'string' || !VOICE_NOTE_ID_PATTERN.test(draftId)) {
        throw new TypeError('An unlocked Diary and valid recording draft are required.');
    }
    const { draft, segments } = await readEncryptedVoiceNoteDraft(draftId);
    if (!draft || !Array.isArray(segments) || !segments.length) {
        throw new Error('No saved audio segments were available to finish this recording.');
    }
    segments.sort((left, right) => left.sequence - right.sequence);
    const parts = [];
    let totalBytes = 0;
    for (let index = 0; index < segments.length; index += 1) {
        if (segments[index].sequence !== index) {
            throw new Error('A recording segment is missing. Its encrypted local data remains preserved.');
        }
        const part = await decryptVoiceNoteSegment(segments[index], key);
        totalBytes += part.size;
        if (totalBytes > MAX_VOICE_NOTE_BYTES) {
            throw new RangeError('The recording exceeded the local storage ceiling. Its encrypted segments remain preserved.');
        }
        parts.push(part);
    }
    const blob = new Blob(parts, { type: draft.mimeType });
    const record = await encryptVoiceNoteBlob(blob, key, draft.dateString, draft.id, draft.capturedAt);
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(
            [VOICE_NOTE_STORE_NAME, RECORDING_DRAFT_STORE_NAME, RECORDING_SEGMENT_STORE_NAME],
            'readwrite'
        );
        const completed = waitForTransaction(transaction);
        transaction.objectStore(VOICE_NOTE_STORE_NAME).add({ ...record, remoteUploaded: false });
        transaction.objectStore(RECORDING_DRAFT_STORE_NAME).delete(draft.id);
        const segmentStore = transaction.objectStore(RECORDING_SEGMENT_STORE_NAME);
        segments.forEach(segment => segmentStore.delete(segment.segmentId));
        await completed;
    } finally {
        database.close();
    }
    if (globalThis.window?.dispatchEvent && globalThis.CustomEvent) {
        globalThis.window.dispatchEvent(new CustomEvent('faith-focus:local-data-changed', {
            detail: { dateString: draft.dateString, voiceNote: true }
        }));
    }
    return { id: record.id, dateString: record.dateString, capturedAt: record.capturedAt };
}

export async function recoverEncryptedVoiceNoteDrafts(dateString, key) {
    if (!key || !isValidDateString(dateString)) {
        throw new TypeError('An unlocked Diary and valid date are required to recover recordings.');
    }
    const database = await openVoiceNoteDatabase();
    let drafts;
    try {
        const transaction = database.transaction(RECORDING_DRAFT_STORE_NAME, 'readonly');
        const completed = waitForTransaction(transaction);
        drafts = await waitForRequest(transaction.objectStore(RECORDING_DRAFT_STORE_NAME).index('dateString').getAll(dateString));
        await completed;
    } finally {
        database.close();
    }
    const recovered = [];
    const cutoff = Date.now() - VOICE_NOTE_DRAFT_RECOVERY_AGE_MS;
    for (const draft of drafts) {
        if (!draft || draft.updatedAt > cutoff) continue;
        try {
            recovered.push(await finalizeEncryptedVoiceNoteDraft(draft.id, key));
        } catch (error) {
            if (/No saved audio segments/.test(error?.message || '')) {
                await discardEmptyEncryptedVoiceNoteDraft(draft.id).catch(() => {});
            }
            console.warn('[Diary Voice Note] An interrupted encrypted recording remains preserved for recovery.', {
                recordingId: draft.id,
                reason: error?.message || String(error)
            });
        }
    }
    return recovered;
}

export async function saveEncryptedVoiceNote(dateString, blob, key) {
    if (!isValidDateString(dateString)) throw new TypeError('A valid Diary date is required.');
    if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_VOICE_NOTE_BYTES) {
        throw new RangeError('Each new voice note must contain between 1 byte and ' + Math.round(MAX_VOICE_NOTE_BYTES / 1024) + ' KB of audio.');
    }
    if (!isAllowedVoiceNoteMimeType(blob.type || 'audio/webm')) {
        throw new TypeError('This voice-note format is not supported.');
    }
    const id = makeVoiceNoteId(dateString);
    const record = await encryptVoiceNoteBlob(blob, key, dateString, id);
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        transaction.objectStore(VOICE_NOTE_STORE_NAME).add({ ...record, remoteUploaded: false });
        await completed;
        if (globalThis.window?.dispatchEvent && globalThis.CustomEvent) {
            globalThis.window.dispatchEvent(new CustomEvent('faith-focus:local-data-changed', {
                detail: { dateString: record.dateString, voiceNote: true }
            }));
        }
        return { id: record.id, dateString: record.dateString, capturedAt: record.capturedAt };
    } finally {
        database.close();
    }
}

async function getStoredRecords(dateString = null) {
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readonly');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = dateString
            ? store.index('dateString').getAll(dateString)
            : store.getAll();
        const records = await waitForRequest(request);
        await completed;
        return records;
    } finally {
        database.close();
    }
}

export async function exportEncryptedVoiceNotesForDateFull(dateString) {
    if (!isValidDateString(dateString)) throw new TypeError('A valid Diary date is required.');
    const records = await getStoredRecords(dateString);
    records.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
    return records.filter(record => typeof record.ciphertext === 'string');
}

export async function mergeEncryptedVoiceNotes(records) {
    if (!validateEncryptedVoiceNoteBackup(records)) throw new TypeError('The encrypted voice-note backup is invalid.');
    const existing = await getStoredRecords();
    const byId = new Map(existing.map(record => [record.id, record]));
    for (const record of records) {
        const previous = byId.get(record.id);
        if (previous && (previous.dateString !== record.dateString
            || previous.ciphertext !== record.ciphertext || previous.iv !== record.iv)) {
            throw new Error('A voice note with the same identifier already exists with different encrypted data. No recordings were replaced.');
        }
        if (!previous) byId.set(record.id, { ...record, remoteUploaded: false });
    }
    await restoreEncryptedVoiceNotes([...byId.values()].filter(record => typeof record.ciphertext === 'string'));
    return records.length;
}

export async function getEncryptedVoiceNoteRecord(id) {
    if (typeof id !== 'string' || !VOICE_NOTE_ID_PATTERN.test(id)) return null;
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readonly');
        const completed = waitForTransaction(transaction);
        const record = await waitForRequest(transaction.objectStore(VOICE_NOTE_STORE_NAME).get(id));
        await completed;
        return record && typeof record.ciphertext === 'string' ? record : null;
    } finally {
        database.close();
    }
}

export async function rekeyEncryptedVoiceNoteRecord(id, key) {
    if (typeof id !== 'string' || !VOICE_NOTE_ID_PATTERN.test(id) || !key) {
        throw new TypeError('An unlocked Diary and valid voice-note identifier are required.');
    }
    const original = await getEncryptedVoiceNoteRecord(id);
    if (!original) throw new Error('The conflicting local voice recording is no longer available.');
    const plaintext = await decryptVoiceNoteRecord(original, key);
    const replacementId = makeVoiceNoteId(original.dateString);
    if (replacementId === id) throw new Error('A new voice-note identifier could not be generated safely.');
    const replacement = await encryptVoiceNoteBlob(
        plaintext, key, original.dateString, replacementId, original.capturedAt
    );

    const database = await openVoiceNoteDatabase();
    let sourceChanged = false;
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            const current = request.result;
            if (!current || current.dateString !== original.dateString
                || current.capturedAt !== original.capturedAt
                || current.mimeType !== original.mimeType
                || current.version !== original.version
                || current.algorithm !== original.algorithm
                || current.ciphertext !== original.ciphertext
                || current.iv !== original.iv) {
                sourceChanged = true;
                try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
                return;
            }
            store.add({ ...replacement, remoteUploaded: false });
            store.delete(id);
        };
        request.onerror = () => {
            try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
        };
        try {
            await completed;
        } catch (error) {
            if (sourceChanged) {
                throw new Error('The local voice recording changed during conflict recovery. Its original copy was preserved.');
            }
            throw error;
        }
    } finally {
        database.close();
    }
    return { ...replacement, remoteUploaded: false };
}

export async function markEncryptedVoiceNoteUploaded(id, expectedRecord = null) {
    if (typeof id !== 'string' || !VOICE_NOTE_ID_PATTERN.test(id)) return false;
    const database = await openVoiceNoteDatabase();
    let marked = false;
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            const current = request.result;
            if (!current || typeof current.ciphertext !== 'string') return;
            if (expectedRecord && (
                current.dateString !== expectedRecord.dateString
                || current.capturedAt !== expectedRecord.capturedAt
                || current.mimeType !== expectedRecord.mimeType
                || current.version !== expectedRecord.version
                || current.algorithm !== expectedRecord.algorithm
                || current.ciphertext !== expectedRecord.ciphertext
                || current.iv !== expectedRecord.iv
            )) return;
            store.put({ ...current, remoteUploaded: true });
            marked = true;
        };
        await completed;
        return marked;
    } finally {
        database.close();
    }
}

export async function saveEncryptedVoiceNoteRecord(record, { remoteUploaded = false } = {}) {
    if (!validateEncryptedVoiceNoteBackup([record])) {
        throw new TypeError('A complete encrypted voice-note record is required.');
    }
    const database = await openVoiceNoteDatabase();
    let conflictingRecord = false;
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = store.get(record.id);
        request.onsuccess = () => {
            const existing = request.result;
            if (existing && (
                existing.dateString !== record.dateString
                || existing.capturedAt !== record.capturedAt
                || existing.mimeType !== record.mimeType
                || existing.version !== record.version
                || existing.algorithm !== record.algorithm
                || existing.ciphertext !== record.ciphertext
                || existing.iv !== record.iv
            )) {
                conflictingRecord = true;
                try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
                return;
            }
            store.put({
                ...record,
                remoteUploaded: remoteUploaded === true || existing?.remoteUploaded === true
            });
        };
        try {
            await completed;
        } catch (error) {
            if (conflictingRecord) {
                throw new Error('A different encrypted voice recording already uses this identifier. The existing copy was not replaced.');
            }
            throw error;
        }
    } finally {
        database.close();
    }
}

export async function loadEncryptedVoiceNotes(dateString, key) {
    if (!isValidDateString(dateString) || !key) {
        throw new Error('Unlock your Diary to load its saved voice notes.');
    }
    await recoverEncryptedVoiceNoteDrafts(dateString, key);
    const records = await getStoredRecords(dateString);
    records.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
    const notes = [];
    for (const record of records) {
        notes.push({
            id: record.id,
            dateString: record.dateString,
            capturedAt: record.capturedAt,
            blob: await decryptVoiceNoteRecord(record, key)
        });
    }
    return notes;
}

export async function exportEncryptedVoiceNotes() {
    const records = await getStoredRecords();
    records.sort((left, right) => {
        const dateOrder = left.dateString.localeCompare(right.dateString);
        return dateOrder || Date.parse(left.capturedAt) - Date.parse(right.capturedAt);
    });
    return records;
}

export async function quarantineLegacyWritingRecords(records) {
    if (!Array.isArray(records) || records.length > 10000
        || records.some(item => !item || typeof item.kind !== 'string' || !Object.prototype.hasOwnProperty.call(item, 'record'))) {
        throw new TypeError('The legacy writing quarantine payload is invalid.');
    }
    if (!records.length) return [];
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(LEGACY_QUARANTINE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(LEGACY_QUARANTINE_STORE_NAME);
        const ids = [];
        records.forEach((item, index) => {
            const random = crypto.getRandomValues(new Uint8Array(8));
            const suffix = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
            const quarantineId = 'legacy-' + Date.now().toString(36) + '-' + index + '-' + suffix;
            ids.push(quarantineId);
            store.add({
                quarantineId,
                version: 1,
                kind: item.kind,
                dateString: typeof item.dateString === 'string' ? item.dateString : null,
                originalId: item.id == null ? null : String(item.id),
                record: item.record,
                reason: String(item.reason || 'Unspecified legacy migration failure'),
                quarantinedAt: new Date().toISOString()
            });
        });
        await completed;
        return ids;
    } finally {
        database.close();
    }
}

export async function restoreEncryptedVoiceNotes(records) {
    if (!validateEncryptedVoiceNoteBackup(records)) {
        throw new Error('The backup contains invalid encrypted voice-note records.');
    }
    const database = await openVoiceNoteDatabase();
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        store.clear();
        records.forEach(record => store.put({ ...record, remoteUploaded: record.remoteUploaded === true }));
        await completed;
    } finally {
        database.close();
    }
}


export async function exportEncryptedVoiceNotesForDate(dateString) {
    if (!isValidDateString(dateString)) throw new TypeError('A valid Diary date is required.');
    const records = await getStoredRecords(dateString);
    records.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
    return records.filter(record => typeof record.ciphertext === 'string').map(createVoiceNoteAttachmentManifest);
}

export async function exportUploadedEncryptedVoiceNotesForDate(dateString) {
    if (!isValidDateString(dateString)) throw new TypeError('A valid Diary date is required.');
    const records = await getStoredRecords(dateString);
    records.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
    return records
        .filter(record => record.remoteUploaded === true && typeof record.ciphertext === 'string')
        .map(createVoiceNoteAttachmentManifest);
}

export async function restoreEncryptedVoiceNotesForDate(dateString, records) {
    if (!isValidDateString(dateString)
        || !validateEncryptedVoiceNoteBackup(records)
        || records.some(record => record.dateString !== dateString)) {
        throw new Error('The daily packet contains invalid voice-note records.');
    }
    const database = await openVoiceNoteDatabase();
    let conflictingLocalRecord = false;
    try {
        const transaction = database.transaction(VOICE_NOTE_STORE_NAME, 'readwrite');
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore(VOICE_NOTE_STORE_NAME);
        const request = store.index('dateString').getAll(dateString);
        request.onsuccess = () => {
            const existingRecords = request.result || [];
            const nextRecords = new Map(records.map(record => [
                record.id, { ...record, remoteUploaded: record.remoteUploaded === true }
            ]));

            // Unpublished recordings are local user data, not disposable cache.
            // Preserve them while replacing the cloud-confirmed portion.
            for (const existing of existingRecords) {
                const incoming = nextRecords.get(existing.id);
                if (existing.remoteUploaded !== true && !incoming) {
                    nextRecords.set(existing.id, existing);
                    continue;
                }
                if (existing.remoteUploaded !== true && incoming
                    && (existing.ciphertext !== incoming.ciphertext || existing.iv !== incoming.iv)) {
                    conflictingLocalRecord = true;
                    try { transaction.abort(); } catch { /* The transaction may already be closing. */ }
                    return;
                }
            }

            const nextIds = new Set(nextRecords.keys());
            for (const existing of existingRecords) {
                if (!nextIds.has(existing.id)) store.delete(existing.id);
            }
            for (const record of nextRecords.values()) store.put(record);
        };
        request.onerror = () => {
            try { transaction.abort(); } catch { /* The transaction may already be closed. */ }
        };
        try {
            await completed;
        } catch (error) {
            if (conflictingLocalRecord) {
                throw new Error('A pending local voice recording conflicts with the restored identifier. The local copy was preserved.');
            }
            throw error;
        }
    } finally {
        database.close();
    }
}

import { compressData, decompressData } from './compressor.js';
import {
  encodeBase64Url, encryptDailyBundle, decryptDailyBundle, isValidEncryptedPacket,
  isValidDateString
} from './vault-crypto.js';
import {
  getLocalDailyPacket, listLocalDailyPackets, putLocalDailyPacket, markLocalDailyPacketSynced
} from './vault-storage.js';
import {
  exportEncryptedVoiceNotes, exportEncryptedVoiceNotesForDate, exportUploadedEncryptedVoiceNotesForDate,
  exportEncryptedVoiceNotesForDateFull, restoreEncryptedVoiceNotesForDate, getEncryptedVoiceNoteRecord,
  markEncryptedVoiceNoteUploaded, rekeyEncryptedVoiceNoteRecord, saveEncryptedVoiceNoteRecord,
  createVoiceNoteAttachmentManifest, validateEncryptedVoiceNoteRecord,
  VOICE_NOTE_ATTACHMENT_CHUNK_CHARS, MAX_VOICE_NOTE_ATTACHMENT_CHUNKS
} from './voice-note-store.js';
import { GARDEN_STORAGE_KEY, GARDEN_DAILY_SYNC_PREFIX, mergeGardenStates, validateGardenState } from './garden-model.js';
import { mergeDailyBundles } from './daily-merge.js';
import { DAILY_RESET_MARKER_PREFIX, parseDailyResetMarker, compareDailyResetMarkers } from './daily-reset.js';
import { flushAndSaveCurrentPrivateWriting, stopRegisteredVoiceNoteRecording, mergeEncryptedPrivateWritingRecords, validatePrivateVoiceNoteBackup, restorePrivateVoiceNotes, mergePrivateVoiceNotes } from './writing-security.js';
import { runBackupImportTransaction } from './backup-import-transaction.js';

const WORKER_ORIGIN = 'https://faith-focus-proxy.nine-westhigh.workers.dev';
const APP_CLIENT = 'faith-focus-daily-armor-web/1';
const MAX_DAILY_PACKET_BYTES = 1024 * 1024;
const MAX_DATE_RECONCILE_ATTEMPTS = 4;
const DAILY_RECORD_PREFIXES = [
  'mindful_pokes_data_',
  'score_awarded_',
  'dmp_diary_cipher_v1_',
  'dmp_notes_cipher_v1_',
  'faith_focus_location_checkins_v1_',
  DAILY_RESET_MARKER_PREFIX,
  GARDEN_DAILY_SYNC_PREFIX
];
const LEGACY_WRITING_CONFIG_KEY = 'dmp_private_writing_crypto_v1';

let activeVault = null;
let pendingVoiceNoteHydrationDates = new Set();
let vaultSyncInitializing = false;
let vaultLocalListenersInstalled = false;
let vaultOnlineListenerInstalled = false;
let vaultSyncGeneration = 0;
let applyingRemotePacket = 0;
let syncQueue = Promise.resolve();
let localChangeSyncQueue = Promise.resolve();
let pendingDailySyncDates = new Set();
let dailySyncTimer = null;
let vaultEventSocket = null;
let vaultEventReconnectTimer = null;
let vaultEventReconnectFailures = 0;
let pendingFullVaultRefresh = false;
let lastCloudSyncStartedAt = 0;
let lastForegroundSyncAt = 0;
const DAILY_SYNC_DEBOUNCE_MS = 1200;
const DAILY_SYNC_MIN_INTERVAL_MS = 3500;
const FOREGROUND_SYNC_MIN_INTERVAL_MS = 5000;
const VAULT_EVENT_RECONNECT_BASE_MS = 1500;
const VAULT_EVENT_RECONNECT_MAX_MS = 30_000;
let localCaptureQueues = new Map();
let localChangeVersions = new Map();
let lastStatus = '';
let storageHooksInstalled = false;
let localFlushPromise = null;
let activeVaultRequestControllers = new Set();
let voiceUploadRetryTimers = new Map();
let voiceUploadRetryAttempts = new Map();

const byId = id => document.getElementById(id);

function installVaultLocalListeners() {
  if (vaultLocalListenersInstalled) return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
  window.addEventListener('pagehide', flushLocalVaultChanges);
  vaultLocalListenersInstalled = true;
}

function installVaultOnlineListener() {
  if (vaultOnlineListenerInstalled) return;
  window.addEventListener('online', handleOnline);
  vaultOnlineListenerInstalled = true;
}

function removeVaultSyncListeners() {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('pagehide', flushLocalVaultChanges);
  closeVaultEventSocket();
  vaultLocalListenersInstalled = false;
  vaultOnlineListenerInstalled = false;
}

export function hasVerifiedDeviceSession(credentials) {
  return Boolean(credentials?.vaultId
    && credentials.encryptionKey
    && credentials.writeToken instanceof Uint8Array
    && typeof credentials.vaultMembershipTicket === 'string'
    && credentials.vaultMembershipTicket.length >= 40
    && typeof credentials.deviceId === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(credentials.deviceId)
    && typeof credentials.deviceSessionToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(credentials.deviceSessionToken)
    && Number.isFinite(credentials.deviceSessionExpiresAt)
    && credentials.deviceSessionExpiresAt > Date.now());
}

function status(message, state = 'info') {
  if (message === lastStatus && state !== 'error') return;
  lastStatus = message;
  const target = byId('vault-sync-status');
  if (target) {
    target.textContent = message;
    target.dataset.state = state;
  }
  const indicator = byId('vault-sync-indicator');
  if (indicator) {
    indicator.dataset.state = state;
    indicator.textContent = activeVault?.offlineOnly === true
      ? '● Saved locally'
      : state === 'success' ? '● Synced' : state === 'error' ? '● Sync error / offline' : '● Syncing…';
    indicator.setAttribute('aria-label', indicator.textContent.trim());
  }
  console.log('[Vault Sync] Status:', state, message, activeVault ? { vaultId: activeVault.vaultId } : { vaultId: null });
  window.dispatchEvent(new CustomEvent('faith-focus:vault-sync-status', { detail: { message, state } }));
}

function matchesDailyKey(key, dateString) {
  return DAILY_RECORD_PREFIXES.some(prefix => key === prefix + dateString);
}

function dateFromDailyKey(key) {
  for (const prefix of DAILY_RECORD_PREFIXES) {
    if (key.startsWith(prefix)) {
      const dateString = key.slice(prefix.length);
      if (isValidDateString(dateString)) return dateString;
    }
  }
  return null;
}

function isDailyRecordKey(key) {
  return DAILY_RECORD_PREFIXES.some(prefix => {
    const dateString = key.slice(prefix.length);
    return key.startsWith(prefix) && isValidDateString(dateString);
  });
}

function getCurrentDateString() {
  const value = byId('currentDate')?.value;
  if (isValidDateString(value)) return value;
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function validateDailyBundleForEncryption(bundle, expectedDate) {
  const fail = reason => { throw new Error('Daily packet validation failed: ' + reason); };
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
      || bundle.format !== 'faith-focus-daily-bundle' || bundle.version !== 1
      || bundle.dateString !== expectedDate || !isValidDateString(bundle.dateString)) {
    fail('the bundle header or calendar date is invalid.');
  }
  if (!bundle.records || typeof bundle.records !== 'object' || Array.isArray(bundle.records)) {
    fail('daily records must be a plain object.');
  }
  const recordKeys = Object.keys(bundle.records);
  if (recordKeys.length > DAILY_RECORD_PREFIXES.length) fail('too many daily record keys were supplied.');
  for (const [key, value] of Object.entries(bundle.records)) {
    if (!DAILY_RECORD_PREFIXES.some(prefix => key === prefix + expectedDate)) {
      fail('unexpected daily record key: ' + String(key).slice(0, 80));
    }
    if (typeof value !== 'string') fail('daily record values must be strings.');
  }

  const checklistKey = 'mindful_pokes_data_' + expectedDate;
  if (typeof bundle.records[checklistKey] !== 'string') fail('the daily checklist record is missing.');
  let checklist;
  try { checklist = JSON.parse(bundle.records[checklistKey]); }
  catch { fail('the daily checklist record is not valid JSON.'); }
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    fail('the daily checklist record must contain a JSON object.');
  }

  const gardenRecordKey = GARDEN_DAILY_SYNC_PREFIX + expectedDate;
  if (Object.hasOwn(bundle.records, gardenRecordKey)) {
    let gardenSnapshot;
    try { gardenSnapshot = JSON.parse(bundle.records[gardenRecordKey]); }
    catch { fail('the daily Garden snapshot is not valid JSON.'); }
    if (!validateGardenState(gardenSnapshot)) fail('the daily Garden snapshot is invalid.');
  }
  if (Object.hasOwn(bundle.records, DAILY_RESET_MARKER_PREFIX + expectedDate)
      && !parseDailyResetMarker(bundle.records[DAILY_RESET_MARKER_PREFIX + expectedDate])) {
    fail('the daily reset marker is invalid.');
  }

  if (!Array.isArray(bundle.voiceNotes) || bundle.voiceNotes.length > 100) {
    fail('voice notes must be an array containing no more than 100 records.');
  }
  const voiceIds = new Set();
  for (const note of bundle.voiceNotes) {
    if (!validateEncryptedVoiceNoteRecord(note) || note.dateString !== expectedDate) {
      fail('a voice-note record is malformed, unsupported, or belongs to another date.');
    }
    if (voiceIds.has(note.id)) fail('duplicate voice-note identifiers were found.');
    voiceIds.add(note.id);
  }

  if (bundle.appState !== null && bundle.appState !== undefined) {
    if (typeof bundle.appState !== 'object' || Array.isArray(bundle.appState)) {
      fail('app state must be an object.');
    }
    for (const key of ['garden', 'confidenceScore', 'legacyWritingConfig']) {
      const value = bundle.appState[key];
      if (value !== null && value !== undefined && typeof value !== 'string') {
        fail('app state field ' + key + ' must be a string or null.');
      }
    }
  }

  const serializedBytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
  if (serializedBytes > 2 * 1024 * 1024) {
    fail('the uncompressed daily bundle exceeds the 2 MiB frontend safety limit.');
  }
  return serializedBytes;
}

async function buildDailyBundle(dateString) {
  const records = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !matchesDailyKey(key, dateString)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) records[key] = value;
  }

  // Always represent every checklist item in each date bundle. Missing historical
  // values are explicit false states rather than omitted checklist controls.
  const checklistKey = 'mindful_pokes_data_' + dateString;
  let checklist = {};
  try {
    const existing = records[checklistKey];
    checklist = existing ? JSON.parse(existing) : {};
    if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) checklist = {};
  } catch {
    checklist = {};
  }
  const isCurrentDate = dateString === getCurrentDateString();
  document.querySelectorAll('.app-chk').forEach(checkbox => {
    const id = checkbox.dataset.id;
    if (!id) return;
    if (isCurrentDate) {
      checklist[id] = checkbox.checked === true;
      checklist[id + '__guided'] = checkbox.dataset.guideUnlocked === 'true' || checkbox.checked === true;
    } else {
      if (typeof checklist[id] !== 'boolean') checklist[id] = false;
      if (typeof checklist[id + '__guided'] !== 'boolean') checklist[id + '__guided'] = false;
    }
  });
  document.querySelectorAll('.cloud-item[data-cloud]').forEach(item => {
    const key = 'cloud_' + item.dataset.cloud;
    if (isCurrentDate) checklist[key] = item.dataset.released === 'true';
    else if (typeof checklist[key] !== 'boolean') checklist[key] = false;
  });
  checklist.cloud_flow_version = 2;
  records[checklistKey] = JSON.stringify(checklist);

  // Keep the current Garden snapshot inside every newly captured daily packet.
  // It is merged independently from checklist records when a date conflict exists.
  const gardenRecordKey = GARDEN_DAILY_SYNC_PREFIX + dateString;
  const gardenSnapshot = localStorage.getItem(GARDEN_STORAGE_KEY);
  if (gardenSnapshot !== null) records[gardenRecordKey] = gardenSnapshot;
  else delete records[gardenRecordKey];

  const voiceNotes = await exportUploadedEncryptedVoiceNotesForDate(dateString);
  return {
    format: 'faith-focus-daily-bundle',
    version: 1,
    dateString,
    createdAt: new Date().toISOString(),
    records,
    voiceNotes,
    appState: {
      garden: localStorage.getItem(GARDEN_STORAGE_KEY),
      confidenceScore: localStorage.getItem('user_confidence_score'),
      legacyWritingConfig: localStorage.getItem(LEGACY_WRITING_CONFIG_KEY)
    }
  };
}

function listLocalStorageDates() {
  const dates = new Set();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    const dateString = key ? dateFromDailyKey(key) : null;
    if (dateString) dates.add(dateString);
  }
  return [...dates].sort();
}

async function getCredentialHeaders() {
  if (!activeVault) throw new Error('Your account is locked.');
  if (typeof activeVault.vaultMembershipTicket !== 'string'
      || typeof activeVault.deviceSessionToken !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(activeVault.deviceSessionToken)
      || !Number.isFinite(activeVault.deviceSessionExpiresAt)
      || activeVault.deviceSessionExpiresAt <= Date.now()) {
    const error = new Error('Your device session has expired. Sign in again to securely reconnect this device.');
    error.code = 'VAULT_SESSION_EXPIRED';
    throw error;
  }
  return {
    Accept: 'application/json',
    'X-App-Client': APP_CLIENT,
    'X-Vault-Membership': activeVault.vaultMembershipTicket,
    'X-Device-Session': activeVault.deviceSessionToken
  };
}

async function vaultRequest(path, { method = 'GET', body = null, baseUpdatedAt } = {}) {
  if (activeVault?.offlineOnly === true) {
    throw new Error('Cloud access is unavailable in local-only mode.');
  }
  const headers = await getCredentialHeaders();
  let bodyText = null;
  if (body !== null) {
    bodyText = JSON.stringify(body);
    if (new TextEncoder().encode(bodyText).byteLength > MAX_DAILY_PACKET_BYTES) {
      throw new Error('This daily packet is larger than 1 MB. Your local data remains saved, but it cannot be sent to the cloud yet.');
    }
    headers['Content-Type'] = 'application/json';
  }
  if (baseUpdatedAt !== undefined) headers['X-Base-Updated-At'] = baseUpdatedAt || 'none';

  let response;
  const requestController = new AbortController();
  activeVaultRequestControllers.add(requestController);
  console.log('[Vault Sync] Worker request started:', { vaultId: activeVault?.vaultId || null, method, path });
  try {
    response = await fetch(WORKER_ORIGIN + path, {
      method,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body: bodyText,
      signal: requestController.signal
    });
  } catch (error) {
    console.error('[Vault Sync] Worker network failure:', { vaultId: activeVault?.vaultId || null, method, path, error });
    throw new Error('Cloud sync is temporarily unavailable. Your encrypted daily packets remain saved locally.');
  } finally {
    activeVaultRequestControllers.delete(requestController);
  }

  let result = {};
  try { result = await response.json(); } catch { result = {}; }
  console.log('[Vault Sync] Worker response:', {
    vaultId: activeVault?.vaultId || null, method, path, httpStatus: response.status, ok: response.ok,
    error: result.error || null, updatedAt: result.updatedAt || null,
    remoteDateCount: result.index && typeof result.index === 'object' ? Object.keys(result.index).length : undefined
  });
  if (!response.ok) {
    if (response.status === 401) {
      const error = new Error('This device session is no longer valid. Sign in again to securely reconnect this device.');
      error.code = 'VAULT_SESSION_EXPIRED';
      throw error;
    }
    if (response.status === 409) {
      const error = new Error(result.error || 'This date changed on another device. Your local packet was kept.');
      error.code = 'VAULT_CONFLICT';
      error.updatedAt = result.updatedAt || null;
      throw error;
    }
    if (response.status === 413) throw new Error('The cloud service rejected a packet larger than 1 MB. Your local packet remains available.');
    if (response.status === 429) throw new Error(result.error || 'Too many attempts. Please wait one minute.');
    if (response.status === 503) throw new Error(result.error || 'The Cloudflare vault service is not fully configured yet.');
    throw new Error(result.error || 'Cloud sync failed (HTTP ' + response.status + ').');
  }
  return result;
}

async function requestVoiceNoteAttachment(dateString, id, {
  index = 0,
  ciphertextChunk,
  ciphertextLength,
  totalChunks
} = {}) {
  if (!activeVault || activeVault.offlineOnly === true) {
    throw new Error('Voice-note cloud access requires an active online device session.');
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_VOICE_NOTE_ATTACHMENT_CHUNKS) {
    throw new TypeError('The encrypted voice-note chunk index is invalid.');
  }
  const headers = await getCredentialHeaders();
  const uploading = ciphertextChunk !== undefined;
  if (uploading) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  activeVaultRequestControllers.add(controller);
  const path = '/vault/' + activeVault.vaultId + '/voice-note/' + dateString + '/' + id + '/' + index;
  try {
    const response = await fetch(WORKER_ORIGIN + path, {
      method: uploading ? 'PUT' : 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body: uploading ? JSON.stringify({
        id, dateString, index, totalChunks, ciphertextLength, ciphertextChunk
      }) : undefined,
      signal: controller.signal
    });
    let result = {};
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      if (response.status === 404 && !uploading) return null;
      const error = new Error(
        result.error || 'Voice-note synchronization failed (HTTP ' + response.status + ').'
      );
      error.status = response.status;
      error.response = result;
      if (response.status === 401) error.code = 'VAULT_SESSION_EXPIRED';
      if (response.status === 409) error.code = 'VOICE_NOTE_CONFLICT';
      if (response.status === 404 && uploading) error.transient = true;
      if (response.status === 429 || response.status >= 500) error.transient = true;
      throw error;
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'NetworkError') {
      const networkError = new Error('Voice-note synchronization is temporarily unavailable. The encrypted recording remains saved on this device.');
      networkError.transient = true;
      networkError.cause = error;
      throw networkError;
    }
    throw error;
  } finally {
    activeVaultRequestControllers.delete(controller);
  }
}

function scheduleVoiceNoteUploadRetry(dateString) {
  if (!isValidDateString(dateString) || voiceUploadRetryTimers.has(dateString)) return;
  const attempt = (voiceUploadRetryAttempts.get(dateString) || 0) + 1;
  voiceUploadRetryAttempts.set(dateString, attempt);
  const delay = Math.min(5 * 60_000, 5_000 * (2 ** Math.min(attempt - 1, 6)));
  const timer = window.setTimeout(() => {
    voiceUploadRetryTimers.delete(dateString);
    if (activeVault && activeVault.offlineOnly !== true && window.navigator?.onLine !== false) {
      queueVaultSync({ dateString });
    }
  }, delay);
  voiceUploadRetryTimers.set(dateString, timer);
}

function clearVoiceNoteUploadRetry(dateString) {
  const timer = voiceUploadRetryTimers.get(dateString);
  if (timer !== undefined) window.clearTimeout(timer);
  voiceUploadRetryTimers.delete(dateString);
  voiceUploadRetryAttempts.delete(dateString);
}

async function resolveVoiceNoteChunkConflict(dateString, record, index, expectedChunk, ciphertextLength, totalChunks) {
  // A 409 is only treated as an idempotent success after a read proves that
  // the exact encrypted bytes and attachment metadata already exist remotely.
  const firstChunk = await requestVoiceNoteAttachment(dateString, record.id, { index: 0 });
  if (!firstChunk) return 'conflict';
  if (firstChunk.id !== record.id || firstChunk.dateString !== dateString
      || firstChunk.ciphertextLength !== ciphertextLength
      || firstChunk.totalChunks !== totalChunks) return 'conflict';

  const existing = index === 0
    ? firstChunk
    : await requestVoiceNoteAttachment(dateString, record.id, { index });
  if (!existing) return 'conflict';
  if (existing.id === record.id && existing.dateString === dateString
      && existing.index === index && existing.totalChunks === totalChunks
      && existing.ciphertextLength === ciphertextLength
      && existing.ciphertextChunk === expectedChunk) return 'already-stored';
  return 'conflict';
}

async function uploadVoiceNoteRecord(dateString, initialRecord) {
  let record = initialRecord;
  let rekeyed = false;

  for (;;) {
    const ciphertextLength = record.ciphertext.length;
    const totalChunks = Math.ceil(ciphertextLength / VOICE_NOTE_ATTACHMENT_CHUNK_CHARS);
    let restartWithNewId = false;

    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * VOICE_NOTE_ATTACHMENT_CHUNK_CHARS;
      const ciphertextChunk = record.ciphertext.slice(start, start + VOICE_NOTE_ATTACHMENT_CHUNK_CHARS);
      let result;
      try {
        result = await requestVoiceNoteAttachment(dateString, record.id, {
          index, ciphertextChunk, ciphertextLength, totalChunks
        });
      } catch (error) {
        if (error.status !== 409) throw error;
        const resolution = await resolveVoiceNoteChunkConflict(
          dateString, record, index, ciphertextChunk, ciphertextLength, totalChunks
        );
        if (resolution === 'already-stored') continue;
        if (rekeyed) {
          const permanentConflict = new Error('A replacement voice-note identifier also conflicts with existing cloud data. The encrypted local recording remains preserved.');
          permanentConflict.code = 'VOICE_NOTE_CONFLICT';
          throw permanentConflict;
        }
        // The identifier is already bound to different remote bytes. Re-encrypt
        // the local recording under a fresh ID; never overwrite the remote copy.
        record = await rekeyEncryptedVoiceNoteRecord(record.id, activeVault.encryptionKey);
        rekeyed = true;
        restartWithNewId = true;
        break;
      }

      if (result?.id !== record.id || result?.dateString !== dateString
          || result?.stored !== true || result?.index !== index || result?.totalChunks !== totalChunks) {
        throw new Error('The cloud did not confirm encrypted voice-note segment ' + (index + 1) + ' of ' + totalChunks + '. The full local recording remains queued.');
      }
    }

    if (restartWithNewId) continue;
    const markedUploaded = await markEncryptedVoiceNoteUploaded(record.id, record);
    if (!markedUploaded) {
      const error = new Error('The local voice recording changed while its cloud upload was completing. The current local copy remains queued for a fresh upload.');
      error.transient = true;
      throw error;
    }
    return { uploaded: true, rekeyed, id: record.id };
  }
}

async function uploadPendingVoiceNoteAttachments(dateString) {
  if (!activeVault || activeVault.offlineOnly === true) return { uploaded: 0, pending: 0 };
  const records = await exportEncryptedVoiceNotesForDateFull(dateString);
  let uploaded = 0;
  let pending = 0;
  let retryableFailure = false;
  let attempted = false;

  for (const record of records) {
    if (record.remoteUploaded === true) continue;
    attempted = true;
    try {
      await uploadVoiceNoteRecord(dateString, record);
      uploaded += 1;
    } catch (error) {
      if (error?.code === 'VAULT_SESSION_EXPIRED') throw error;
      pending += 1;
      if (error?.transient === true || error?.status === 429 || error?.status >= 500) {
        retryableFailure = true;
      }
      console.warn('[Vault Sync] One encrypted voice note remains local; other notes and the daily packet can continue.', {
        dateString,
        voiceNoteId: record.id,
        status: error?.status || null,
        code: error?.code || null,
        error: error?.message || String(error)
      });
    }
  }

  // Rebuild the date packet after attachment attempts. Only recordings marked
  // remoteUploaded by a confirmed upload (or exact remote match) enter its
  // manifest list. Unpublished local audio remains safely in IndexedDB.
  if (attempted || uploaded) await captureDailyPacket(dateString);
  if (retryableFailure) scheduleVoiceNoteUploadRetry(dateString);
  else if (pending === 0) clearVoiceNoteUploadRetry(dateString);
  return { uploaded, pending };
}

async function uploadAllPendingVoiceNoteAttachments() {
  if (!activeVault || activeVault.offlineOnly === true) return { uploaded: 0, pending: 0 };
  const records = await exportEncryptedVoiceNotes();
  const dates = [...new Set(records.map(record => record.dateString))].sort();
  let uploaded = 0;
  let pending = 0;
  for (const dateString of dates) {
    const result = await uploadPendingVoiceNoteAttachments(dateString);
    uploaded += result.uploaded;
    pending += result.pending;
  }
  return { uploaded, pending };
}

async function hydrateVoiceNoteAttachments(dateString, notes) {
  if (!Array.isArray(notes) || notes.length > 100) {
    throw new Error('The daily packet contains an invalid voice-note list. Both encrypted copies remain preserved.');
  }
  const localRecords = await exportEncryptedVoiceNotesForDateFull(dateString);
  const localById = new Map(localRecords.map(record => [record.id, record]));
  const hydrated = [];
  let rekeyedLocalRecord = false;
  for (const note of notes) {
    if (!validateEncryptedVoiceNoteRecord(note) || note.dateString !== dateString) {
      throw new Error('A voice-note entry failed validation. Both encrypted copies remain preserved.');
    }
    if (typeof note.ciphertext === 'string') {
      const local = localById.get(note.id);
      if (local && !sameVoiceNoteManifest(local, note)) {
        await rekeyEncryptedVoiceNoteRecord(note.id, activeVault.encryptionKey);
        localById.delete(note.id);
        rekeyedLocalRecord = true;
        scheduleVoiceNoteUploadRetry(dateString);
      }
      // Legacy packets embed full audio. Keep it locally and queue the separate
      // attachment upload without replacing a different local recording.
      hydrated.push({
        ...note,
        remoteUploaded: local?.remoteUploaded === true && sameVoiceNoteManifest(local, note)
      });
      continue;
    }
    const local = localById.get(note.id);
    if (local && sameVoiceNoteManifest(local, note)) {
      hydrated.push(local);
      continue;
    }
    if (local) {
      // Keep the device's recording under a fresh encrypted ID, then retrieve
      // the distinct cloud recording that legitimately owns the old ID.
      await rekeyEncryptedVoiceNoteRecord(note.id, activeVault.encryptionKey);
      localById.delete(note.id);
      rekeyedLocalRecord = true;
      scheduleVoiceNoteUploadRetry(dateString);
    }
    const chunks = [];
    for (let index = 0; index < note.attachmentChunkCount; index += 1) {
      const remote = await requestVoiceNoteAttachment(dateString, note.id, { index });
      if (!remote || remote.id !== note.id || remote.dateString !== dateString
          || remote.index !== index || remote.totalChunks !== note.attachmentChunkCount
          || remote.ciphertextLength !== note.ciphertextLength
          || typeof remote.ciphertextChunk !== 'string') {
        throw new Error('Encrypted voice-note segment ' + (index + 1) + ' is not available yet. Other local Diary data remains preserved.');
      }
      chunks.push(remote.ciphertextChunk);
    }
    const ciphertext = chunks.join('');
    const restored = { ...note, ciphertext, remoteUploaded: true };
    if (!validateEncryptedVoiceNoteRecord(restored)
        || restored.ciphertext.length !== note.ciphertextLength
        || atob(restored.ciphertext).length !== note.ciphertextBytes) {
      throw new Error('A downloaded voice-note attachment failed its integrity checks. The local Diary remains preserved.');
    }
    await saveEncryptedVoiceNoteRecord(restored, { remoteUploaded: true });
    hydrated.push(restored);
  }
  return { records: hydrated, rekeyedLocalRecord };
}

async function captureDailyPacket(dateString) {
  if (!activeVault || !isValidDateString(dateString) || applyingRemotePacket) return;
  const version = (localChangeVersions.get(dateString) || 0) + 1;
  localChangeVersions.set(dateString, version);

  const previous = localCaptureQueues.get(dateString) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    let repeat = true;
    while (repeat && activeVault) {
      const snapshotVersion = localChangeVersions.get(dateString);
      const bundle = await buildDailyBundle(dateString);
      const validatedBytes = validateDailyBundleForEncryption(bundle, dateString);
      console.log('[Vault Sync] Frontend daily packet validation passed:', { vaultId: activeVault.vaultId, dateString, serializedBytes: validatedBytes, recordCount: Object.keys(bundle.records).length, voiceNoteCount: bundle.voiceNotes.length });
      const prior = await getLocalDailyPacket(dateString);
      if (prior) {
        try {
          const priorBundle = await decryptDailyBundle(prior.packet, activeVault.encryptionKey, decompressData);
          if (canonicalBundle(priorBundle) === canonicalBundle(bundle)) return;
        } catch {
          // A packet from a future version is replaced only after the current data is safely encrypted.
        }
      }
      const packet = await encryptDailyBundle(bundle, activeVault.encryptionKey, compressData);
      await putLocalDailyPacket({
        dateString,
        packet,
        localUpdatedAt: Date.now(),
        remoteUpdatedAt: prior?.remoteUpdatedAt || null,
        dirty: true
      });
      repeat = localChangeVersions.get(dateString) !== snapshotVersion;
      if (!repeat) {
        status(activeVault.offlineOnly === true
          ? 'Saved and encrypted locally. Sign in online to synchronize this device.'
          : 'Saved and encrypted locally. Cloud synchronization is queued.',
          'info');
      }
    }
  });
  localCaptureQueues.set(dateString, next);
  try {
    await next;
  } finally {
    if (localCaptureQueues.get(dateString) === next) localCaptureQueues.delete(dateString);
  }
}

function scheduleCapture(dateString = getCurrentDateString()) {
  if (!activeVault || applyingRemotePacket || !isValidDateString(dateString)) return;
  const session = activeVault;
  const generation = vaultSyncGeneration;
  captureDailyPacket(dateString).then(() => {
    if (activeVault !== session || vaultSyncGeneration !== generation
        || session.offlineOnly === true) return;
    queueVaultSync({ dateString });
  }).catch(error => {
    if (activeVault === session && vaultSyncGeneration === generation) {
      status(error.message || 'The daily packet could not be stored locally.', 'error');
    }
  });
}

function installLocalStorageHooks() {
  if (storageHooksInstalled || !window.Storage?.prototype) return;
  storageHooksInstalled = true;
  const prototype = window.Storage.prototype;
  const originalSetItem = prototype.setItem;
  const originalRemoveItem = prototype.removeItem;

  const wrappedSetItem = function (key, value) {
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && !applyingRemotePacket
        && !window.__faithFocusVaultMigration && !window.__faithFocusVaultBatchWrite) {
      const dateString = dateFromDailyKey(String(key));
      if (dateString) scheduleCapture(dateString);
      else if (key === GARDEN_STORAGE_KEY || key === 'user_confidence_score') scheduleCapture();
    }
    return result;
  };
  Object.defineProperty(wrappedSetItem, '__faithFocusVaultHooked', { value: true });
  prototype.setItem = wrappedSetItem;

  const wrappedRemoveItem = function (key) {
    const result = originalRemoveItem.call(this, key);
    if (this === window.localStorage && !applyingRemotePacket
        && !window.__faithFocusVaultBatchWrite) {
      const dateString = dateFromDailyKey(String(key));
      if (dateString) scheduleCapture(dateString);
      else if (key === GARDEN_STORAGE_KEY || key === 'user_confidence_score') scheduleCapture();
    }
    return result;
  };
  Object.defineProperty(wrappedRemoveItem, '__faithFocusVaultHooked', { value: true });
  prototype.removeItem = wrappedRemoveItem;
}

function parseGardenSnapshot(value) {
  if (typeof value !== 'string') return null;
  try {
    return validateGardenState(JSON.parse(value));
  } catch {
    return null;
  }
}

function isUsableLegacyWritingConfig(value) {
  if (typeof value !== 'string') return false;
  try {
    const config = JSON.parse(value);
    if (!config || config.version !== 1 || config.algorithm !== 'AES-256-GCM'
        || config.kdf !== 'PBKDF2-HMAC-SHA-256' || config.iterations !== 600000
        || typeof config.salt !== 'string') return false;
    return atob(config.salt).length === 16;
  } catch {
    return false;
  }
}

function restoreSharedAppState(bundle, {
  replaceConfidence = false,
  replaceGarden = false,
  preserveGarden = false
} = {}) {
  if (!bundle || typeof bundle !== 'object') return;
  applyingRemotePacket += 1;
  try {
    const gardenRecordKey = GARDEN_DAILY_SYNC_PREFIX + bundle.dateString;
    if (replaceGarden) {
      const gardenRaw = Object.hasOwn(bundle.records || {}, gardenRecordKey)
        ? bundle.records[gardenRecordKey]
        : bundle.appState?.garden;
      const replacementGarden = parseGardenSnapshot(gardenRaw);
      if (replacementGarden) localStorage.setItem(GARDEN_STORAGE_KEY, JSON.stringify(replacementGarden));
      else localStorage.removeItem(GARDEN_STORAGE_KEY);
    } else if (!preserveGarden) {
      const localGardenRaw = localStorage.getItem(GARDEN_STORAGE_KEY);
      let mergedGarden = parseGardenSnapshot(localGardenRaw);
      const gardenRecord = bundle.records?.[gardenRecordKey];
      for (const candidate of [gardenRecord, bundle.appState?.garden]) {
        const incomingGarden = parseGardenSnapshot(candidate);
        if (incomingGarden) mergedGarden = mergeGardenStates(mergedGarden, incomingGarden);
      }
      if (mergedGarden && JSON.stringify(mergedGarden) !== JSON.stringify(parseGardenSnapshot(localGardenRaw))) {
        localStorage.setItem(GARDEN_STORAGE_KEY, JSON.stringify(mergedGarden));
      }
    }

    const remoteLegacyConfig = bundle.appState?.legacyWritingConfig;
    const localLegacyConfig = localStorage.getItem(LEGACY_WRITING_CONFIG_KEY);
    if (isUsableLegacyWritingConfig(remoteLegacyConfig) && !isUsableLegacyWritingConfig(localLegacyConfig)) {
      localStorage.setItem(LEGACY_WRITING_CONFIG_KEY, remoteLegacyConfig);
    }

    const remoteConfidenceScore = bundle.appState?.confidenceScore;
    if (typeof remoteConfidenceScore === 'string'
        && (replaceConfidence || localStorage.getItem('user_confidence_score') === null)) {
      localStorage.setItem('user_confidence_score', remoteConfidenceScore);
    }
  } finally {
    applyingRemotePacket -= 1;
  }
}

function canonicalBundle(bundle) {
  return JSON.stringify({
    dateString: bundle.dateString,
    records: bundle.records,
    voiceNotes: bundle.voiceNotes,
    appState: bundle.appState
  });
}

async function restoreDailyBundle(bundle, { dispatch = true, expectedLocalChangeVersion = null } = {}) {
  let hydratedVoiceNotes = null;
  let rekeyedLocalVoiceNote = false;
  let voiceNotesReady = true;
  try {
    const hydration = await hydrateVoiceNoteAttachments(bundle.dateString, bundle.voiceNotes);
    hydratedVoiceNotes = hydration.records;
    rekeyedLocalVoiceNote = hydration.rekeyedLocalRecord;
  } catch (error) {
    voiceNotesReady = false;
    console.warn('[Vault Sync] Voice-note attachments remain queued; restoring the rest of this date.', {
      dateString: bundle.dateString,
      error: error?.message || String(error)
    });
  }
  if (voiceNotesReady) pendingVoiceNoteHydrationDates.delete(bundle.dateString);
  else pendingVoiceNoteHydrationDates.add(bundle.dateString);
  if (expectedLocalChangeVersion !== null
      && (localChangeVersions.get(bundle.dateString) || 0) !== expectedLocalChangeVersion) {
    return { voiceNotesReady, applied: false };
  }
  const checklistKey = 'mindful_pokes_data_' + bundle.dateString;
  const notesKey = 'dmp_notes_cipher_v1_' + bundle.dateString;
  const gardenRecordKey = GARDEN_DAILY_SYNC_PREFIX + bundle.dateString;
  const resetKey = DAILY_RESET_MARKER_PREFIX + bundle.dateString;
  const incomingReset = parseDailyResetMarker(bundle.records?.[resetKey]);
  const localReset = parseDailyResetMarker(localStorage.getItem(resetKey));
  const resetComparison = compareDailyResetMarkers(incomingReset, localReset);
  const localResetIsNewer = Boolean(localReset && (!incomingReset || resetComparison < 0));
  const incomingResetIsCurrentOrNewer = Boolean(incomingReset && (!localReset || resetComparison >= 0));
  const resettableKeys = new Set([checklistKey, notesKey, gardenRecordKey, resetKey]);

  applyingRemotePacket += 1;
  try {
    if (incomingResetIsCurrentOrNewer) {
      // A newer reset is an explicit deletion of prior checklist, reflections,
      // and Garden state. Clear before applying any post-reset values included
      // in this same packet.
      localStorage.removeItem(checklistKey);
      localStorage.removeItem(notesKey);
      localStorage.removeItem(GARDEN_STORAGE_KEY);
    }
    for (const [key, value] of Object.entries(bundle.records)) {
      if (key.startsWith(GARDEN_DAILY_SYNC_PREFIX)) continue;
      if (localResetIsNewer && resettableKeys.has(key)) continue;
      if (isDailyRecordKey(key) && typeof value === 'string') localStorage.setItem(key, value);
    }
    restoreSharedAppState(bundle, {
      replaceConfidence: true,
      replaceGarden: incomingResetIsCurrentOrNewer,
      preserveGarden: localResetIsNewer
    });
    if (voiceNotesReady) {
      try {
        await restoreEncryptedVoiceNotesForDate(bundle.dateString, hydratedVoiceNotes);
      } catch (error) {
        voiceNotesReady = false;
        console.warn('[Vault Sync] Voice-note records remain queued; other date data was restored.', {
          dateString: bundle.dateString,
          error: error?.message || String(error)
        });
      }
    }
  } finally {
    applyingRemotePacket -= 1;
  }
  if (voiceNotesReady) pendingVoiceNoteHydrationDates.delete(bundle.dateString);
  else pendingVoiceNoteHydrationDates.add(bundle.dateString);
  if (dispatch) window.dispatchEvent(new CustomEvent('faith-focus:vault-data-restored', { detail: { dateString: bundle.dateString } }));
  if (rekeyedLocalVoiceNote) scheduleVoiceNoteUploadRetry(bundle.dateString);
  return { voiceNotesReady, applied: true };
}

async function fetchRemoteIndex() {
  console.log('[Vault Sync] Fetching shared vault index after verified sign-in:', { vaultId: activeVault.vaultId, key: activeVault.vaultId + ':index' });
  const result = await vaultRequest('/vault/' + activeVault.vaultId + '/index');
  if (!result.index || typeof result.index !== 'object' || Array.isArray(result.index)) {
    throw new Error('Cloudflare returned an invalid vault index.');
  }
  return result.index;
}

async function fetchRemoteDay(dateString) {
  const result = await vaultRequest('/vault/' + activeVault.vaultId + '/day/' + dateString);
  if (result.packet !== null && !isValidEncryptedPacket(result.packet)) {
    throw new Error('Cloudflare returned an invalid encrypted daily packet.');
  }
  return result;
}

function voiceNoteManifestForComparison(record) {
  if (!record || typeof record !== 'object') return null;
  return typeof record.ciphertext === 'string'
    ? createVoiceNoteAttachmentManifest(record)
    : record;
}

function sameVoiceNoteManifest(leftRecord, rightRecord) {
  const left = voiceNoteManifestForComparison(leftRecord);
  const right = voiceNoteManifestForComparison(rightRecord);
  if (!left || !right) return false;
  return [
    'id', 'dateString', 'version', 'algorithm', 'mimeType', 'capturedAt', 'iv',
    'attachmentVersion', 'ciphertextBytes', 'ciphertextLength', 'attachmentChunkCount'
  ].every(field => left[field] === right[field]);
}

async function filterUnconfirmedVoiceNotes(bundle, remoteBundle = null) {
  const localRecords = await exportEncryptedVoiceNotesForDateFull(bundle.dateString);
  const localById = new Map(localRecords.map(record => [record.id, record]));
  const rekeyedIds = new Set();

  // Keep older full-ciphertext packets recoverable before filtering them from
  // the manifest list. If the local store already has different bytes under
  // that ID, re-key that copy first so neither recording overwrites the other.
  for (const note of bundle.voiceNotes || []) {
    if (typeof note.ciphertext !== 'string') continue;
    const local = localById.get(note.id);
    if (!local) {
      await saveEncryptedVoiceNoteRecord(note, { remoteUploaded: false });
      localById.set(note.id, await getEncryptedVoiceNoteRecord(note.id));
      scheduleVoiceNoteUploadRetry(bundle.dateString);
      continue;
    }
    if (!sameVoiceNoteManifest(local, note)) {
      await rekeyEncryptedVoiceNoteRecord(note.id, activeVault.encryptionKey);
      rekeyedIds.add(note.id);
      await saveEncryptedVoiceNoteRecord(note, { remoteUploaded: false });
      localById.set(note.id, await getEncryptedVoiceNoteRecord(note.id));
      scheduleVoiceNoteUploadRetry(bundle.dateString);
    }
  }

  const remoteById = new Map((remoteBundle?.voiceNotes || []).map(record => [record.id, record]));

  // A local recording that shares an ID with different remote metadata is a
  // real identity collision. Preserve its plaintext audio through an atomic
  // re-encryption under a new ID, and leave the remote recording untouched.
  for (const [id, remoteManifest] of remoteById) {
    const localRecord = localById.get(id);
    if (!localRecord) continue;
    if (!sameVoiceNoteManifest(createVoiceNoteAttachmentManifest(localRecord), remoteManifest)) {
      await rekeyEncryptedVoiceNoteRecord(id, activeVault.encryptionKey);
      rekeyedIds.add(id);
    }
  }

  const voiceNotes = (bundle.voiceNotes || []).flatMap(note => {
    if (rekeyedIds.has(note.id)) return [];
    const local = localById.get(note.id);
    if (local?.remoteUploaded === true) {
      // The current locally stored ciphertext is the one the Worker accepted.
      // Repair a stale packet manifest from that exact record, never publish
      // metadata that merely happens to share its identifier.
      return [sameVoiceNoteManifest(local, note)
        ? note
        : createVoiceNoteAttachmentManifest(local)];
    }
    const remote = remoteById.get(note.id);
    return remote && sameVoiceNoteManifest(remote, note) ? [remote] : [];
  });
  return {
    bundle: { ...bundle, voiceNotes },
    rekeyed: rekeyedIds.size > 0
  };
}

async function resolveLocalVoiceNoteIdentityConflicts(localBundle, remoteBundle) {
  const localRecords = await exportEncryptedVoiceNotesForDateFull(localBundle.dateString);
  const localById = new Map(localRecords.map(record => [record.id, record]));
  const localPacketById = new Map((localBundle.voiceNotes || []).map(record => [record.id, record]));
  const remoteById = new Map((remoteBundle.voiceNotes || []).map(record => [record.id, record]));
  const rekeyedIds = new Set();

  for (const [id, remoteRecord] of remoteById) {
    const localRecord = localById.get(id);
    const localPacketRecord = localPacketById.get(id);
    if (!localRecord && !localPacketRecord) continue;

    if (!localRecord && typeof localPacketRecord?.ciphertext === 'string') {
      // Older packets may still carry complete encrypted audio even when the
      // newer attachment store has no copy. Keep those bytes before merging.
      try {
        await saveEncryptedVoiceNoteRecord(localPacketRecord, { remoteUploaded: false });
        const savedRecord = await getEncryptedVoiceNoteRecord(id);
        if (!savedRecord) throw new Error('The embedded local recording could not be retained.');
        localById.set(id, savedRecord);
        if (savedRecord.remoteUploaded !== true) scheduleVoiceNoteUploadRetry(localBundle.dateString);
      } catch (cause) {
        const error = new Error('An embedded local voice recording could not be safely retained. Both device copies remain preserved.');
        error.code = 'VOICE_NOTE_IDENTITY_CONFLICT';
        error.cause = cause;
        throw error;
      }
    }

    const retainedLocalRecord = localById.get(id);
    const localCandidate = retainedLocalRecord
      ? createVoiceNoteAttachmentManifest(retainedLocalRecord)
      : voiceNoteManifestForComparison(localPacketRecord);
    if (sameVoiceNoteManifest(localCandidate, remoteRecord)) continue;

    if (!retainedLocalRecord) {
      const error = new Error('A conflicting local voice-note packet has no matching encrypted recording in local storage. Both device copies remain preserved.');
      error.code = 'VOICE_NOTE_IDENTITY_CONFLICT';
      throw error;
    }

    try {
      // Resolve the ID collision before mergeDailyBundles sees the two records.
      // The atomic re-key keeps the local audio and leaves the remote ID intact.
      await rekeyEncryptedVoiceNoteRecord(id, activeVault.encryptionKey);
      rekeyedIds.add(id);
      scheduleVoiceNoteUploadRetry(localBundle.dateString);
    } catch (cause) {
      const error = new Error('A local voice recording could not be safely separated from a remote recording that uses the same identifier. Both copies remain preserved.');
      error.code = 'VOICE_NOTE_IDENTITY_CONFLICT';
      error.cause = cause;
      throw error;
    }
  }

  const voiceNotes = (localBundle.voiceNotes || [])
    .filter(note => !rekeyedIds.has(note.id))
    .map(note => {
      const current = localById.get(note.id);
      if (!current) return note;
      const currentManifest = createVoiceNoteAttachmentManifest(current);
      return sameVoiceNoteManifest(currentManifest, note) ? note : currentManifest;
    });

  return {
    bundle: { ...localBundle, voiceNotes },
    rekeyed: rekeyedIds.size > 0,
    rekeyedIds: [...rekeyedIds]
  };
}

async function uploadDailyPacket(dateString, { baseUpdatedAt } = {}) {
  let local = await getLocalDailyPacket(dateString);
  if (!local?.dirty) return false;
  const localChangeVersion = localChangeVersions.get(dateString) || 0;
  let bundle = await decryptDailyBundle(local.packet, activeVault.encryptionKey, decompressData);
  const filtered = await filterUnconfirmedVoiceNotes(bundle);
  if (filtered.rekeyed || canonicalBundle(filtered.bundle) !== canonicalBundle(bundle)) {
    const packet = await encryptDailyBundle(filtered.bundle, activeVault.encryptionKey, compressData);
    await putLocalDailyPacket({
      ...local,
      packet,
      localUpdatedAt: Date.now(),
      dirty: true
    });
    local = await getLocalDailyPacket(dateString);
  }
  const uploadBaseUpdatedAt = baseUpdatedAt === undefined
    ? (local.remoteUpdatedAt || null)
    : (baseUpdatedAt || null);
  console.log('[Vault Sync] Uploading encrypted daily packet:', {
    vaultId: activeVault.vaultId, dateString, packetKey: activeVault.vaultId + ':' + dateString,
    baseUpdatedAt: uploadBaseUpdatedAt
  });

  const result = await vaultRequest('/vault/' + activeVault.vaultId + '/day/' + dateString, {
    method: 'PUT',
    body: { packet: local.packet, baseUpdatedAt: uploadBaseUpdatedAt },
    baseUpdatedAt: uploadBaseUpdatedAt
  });
  const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
  const syncResult = await markLocalDailyPacketSynced(
    dateString,
    result.updatedAt,
    local.packet,
    { requirePacketMatch: true, expectedPacket: unchangedSinceSnapshot ? local.packet : null }
  );
  console.log('[Vault Sync] Encrypted daily packet upload accepted by Worker:', {
    vaultId: activeVault.vaultId, dateString, packetKey: activeVault.vaultId + ':' + dateString,
    updatedAt: result.updatedAt, stillMatchesUploadedSnapshot: syncResult.stillMatchesUploadedSnapshot
  });
  if (filtered.rekeyed || !syncResult.stillMatchesUploadedSnapshot) scheduleCapture(dateString);
  return true;
}

async function reconcileDay(dateString, remoteUpdatedAt, { forceRemoteRead = false } = {}) {
  for (let attempt = 1; attempt <= MAX_DATE_RECONCILE_ATTEMPTS; attempt += 1) {
    try {
      // reconcileDayOnce fetches the latest remote packet on every attempt, then
      // merges it with the latest local encrypted packet before a guarded write.
      return await reconcileDayOnce(dateString, remoteUpdatedAt, { forceRemoteRead });
    } catch (error) {
      if (error.code !== 'VAULT_CONFLICT') throw error;
      console.warn('[Vault Sync] Date changed during reconciliation; retrying against the latest cloud version:', {
        vaultId: activeVault?.vaultId || null,
        dateString,
        attempt,
        maxAttempts: MAX_DATE_RECONCILE_ATTEMPTS,
        remoteUpdatedAt: error.updatedAt || null
      });
      if (attempt === MAX_DATE_RECONCILE_ATTEMPTS) {
        status(
          'Cloud updates for ' + dateString + ' are still changing. Both copies remain saved; automatic sync will retry.',
          'error'
        );
        return false;
      }
      await new Promise(resolve => window.setTimeout(resolve, 200 * attempt));
    }
  }
  return false;
}

async function reconcileDayOnce(dateString, remoteUpdatedAt, { forceRemoteRead = false } = {}) {
  let local = await getLocalDailyPacket(dateString);
  const localChangeVersion = localChangeVersions.get(dateString) || 0;
  if (!local) {
    console.log('[Vault Sync] Remote date has no local packet; fetching and restoring encrypted date:', {
      vaultId: activeVault.vaultId, dateString, packetKey: activeVault.vaultId + ':' + dateString,
      remoteUpdatedAt: remoteUpdatedAt || null
    });
    const remote = await fetchRemoteDay(dateString);
    if (!remote.packet) return false;
    const bundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
    const restored = await restoreDailyBundle(bundle, { expectedLocalChangeVersion: localChangeVersion });
    if (!restored.applied) {
      scheduleCapture(dateString);
      return false;
    }
    await putLocalDailyPacket({
      dateString, packet: remote.packet, localUpdatedAt: Date.now(),
      remoteUpdatedAt: restored.voiceNotesReady ? (remote.updatedAt || remoteUpdatedAt) : null,
      dirty: false
    });
    if ((localChangeVersions.get(dateString) || 0) !== localChangeVersion) scheduleCapture(dateString);
    return true;
  }

  if (local.dirty) {
    const remote = await fetchRemoteDay(dateString);
    if (!remote.packet) {
      return uploadDailyPacket(dateString, { baseUpdatedAt: remote.updatedAt || null });
    }
    const remoteBundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
    let localBundle = await decryptDailyBundle(local.packet, activeVault.encryptionKey, decompressData);
    if (canonicalBundle(remoteBundle) === canonicalBundle(localBundle)) {
      const restored = await restoreDailyBundle(remoteBundle, { expectedLocalChangeVersion: localChangeVersion });
      if (!restored.applied) {
        scheduleCapture(dateString);
        return false;
      }
      const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
      const syncResult = await markLocalDailyPacketSynced(
        dateString,
        restored.voiceNotesReady ? (remote.updatedAt || remoteUpdatedAt) : null,
        remote.packet,
        { requirePacketMatch: true, expectedPacket: unchangedSinceSnapshot ? local.packet : null }
      );
      if (!syncResult.stillMatchesUploadedSnapshot) scheduleCapture(dateString);
      return false;
    }

    // Reconcile both device copies by record type. Private writing is decrypted
    // only with the unlocked account key; voice notes and location history are
    // unioned, while checklist completion is combined without unchecking either side.
    let mergedBundle;
    try {
      const identityResolution = await resolveLocalVoiceNoteIdentityConflicts(localBundle, remoteBundle);
      localBundle = identityResolution.bundle;
      if (identityResolution.rekeyed) {
        // Persist removal of the old conflicting IDs before any later merge step
        // can fail. The re-keyed local audio remains in IndexedDB under its new ID.
        const currentLocal = await getLocalDailyPacket(dateString);
        if (!currentLocal || currentLocal.packet !== local.packet
            || (localChangeVersions.get(dateString) || 0) !== localChangeVersion) {
          scheduleCapture(dateString);
          return false;
        }
        const safeLocalPacket = await encryptDailyBundle(localBundle, activeVault.encryptionKey, compressData);
        await putLocalDailyPacket({
          ...currentLocal,
          packet: safeLocalPacket,
          localUpdatedAt: Date.now(),
          dirty: true
        });
        local = await getLocalDailyPacket(dateString);
      }

      mergedBundle = await mergeDailyBundles(localBundle, remoteBundle, {
        dateString,
        mergePrivateWriting: (localWriting, remoteWriting) =>
          mergeEncryptedPrivateWritingRecords(dateString, localWriting, remoteWriting, activeVault.encryptionKey),
        isUsableLegacyWritingConfig
      });
      const filteredMergedBundle = await filterUnconfirmedVoiceNotes(mergedBundle, remoteBundle);
      mergedBundle = filteredMergedBundle.bundle;
    } catch (error) {
      const voiceIdentityConflict = error?.code === 'VOICE_NOTE_IDENTITY_CONFLICT';
      // Both packets remain intact when a voice identity or legacy writing
      // conflict cannot be resolved safely; other dates can still reconcile.
      console.warn('[Vault Sync] Same-day merge is deferred; both encrypted packets remain preserved:', {
        dateString,
        reason: error?.message || String(error)
      });
      status(
        voiceIdentityConflict
          ? 'A voice recording needs safe identifier recovery before this date can merge. The local and cloud recordings remain preserved; other dates can still sync.'
          : 'Your account is open, but one device has a Diary entry that still needs its previous writing key. Both encrypted copies are preserved. Complete the one-time Diary migration, then sync again.',
        'error'
      );
      return false;
    }
    // Adopt the remote packet without a KV write when the local merge adds nothing.
    if (canonicalBundle(mergedBundle) === canonicalBundle(remoteBundle)) {
      const restored = await restoreDailyBundle(remoteBundle, { expectedLocalChangeVersion: localChangeVersion });
      if (!restored.applied) {
        scheduleCapture(dateString);
        return false;
      }
      const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
      const syncResult = await markLocalDailyPacketSynced(
        dateString,
        restored.voiceNotesReady ? (remote.updatedAt || remoteUpdatedAt) : null,
        remote.packet,
        { requirePacketMatch: true, expectedPacket: unchangedSinceSnapshot ? local.packet : null }
      );
      if (!syncResult.stillMatchesUploadedSnapshot) scheduleCapture(dateString);
      return false;
    }

    // Local manifests that have not been accepted by the Worker are excluded
    // before this point. Existing remote manifests were already published in an
    // acknowledged packet, so a later attachment download failure must not block
    // independent checklist, Diary, or location reconciliation.
    const mergedPacket = await encryptDailyBundle(mergedBundle, activeVault.encryptionKey, compressData);
    const result = await vaultRequest('/vault/' + activeVault.vaultId + '/day/' + dateString, {
      method: 'PUT',
      body: { packet: mergedPacket, baseUpdatedAt: remote.updatedAt || remoteUpdatedAt || null },
      baseUpdatedAt: remote.updatedAt || remoteUpdatedAt || null
    });
    const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
    const syncResult = await markLocalDailyPacketSynced(
      dateString,
      result.updatedAt || remote.updatedAt || remoteUpdatedAt,
      mergedPacket,
      { requirePacketMatch: true, expectedPacket: unchangedSinceSnapshot ? local.packet : null }
    );
    if (syncResult.stillMatchesUploadedSnapshot) {
      const restored = await restoreDailyBundle(mergedBundle, { expectedLocalChangeVersion: localChangeVersion });
      if (!restored.applied) {
        scheduleCapture(dateString);
        return false;
      }
      status('Entries for ' + dateString + ' from both devices have been combined and synced.', 'success');
      return true;
    }

    // A newer edit appeared during the upload. Keep it local and reconcile it
    // against the just-published combined packet on the next sync pass.
    scheduleCapture(dateString);
    status('A newer local edit was kept safely and will be included in another sync pass.', 'info');
    return false;
  }

  const localRemote = local.remoteUpdatedAt || null;
  const remoteVersionChanged = Boolean(remoteUpdatedAt && remoteUpdatedAt !== localRemote);
  if (forceRemoteRead || remoteVersionChanged) {
    if (remoteVersionChanged && (!localRemote || remoteUpdatedAt > localRemote)) {
      console.log('[Vault Sync] Remote date version requires reconciliation:', {
        vaultId: activeVault.vaultId, dateString, remoteUpdatedAt, localRemoteUpdatedAt: localRemote
      });
    }
    // A full sign-in restore must rehydrate browser storage even when its cached
    // packet version matches the index. The local packet can survive while the
    // corresponding localStorage / IndexedDB views are incomplete or missing.
    // This path is read-and-restore only; it never PUTs an unchanged remote packet.
    const remote = await fetchRemoteDay(dateString);
    if (remote.packet) {
      const bundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
      const restored = await restoreDailyBundle(bundle, { expectedLocalChangeVersion: localChangeVersion });
      if (!restored.applied) {
        scheduleCapture(dateString);
        return false;
      }
      const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
      const syncResult = await markLocalDailyPacketSynced(
        dateString,
        restored.voiceNotesReady ? (remote.updatedAt || remoteUpdatedAt || null) : null,
        remote.packet,
        { requirePacketMatch: true, expectedPacket: unchangedSinceSnapshot ? local.packet : null }
      );
      if (!syncResult.stillMatchesUploadedSnapshot) {
        scheduleCapture(dateString);
        return false;
      }
      return true;
    }
  }
  return false;
}

export function selectVaultReconciliationDates(remoteIndex, requestedDateStrings = [], refreshAll = false) {
  if (refreshAll) {
    return Object.keys(remoteIndex || {}).filter(isValidDateString).sort();
  }
  return [...new Set((Array.isArray(requestedDateStrings) ? requestedDateStrings : [])
    .filter(isValidDateString))].sort();
}

function closeVaultEventSocket() {
  if (vaultEventReconnectTimer !== null) window.clearTimeout(vaultEventReconnectTimer);
  vaultEventReconnectTimer = null;
  const socket = vaultEventSocket;
  vaultEventSocket = null;
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
    try { socket.close(1000, "Vault sync paused"); } catch { /* Socket already closed. */ }
  }
}

function scheduleVaultEventReconnect(session, generation) {
  if (!activeVault || activeVault !== session || vaultSyncGeneration !== generation
      || session.offlineOnly === true || document.visibilityState !== 'visible'
      || navigator.onLine === false || vaultEventReconnectTimer !== null) return;
  vaultEventReconnectFailures = Math.min(vaultEventReconnectFailures + 1, 6);
  const delay = Math.min(VAULT_EVENT_RECONNECT_MAX_MS,
    VAULT_EVENT_RECONNECT_BASE_MS * (2 ** (vaultEventReconnectFailures - 1)));
  vaultEventReconnectTimer = window.setTimeout(() => {
    vaultEventReconnectTimer = null;
    connectVaultEventSocket(session, generation);
  }, delay);
}

function connectVaultEventSocket(session = activeVault, generation = vaultSyncGeneration) {
  if (!session || session !== activeVault || session.offlineOnly === true
      || document.visibilityState !== 'visible' || navigator.onLine === false
      || typeof WebSocket !== 'function') return;
  if (vaultEventSocket && (vaultEventSocket.readyState === 0 || vaultEventSocket.readyState === 1)) return;
  const url = WORKER_ORIGIN.replace(/^https:/, 'wss:')
    + '/vault/' + session.vaultId + '/events';
  let socket;
  try {
    socket = new WebSocket(url, [
      'faith-focus-sync-v1',
      session.vaultMembershipTicket,
      session.deviceSessionToken
    ]);
  } catch (error) {
    console.warn('[Vault Sync] Live update connection could not be created.', error);
    scheduleVaultEventReconnect(session, generation);
    return;
  }
  vaultEventSocket = socket;
  socket.addEventListener('open', () => {
    if (vaultEventSocket !== socket || activeVault !== session || vaultSyncGeneration !== generation) {
      try { socket.close(1000, 'Stale vault session'); } catch { /* Stale socket. */ }
      return;
    }
    vaultEventReconnectFailures = 0;
    status('Live encrypted sync is connected. Changes from your other devices will arrive automatically.', 'success');
  });
  socket.addEventListener('message', event => {
    if (vaultEventSocket !== socket || activeVault !== session || vaultSyncGeneration !== generation) return;
    if (typeof event.data !== 'string' || event.data.length > 1024) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message || message.type !== 'vault:changed' || !isValidDateString(message.dateString)
        || typeof message.updatedAt !== 'string' || message.updatedAt.length > 64) return;
    queueVaultSync({ dateString: message.dateString, immediate: true });
  });
  socket.addEventListener('error', () => {});
  socket.addEventListener('close', () => {
    if (vaultEventSocket === socket) vaultEventSocket = null;
    scheduleVaultEventReconnect(session, generation);
  });
}

function synchronizeVault(options = { refreshAll: true }) {
  if (!activeVault || activeVault.offlineOnly === true) return Promise.resolve();
  const operation = syncQueue.catch(() => {}).then(() => performVaultSync(options));
  syncQueue = operation.catch(() => {});
  return operation;
}

export async function syncDailyDateNow(dateString) {
  if (!isValidDateString(dateString) || !activeVault || activeVault.offlineOnly === true
      || vaultSyncInitializing) return false;

  const session = activeVault;
  const generation = vaultSyncGeneration;
  const isCurrent = () => activeVault === session && vaultSyncGeneration === generation
    && session.offlineOnly !== true;

  const operation = localChangeSyncQueue.catch(() => {}).then(async () => {
    if (!isCurrent()) return false;
    await captureDailyPacket(dateString);
    if (!isCurrent()) return false;

    try {
      await uploadPendingVoiceNoteAttachments(dateString);
    } catch (error) {
      if (error?.code === 'VAULT_SESSION_EXPIRED') throw error;
      console.warn('[Vault Sync] A date-specific voice-note upload remains queued; daily packet reconciliation will continue.', {
        dateString, error: error?.message || String(error)
      });
    }
    if (!isCurrent()) return false;

    lastCloudSyncStartedAt = Date.now();
    const outcome = await synchronizeVault({ dateStrings: [dateString] });
    return outcome?.complete === true;
  });

  localChangeSyncQueue = operation.catch(error => {
    if (isCurrent()) {
      console.warn('[Vault Sync] The date remains saved locally and its cloud reconciliation will retry.', {
        dateString, error: error?.message || String(error)
      });
    }
    return false;
  });
  try {
    return await operation;
  } catch (error) {
    if (isCurrent()) {
      console.warn('[Vault Sync] The date remains saved locally and its cloud reconciliation will retry.', {
        dateString, error: error?.message || String(error)
      });
    }
    return false;
  }
}

function queueVaultSync({ dateString = null, dateStrings = [], refreshAll = false, immediate = false } = {}) {
  if (!activeVault || activeVault.offlineOnly === true) return;
  if (isValidDateString(dateString)) pendingDailySyncDates.add(dateString);
  if (Array.isArray(dateStrings)) dateStrings.forEach(value => {
    if (isValidDateString(value)) pendingDailySyncDates.add(value);
  });
  if (refreshAll) pendingFullVaultRefresh = true;
  if (vaultSyncInitializing) return;

  const session = activeVault;
  const generation = vaultSyncGeneration;
  if (dailySyncTimer !== null) window.clearTimeout(dailySyncTimer);

  const minimumWait = Math.max(0, DAILY_SYNC_MIN_INTERVAL_MS - (Date.now() - lastCloudSyncStartedAt));
  const delay = Math.max(immediate ? 0 : DAILY_SYNC_DEBOUNCE_MS, minimumWait);
  dailySyncTimer = window.setTimeout(() => {
    dailySyncTimer = null;
    const isCurrent = () => activeVault === session
      && vaultSyncGeneration === generation
      && session.offlineOnly !== true;
    if (!isCurrent()) return;

    const dates = [...pendingDailySyncDates].sort();
    pendingDailySyncDates.clear();
    const shouldRefreshAll = pendingFullVaultRefresh;
    pendingFullVaultRefresh = false;

    const operation = localChangeSyncQueue.catch(() => {}).then(async () => {
      if (!isCurrent()) return;
      lastCloudSyncStartedAt = Date.now();

      if (shouldRefreshAll) {
        await captureExistingLocalDates();
        if (!isCurrent()) return;
      }

      try {
        if (shouldRefreshAll) {
          await uploadAllPendingVoiceNoteAttachments();
        } else {
          for (const pendingDate of dates) {
            if (!isCurrent()) return;
            await uploadPendingVoiceNoteAttachments(pendingDate);
          }
        }
      } catch (error) {
        if (error?.code === 'VAULT_SESSION_EXPIRED') throw error;
        console.warn('[Vault Sync] Voice-note uploads could not run; daily packet reconciliation will continue independently.', {
          dates,
          error: error?.message || String(error)
        });
      }

      if (!isCurrent()) return;
      status('Synchronizing your encrypted Checklist and Diary…', 'info');
      await synchronizeVault({
        dateStrings: dates,
        refreshAll: shouldRefreshAll
      });
    });

    localChangeSyncQueue = operation.catch(error => {
      if (isCurrent()) {
        console.warn('[Vault Sync] Encrypted Diary changes remain saved locally; cloud reconciliation will retry after connectivity or foreground returns.', {
          dates,
          error
        });
        status(
          'Your encrypted Diary entries and voice notes remain saved on this device. Cloud sync could not finish; it will retry when the connection returns, the app is reopened, or you sign in again.',
          'error'
        );
      }
    });
  }, delay);
}

async function performVaultSync({ dateStrings = [], refreshAll = false, forceRemoteRead = false } = {}) {
  if (!activeVault || activeVault.offlineOnly === true) return;
  try {
    status('Checking your encrypted vault…');
    const index = await fetchRemoteIndex();
    const remoteDates = Object.keys(index).filter(isValidDateString).sort();
    const reconciliationDates = selectVaultReconciliationDates(index, dateStrings, refreshAll);
    console.log('[Vault Sync] Shared index received:', {
      vaultId: activeVault.vaultId,
      key: activeVault.vaultId + ':index',
      remoteDateCount: remoteDates.length,
      reconciliationDateCount: reconciliationDates.length,
      refreshAll,
      reconciliationDates
    });
    let restored = 0;
    const failedDates = [];

    // A normal Diary edit reconciles only its own date. Full-index reconciliation
    // remains reserved for sign-in, reconnect, and guarded foreground refreshes.
    for (const dateString of reconciliationDates) {
      const remoteUpdatedAt = typeof index[dateString] === 'string' ? index[dateString] : null;
      try {
        if (await reconcileDay(dateString, remoteUpdatedAt, { forceRemoteRead })) restored += 1;
      } catch (error) {
        if (error?.code === 'VAULT_SESSION_EXPIRED') throw error;
        failedDates.push(dateString);
        console.warn('[Vault Sync] One date could not be reconciled; continuing with the remaining dates.', {
          dateString, error: error?.message || String(error)
        });
      }
    }

    if (refreshAll) {
      const localRecords = await listLocalDailyPackets();
      for (const record of localRecords) {
        if (!record.dirty || Object.hasOwn(index, record.dateString)) continue;
        // Re-read the remote date before uploading. The index can change while
        // this pass is running, so even dates absent from the initial index must
        // go through the same guarded reconciliation path.
        try {
          await reconcileDay(record.dateString, null);
        } catch (error) {
          if (error?.code === 'VAULT_SESSION_EXPIRED') throw error;
          failedDates.push(record.dateString);
          console.warn('[Vault Sync] A local-only date remains queued.', { dateString: record.dateString, error });
        }
      }
    }

    const finalLocalRecords = refreshAll
      ? await listLocalDailyPackets()
      : (await Promise.all(reconciliationDates.map(dateString => getLocalDailyPacket(dateString))))
        .filter(Boolean);
    const pendingRecords = finalLocalRecords.filter(record => record.dirty);
    let pendingVoiceNotes = [];
    let voiceNoteStoreAvailable = true;
    try {
      pendingVoiceNotes = (await exportEncryptedVoiceNotes())
        .filter(record => record.remoteUploaded !== true && isValidDateString(record.dateString));
    } catch (error) {
      voiceNoteStoreAvailable = false;
      console.warn('[Vault Sync] Local voice-note upload state could not be checked; daily packet reconciliation remains complete independently.', {
        error: error?.message || String(error)
      });
    }
    const pendingDates = [...new Set([
      ...pendingRecords.map(record => record.dateString),
      ...pendingVoiceNotes.map(record => record.dateString),
      ...failedDates,
      ...pendingVoiceNoteHydrationDates
    ])].sort();
    if (pendingDates.length || !voiceNoteStoreAvailable) {
      status(
        'Some encrypted dates or voice notes remain queued' +
        (pendingDates.length ? ': ' + pendingDates.join(', ') : '') +
        (voiceNoteStoreAvailable ? '' : '. Local voice-note upload state could not be checked') +
        '. Other entries have still been restored; queued items will retry after reconnection or sign-in.',
        'error'
      );
    } else if (restored) {
      status('Restored ' + restored + ' saved date' + (restored === 1 ? '' : 's') + ' from your vault.', 'success');
    } else {
      status('Your encrypted vault is up to date on this device.', 'success');
    }
    return {
      complete: pendingDates.length === 0 && voiceNoteStoreAvailable,
      restored,
      pendingVoiceNoteCount: voiceNoteStoreAvailable ? pendingVoiceNotes.length : null,
      remoteDateCount: remoteDates.length,
      localDateCount: finalLocalRecords.length,
      pendingDates,
      failedDates: [...failedDates]
    };
  } catch (error) {
    status(error.message || 'Vault reconciliation could not finish.', 'error');
    throw error;
  }
}
async function captureExistingLocalDates() {
  // Only create local packets for dates that actually contain daily records or
  // voice notes. Global account settings must not create an empty "today" packet
  // before the cloud's current-day packet has been reconciled.
  const dates = new Set(listLocalStorageDates());
  const voiceNotes = await exportEncryptedVoiceNotes();
  voiceNotes.forEach(record => dates.add(record.dateString));
  for (const dateString of [...dates].sort()) {
    // A clean packet is already a complete encrypted snapshot. Do not rebuild
    // it from a possibly partial browser view before a sign-in/foreground restore;
    // doing so could dirty an intact packet and cause an unnecessary cloud PUT.
    const existing = await getLocalDailyPacket(dateString);
    if (existing && existing.dirty !== true) continue;
    await captureDailyPacket(dateString);
  }
}


export async function startLocalVaultStorage(credentials) {
  if (credentials?.offlineOnly !== true
      || !/^[a-f0-9]{64}$/.test(credentials.vaultId || '')
      || !credentials.encryptionKey
      || credentials.writeToken
      || credentials.vaultMembershipTicket
      || credentials.deviceSessionToken) {
    throw new TypeError('A device-local encrypted session is required.');
  }
  if (activeVault) await stopVaultSync();

  activeVault = credentials;
  const generation = ++vaultSyncGeneration;
  const isCurrent = () => activeVault === credentials && vaultSyncGeneration === generation;
  installLocalStorageHooks();
  vaultSyncInitializing = false;
  installVaultLocalListeners();

  try {
    await captureExistingLocalDates();
    if (!isCurrent()) return false;
    status(
      'Offline mode is active on this device only. Your encrypted changes are saved locally and will sync after your next online sign-in.',
      'info'
    );
    return true;
  } catch (error) {
    if (isCurrent()) {
      activeVault = null;
      removeVaultSyncListeners();
    }
    throw error;
  }
}

export async function startVaultSync(credentials) {
  if (!hasVerifiedDeviceSession(credentials)) {
    throw new TypeError('A verified device session is required before vault synchronization can start.');
  }
  activeVault = credentials;
  const generation = ++vaultSyncGeneration;
  const isCurrent = () => activeVault === credentials && vaultSyncGeneration === generation;
  vaultSyncInitializing = true;
  pendingVoiceNoteHydrationDates.clear();
  installLocalStorageHooks();

  // Attach before the first await. Diary and IndexedDB voice-note changes made
  // while the cloud snapshot loads are captured locally and held in the queue.
  installVaultLocalListeners();
  installVaultOnlineListener();

  try {
    status('Connecting to your private vault…');
    await vaultRequest('/vault/' + activeVault.vaultId + '/claim', { method: 'POST', body: {} });
    if (!isCurrent()) return false;

    // Capture actual local daily records first; do not manufacture an empty current-day
    // packet merely because account-wide settings exist on this device.
    await captureExistingLocalDates();
    if (!isCurrent()) return false;

    // Publish daily manifests only after their separate encrypted attachments
    // have been accepted by the Worker. A missing/new Worker route must not make
    // sign-in fail or publish references to unavailable audio objects.
    let voiceAttachmentsReady = true;
    try {
      const uploadSummary = await uploadAllPendingVoiceNoteAttachments();
      voiceAttachmentsReady = uploadSummary.pending === 0;
      if (!voiceAttachmentsReady) {
        status('Your account is open. Some encrypted voice notes remain safely saved on this device and will sync when their attachments are accepted.', 'info');
      }
    } catch (error) {
      if (error?.code === 'VAULT_SESSION_EXPIRED') throw error;
      voiceAttachmentsReady = false;
      console.warn('[Vault Sync] Encrypted voice notes remain queued locally; daily packet reconciliation will continue.', error);
      status('Your account is open. Encrypted voice notes remain safely saved on this device and will sync when storage is available.', 'info');
    }
    if (!isCurrent()) return false;
    // Voice attachments and daily packets have independent publication paths.
    // A delayed audio upload must never suppress checklist or Diary reconciliation.
    let syncOutcome = await synchronizeVault({ refreshAll: true, forceRemoteRead: true });
    if (!isCurrent()) return false;

    // Reconcile remote dates before attaching account-wide state to today's packet.
    // This lets a newly signed-in device receive today's Diary/location/voice data
    // instead of treating an empty bootstrap packet as a conflicting local edit.
    if (
        localStorage.getItem(GARDEN_STORAGE_KEY) !== null
        || localStorage.getItem(LEGACY_WRITING_CONFIG_KEY) !== null
        || localStorage.getItem('user_confidence_score') !== null
    ) {
      await captureDailyPacket(getCurrentDateString());
      if (!isCurrent()) return false;
      syncOutcome = await synchronizeVault();
      if (!isCurrent()) return false;
    }

    vaultSyncInitializing = false;
    vaultEventReconnectFailures = 0;
    connectVaultEventSocket(credentials, generation);
    // Changes captured while startup was in progress are now flushed through
    // the same serialized attachment-upload and packet-reconciliation path.
    if (pendingDailySyncDates.size || pendingFullVaultRefresh) {
      queueVaultSync({ refreshAll: true, immediate: true });
    }
    if (!voiceAttachmentsReady && syncOutcome?.complete) {
      status('Encrypted voice-note uploads remain queued on this device.', 'error');
    }
    return { ...(syncOutcome || { complete: false, restored: 0, remoteDateCount: 0, pendingDates: [], failedDates: [] }), voiceAttachmentsReady };
  } catch (error) {
    if (isCurrent()) {
      vaultSyncInitializing = false;
      if (dailySyncTimer !== null) window.clearTimeout(dailySyncTimer);
      dailySyncTimer = null;
      pendingDailySyncDates.clear();
      pendingFullVaultRefresh = false;
      removeVaultSyncListeners();
      activeVault = null;
    }
    throw error;
  }
}

function handleLocalDataChanged(event) {
  if (!activeVault) return;
  scheduleCapture(event?.detail?.dateString || getCurrentDateString());
}

function handleOnline() {
  if (!activeVault || activeVault.offlineOnly === true) return;
  queueVaultSync({ refreshAll: true, immediate: true });
  connectVaultEventSocket();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    closeVaultEventSocket();
    flushLocalVaultChanges();
    return;
  }
  if (document.visibilityState !== 'visible' || !activeVault || activeVault.offlineOnly === true) return;
  connectVaultEventSocket();
  const now = Date.now();
  if (now - lastForegroundSyncAt < FOREGROUND_SYNC_MIN_INTERVAL_MS) return;
  lastForegroundSyncAt = now;
  queueVaultSync({ refreshAll: true, immediate: true });
}

function flushLocalVaultChanges() {
  if (!activeVault) return Promise.resolve();
  if (localFlushPromise) return localFlushPromise;

  const operation = (async () => {
    try {
      await stopRegisteredVoiceNoteRecording();
      await flushAndSaveCurrentPrivateWriting();
      for (const queue of localCaptureQueues.values()) await queue;
    } catch (error) {
      console.warn('[Vault Sync] Local changes remain preserved for the next verified sign-in.', error);
    }
  })();

  localFlushPromise = operation.finally(() => {
    localFlushPromise = null;
  });
  return localFlushPromise;
}

export async function stopVaultSync() {
  // Invalidate in-flight startup before aborting requests or awaiting local flushes.
  vaultSyncGeneration += 1;
  vaultSyncInitializing = false;
  closeVaultEventSocket();
  vaultEventReconnectFailures = 0;
  if (dailySyncTimer !== null) window.clearTimeout(dailySyncTimer);
  dailySyncTimer = null;
  pendingDailySyncDates.clear();
  pendingFullVaultRefresh = false;
  try {
    if (activeVault) {
      activeVaultRequestControllers.forEach(controller => {
        try { controller.abort(); } catch { /* Continue clearing local session state. */ }
      });
      await flushLocalVaultChanges();
    }
  } finally {
    // Never retain the in-memory vault context if a local flush or cleanup fails.
    activeVaultRequestControllers.clear();
    if (dailySyncTimer !== null) window.clearTimeout(dailySyncTimer);
    dailySyncTimer = null;
    pendingDailySyncDates.clear();
    pendingFullVaultRefresh = false;
    removeVaultSyncListeners();
    activeVault = null;
  }
}

export async function exportEncryptedVaultPackets() {
  if (!activeVault) throw new Error('Sign in before exporting your encrypted vault.');
  await stopRegisteredVoiceNoteRecording();
  await flushAndSaveCurrentPrivateWriting();
  for (const queue of localCaptureQueues.values()) await queue;
  await captureExistingLocalDates();
  const packets = await listLocalDailyPackets();
  return packets.map(({ dateString, packet, remoteUpdatedAt }) => ({ dateString, packet, remoteUpdatedAt }));
}

export async function importEncryptedVaultPackets(packets, { voiceNotes = [] } = {}) {
  if (!activeVault) throw new Error('Sign in to the same account that created this backup before importing it.');
  if (!Array.isArray(packets) || packets.length > 5000
      || packets.some(item => !item || !isValidEncryptedPacket(item.packet)
        || item.dateString !== item.packet.dateString)
      || new Set(packets.map(item => item?.dateString)).size !== packets.length) {
    throw new Error('The selected backup contains an invalid or unsupported encrypted daily packet.');
  }
  if (!validatePrivateVoiceNoteBackup(voiceNotes)) {
    throw new Error('The backup contains invalid encrypted voice notes.');
  }

  // Authenticate and compare every daily packet before changing either local store.
  const prepared = [];
  const affectedDates = [];
  for (const item of packets) {
    const bundle = await decryptDailyBundle(item.packet, activeVault.encryptionKey, decompressData);
    if (bundle.dateString !== item.dateString) {
      throw new Error('A daily packet does not match its declared date.');
    }
    const existing = await getLocalDailyPacket(item.dateString);
    if (existing) {
      const existingBundle = await decryptDailyBundle(existing.packet, activeVault.encryptionKey, decompressData);
      if (canonicalBundle(existingBundle) !== canonicalBundle(bundle)) {
        throw new Error('This device already has different data for ' + item.dateString + '. Export the current copy before importing this packet; no local data was overwritten.');
      }
    }
    prepared.push({ item, bundle });
    affectedDates.push(item.dateString);
  }

  // Reject conflicting attachment IDs before restoring any packet or recording.
  const existingVoiceNotes = await exportEncryptedVoiceNotes();
  const existingVoiceById = new Map(existingVoiceNotes.map(record => [record.id, record]));
  for (const record of voiceNotes) {
    const previous = existingVoiceById.get(record.id);
    if (previous && (previous.dateString !== record.dateString
        || previous.ciphertext !== record.ciphertext
        || previous.iv !== record.iv)) {
      throw new Error('A voice note with the same identifier already exists with different encrypted data. No local records were changed.');
    }
  }

  // Snapshot all keys the bundle restore may affect, plus the exact packet state.
  const storageKeys = new Set([GARDEN_STORAGE_KEY, LEGACY_WRITING_CONFIG_KEY, 'user_confidence_score']);
  for (const { bundle } of prepared) Object.keys(bundle.records).forEach(key => storageKeys.add(key));
  const previousLocalValues = new Map();
  for (const key of storageKeys) previousLocalValues.set(key, localStorage.getItem(key));
  const existingDailyPackets = (await Promise.all(
    affectedDates.map(dateString => getLocalDailyPacket(dateString))
  )).filter(Boolean);

  await runBackupImportTransaction({
    apply: async () => {
      if (voiceNotes.length) await mergePrivateVoiceNotes(voiceNotes);
      for (const { bundle } of prepared) await restoreDailyBundle(bundle, { dispatch: false });
      const { importLocalDailyPackets } = await import('./vault-storage.js');
      await importLocalDailyPackets(packets);
    },
    rollback: [
      {
        label: 'daily-packet rollback',
        run: async () => {
          const { restoreLocalDailyPacketState } = await import('./vault-storage.js');
          await restoreLocalDailyPacketState(existingDailyPackets, affectedDates);
        }
      },
      {
        label: 'local-storage rollback',
        run: async () => {
          applyingRemotePacket += 1;
          try {
            for (const [key, value] of previousLocalValues) {
              if (value === null) localStorage.removeItem(key);
              else localStorage.setItem(key, value);
            }
          } finally {
            applyingRemotePacket -= 1;
          }
        }
      },
      {
        label: 'voice-note rollback',
        run: async () => {
          await restorePrivateVoiceNotes(existingVoiceNotes);
        }
      }
    ]
  });

  for (const { bundle } of prepared) {
    window.dispatchEvent(new CustomEvent('faith-focus:vault-data-restored', {
      detail: { dateString: bundle.dateString }
    }));
  }
  if (activeVault.offlineOnly !== true) {
    queueVaultSync({ refreshAll: true, immediate: true });
    status('Restored ' + packets.length + ' encrypted daily packet' + (packets.length === 1 ? '' : 's')
      + ' and ' + voiceNotes.length + ' encrypted voice note' + (voiceNotes.length === 1 ? '' : 's')
      + '. Cloud reconciliation is queued.', 'success');
  } else {
    status('Restored ' + packets.length + ' encrypted daily packet' + (packets.length === 1 ? '' : 's')
      + ' and ' + voiceNotes.length + ' encrypted voice note' + (voiceNotes.length === 1 ? '' : 's')
      + '. Your backup is saved locally and will sync after your next verified online sign-in.', 'success');
  }
}

export async function listTrustedDevices() {
  if (!activeVault || activeVault.offlineOnly === true) {
    throw new Error('Trusted-device management requires an online verified account session.');
  }
  const result = await vaultRequest('/vault/' + activeVault.vaultId + '/device/list');
  if (result?.ok !== true || !Array.isArray(result.devices)
      || typeof result.currentDeviceId !== 'string'
      || result.devices.length > 10
      || result.devices.some(device => !device
        || typeof device.deviceId !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/.test(device.deviceId)
        || typeof device.isCurrent !== 'boolean')) {
    throw new Error('The trusted-device list returned an invalid response.');
  }
  return result;
}

export async function removeTrustedDevice(deviceId) {
  if (!activeVault || activeVault.offlineOnly === true) {
    throw new Error('Trusted-device management requires an online verified account session.');
  }
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(deviceId)) {
    throw new TypeError('A valid trusted-device identifier is required.');
  }
  if (deviceId === activeVault.deviceId) {
    throw new Error('This device cannot remove its own active registration.');
  }
  return vaultRequest('/vault/' + activeVault.vaultId + '/device/remove', {
    method: 'POST',
    body: { deviceId }
  });
}

export function isVaultSyncActive() {
  return Boolean(activeVault);
}

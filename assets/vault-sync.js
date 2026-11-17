import { compressData, decompressData } from './compressor.js';
import {
  encodeBase64Url, encryptDailyBundle, decryptDailyBundle, isValidEncryptedPacket,
  isValidDateString
} from './vault-crypto.js';
import {
  getLocalDailyPacket, listLocalDailyPackets, putLocalDailyPacket, markLocalDailyPacketSynced
} from './vault-storage.js';
import {
  exportEncryptedVoiceNotes, exportEncryptedVoiceNotesForDate, exportEncryptedVoiceNotesForDateFull,
  restoreEncryptedVoiceNotesForDate, getEncryptedVoiceNoteRecord, markEncryptedVoiceNoteUploaded,
  saveEncryptedVoiceNoteRecord, createVoiceNoteAttachmentManifest, validateEncryptedVoiceNoteRecord,
  VOICE_NOTE_ATTACHMENT_CHUNK_CHARS, MAX_VOICE_NOTE_ATTACHMENT_CHUNKS
} from './voice-note-store.js';
import { GARDEN_STORAGE_KEY, GARDEN_DAILY_SYNC_PREFIX, mergeGardenStates, validateGardenState } from './garden-model.js';
import { mergeDailyBundles } from './daily-merge.js';
import { flushAndSaveCurrentPrivateWriting, stopRegisteredVoiceNoteRecording, mergeEncryptedPrivateWritingRecords } from './writing-security.js';

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
  GARDEN_DAILY_SYNC_PREFIX
];
const LEGACY_WRITING_CONFIG_KEY = 'dmp_private_writing_crypto_v1';

let activeVault = null;
let vaultSyncGeneration = 0;
let applyingRemotePacket = 0;
let syncQueue = Promise.resolve();
let localChangeSyncQueue = Promise.resolve();
let pendingDailySyncDates = new Set();
let dailySyncTimer = null;
let pendingFullVaultRefresh = false;
let lastCloudSyncStartedAt = 0;
let lastForegroundSyncAt = 0;
const DAILY_SYNC_DEBOUNCE_MS = 1200;
const DAILY_SYNC_MIN_INTERVAL_MS = 3500;
const FOREGROUND_SYNC_MIN_INTERVAL_MS = 5000;
let localCaptureQueues = new Map();
let localChangeVersions = new Map();
let lastStatus = '';
let storageHooksInstalled = false;
let localFlushPromise = null;
let activeVaultRequestControllers = new Set();

const byId = id => document.getElementById(id);

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
  checklist.cloud_flow_version = 1;
  records[checklistKey] = JSON.stringify(checklist);

  // Keep the current Garden snapshot inside every newly captured daily packet.
  // It is merged independently from checklist records when a date conflict exists.
  const gardenRecordKey = GARDEN_DAILY_SYNC_PREFIX + dateString;
  const gardenSnapshot = localStorage.getItem(GARDEN_STORAGE_KEY);
  if (gardenSnapshot !== null) records[gardenRecordKey] = gardenSnapshot;
  else delete records[gardenRecordKey];

  const voiceNotes = await exportEncryptedVoiceNotesForDate(dateString);
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
    throw new Error('Your device session has expired. Sign in again to securely reconnect this device.');
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
    if (response.status === 401) throw new Error('This device session is no longer valid. Sign in again to securely reconnect this device.');
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
      if (response.status === 401) throw new Error('Your device session expired. Sign in again before synchronizing voice notes.');
      if (response.status === 404) return null;
      if (response.status === 413) throw new Error('An encrypted voice-note segment exceeds the request limit. Its local copy remains saved.');
      if (response.status === 429) throw new Error(result.error || 'The cloud service is receiving too many requests. Try again later.');
      throw new Error(result.error || 'Voice-note synchronization failed (HTTP ' + response.status + ').');
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'NetworkError') {
      throw new Error('Voice-note synchronization is temporarily unavailable. The encrypted recording remains saved on this device.');
    }
    throw error;
  } finally {
    activeVaultRequestControllers.delete(controller);
  }
}

async function uploadPendingVoiceNoteAttachments(dateString) {
  if (!activeVault || activeVault.offlineOnly === true) return 0;
  const records = await exportEncryptedVoiceNotesForDateFull(dateString);
  let uploaded = 0;
  for (const record of records) {
    if (record.remoteUploaded === true) continue;
    const ciphertextLength = record.ciphertext.length;
    const totalChunks = Math.ceil(ciphertextLength / VOICE_NOTE_ATTACHMENT_CHUNK_CHARS);
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * VOICE_NOTE_ATTACHMENT_CHUNK_CHARS;
      const ciphertextChunk = record.ciphertext.slice(start, start + VOICE_NOTE_ATTACHMENT_CHUNK_CHARS);
      const result = await requestVoiceNoteAttachment(dateString, record.id, {
        index, ciphertextChunk, ciphertextLength, totalChunks
      });
      if (result?.id !== record.id || result?.dateString !== dateString
          || result?.stored !== true || result?.index !== index || result?.totalChunks !== totalChunks) {
        throw new Error('The cloud did not confirm encrypted voice-note segment ' + (index + 1) + ' of ' + totalChunks + '. The full local recording remains queued.');
      }
    }
    await markEncryptedVoiceNoteUploaded(record.id);
    uploaded += 1;
  }
  return uploaded;
}

async function uploadAllPendingVoiceNoteAttachments() {
  if (!activeVault || activeVault.offlineOnly === true) return 0;
  const records = await exportEncryptedVoiceNotes();
  const dates = [...new Set(records.map(record => record.dateString))].sort();
  let uploaded = 0;
  for (const dateString of dates) uploaded += await uploadPendingVoiceNoteAttachments(dateString);
  return uploaded;
}

async function hydrateVoiceNoteAttachments(dateString, notes) {
  if (!Array.isArray(notes) || notes.length > 100) {
    throw new Error('The daily packet contains an invalid voice-note list. Both encrypted copies remain preserved.');
  }
  const localRecords = await exportEncryptedVoiceNotesForDateFull(dateString);
  const localById = new Map(localRecords.map(record => [record.id, record]));
  const hydrated = [];
  for (const note of notes) {
    if (!validateEncryptedVoiceNoteRecord(note) || note.dateString !== dateString) {
      throw new Error('A voice-note entry failed validation. Both encrypted copies remain preserved.');
    }
    if (typeof note.ciphertext === 'string') {
      // Legacy packets embed the full audio, but the separate attachment key
      // may not exist yet. Queue it for the next authorized upload pass.
      hydrated.push({ ...note, remoteUploaded: false });
      continue;
    }
    const local = localById.get(note.id);
    if (local) {
      const localManifest = createVoiceNoteAttachmentManifest(local);
      if (JSON.stringify(localManifest) !== JSON.stringify(note)) {
        throw new Error('A local voice note does not match the synchronized manifest. Both copies remain preserved.');
      }
      hydrated.push(local);
      continue;
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
  return hydrated;
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
    if (this === window.localStorage && !applyingRemotePacket && !window.__faithFocusVaultMigration) {
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
    if (this === window.localStorage && !applyingRemotePacket) {
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

function restoreSharedAppState(bundle, { replaceConfidence = false } = {}) {
  if (!bundle || typeof bundle !== 'object') return;
  applyingRemotePacket += 1;
  try {
    const localGardenRaw = localStorage.getItem(GARDEN_STORAGE_KEY);
    let mergedGarden = parseGardenSnapshot(localGardenRaw);
    const gardenRecord = bundle.records?.[GARDEN_DAILY_SYNC_PREFIX + bundle.dateString];
    for (const candidate of [gardenRecord, bundle.appState?.garden]) {
      const incomingGarden = parseGardenSnapshot(candidate);
      if (incomingGarden) mergedGarden = mergeGardenStates(mergedGarden, incomingGarden);
    }
    if (mergedGarden && JSON.stringify(mergedGarden) !== JSON.stringify(parseGardenSnapshot(localGardenRaw))) {
      localStorage.setItem(GARDEN_STORAGE_KEY, JSON.stringify(mergedGarden));
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

async function restoreDailyBundle(bundle) {
  const hydratedVoiceNotes = await hydrateVoiceNoteAttachments(bundle.dateString, bundle.voiceNotes);
  applyingRemotePacket += 1;
  try {
    for (const [key, value] of Object.entries(bundle.records)) {
      if (key.startsWith(GARDEN_DAILY_SYNC_PREFIX)) continue;
      if (isDailyRecordKey(key) && typeof value === 'string') localStorage.setItem(key, value);
    }
    restoreSharedAppState(bundle, { replaceConfidence: true });
    await restoreEncryptedVoiceNotesForDate(bundle.dateString, hydratedVoiceNotes);
  } finally {
    applyingRemotePacket -= 1;
  }
  window.dispatchEvent(new CustomEvent('faith-focus:vault-data-restored', { detail: { dateString: bundle.dateString } }));
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

async function uploadDailyPacket(dateString, { baseUpdatedAt } = {}) {
  const local = await getLocalDailyPacket(dateString);
  if (!local?.dirty) return false;
  const localChangeVersion = localChangeVersions.get(dateString) || 0;
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
  if (!syncResult.stillMatchesUploadedSnapshot) scheduleCapture(dateString);
  return true;
}

async function reconcileDay(dateString, remoteUpdatedAt) {
  for (let attempt = 1; attempt <= MAX_DATE_RECONCILE_ATTEMPTS; attempt += 1) {
    try {
      // reconcileDayOnce fetches the latest remote packet on every attempt, then
      // merges it with the latest local encrypted packet before a guarded write.
      return await reconcileDayOnce(dateString, remoteUpdatedAt);
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

async function reconcileDayOnce(dateString, remoteUpdatedAt) {
  const local = await getLocalDailyPacket(dateString);
  const localChangeVersion = localChangeVersions.get(dateString) || 0;
  if (!local) {
    console.log('[Vault Sync] Remote date has no local packet; fetching and restoring encrypted date:', {
      vaultId: activeVault.vaultId, dateString, packetKey: activeVault.vaultId + ':' + dateString,
      remoteUpdatedAt: remoteUpdatedAt || null
    });
    const remote = await fetchRemoteDay(dateString);
    if (!remote.packet) return false;
    const bundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
    await restoreDailyBundle(bundle);
    await putLocalDailyPacket({
      dateString, packet: remote.packet, localUpdatedAt: Date.now(),
      remoteUpdatedAt: remote.updatedAt || remoteUpdatedAt, dirty: false
    });
    return true;
  }

  if (local.dirty) {
    const remote = await fetchRemoteDay(dateString);
    if (!remote.packet) return uploadDailyPacket(dateString, { baseUpdatedAt: remote.updatedAt || null });
    const remoteBundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
    const localBundle = await decryptDailyBundle(local.packet, activeVault.encryptionKey, decompressData);
    if (canonicalBundle(remoteBundle) === canonicalBundle(localBundle)) {
      restoreSharedAppState(remoteBundle);
      const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
      const syncResult = await markLocalDailyPacketSynced(
        dateString,
        remote.updatedAt || remoteUpdatedAt,
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
      mergedBundle = await mergeDailyBundles(localBundle, remoteBundle, {
        dateString,
        mergePrivateWriting: (localWriting, remoteWriting) =>
          mergeEncryptedPrivateWritingRecords(dateString, localWriting, remoteWriting, activeVault.encryptionKey),
        isUsableLegacyWritingConfig
      });
    } catch (error) {
      // A legacy-key or otherwise unreadable private entry must never prevent
      // account login. Keep both encrypted packets intact and retry after the
      // device completes its one-time Diary key migration.
      console.warn('[Vault Sync] Same-day Diary merge is deferred; both encrypted packets remain preserved:', {
        dateString,
        reason: error?.message || String(error)
      });
      status(
        'Your account is open, but one device has a Diary entry that still needs its previous writing key. Both encrypted copies are preserved. Complete the one-time Diary migration, then sync again.',
        'error'
      );
      return false;
    }
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
      await restoreDailyBundle(mergedBundle);
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
  if (remoteUpdatedAt && remoteUpdatedAt !== localRemote) {
    if (!localRemote || remoteUpdatedAt > localRemote) console.log('[Vault Sync] Newer remote date detected:', { vaultId: activeVault.vaultId, dateString, remoteUpdatedAt, localRemoteUpdatedAt: localRemote });
    const remote = await fetchRemoteDay(dateString);
    if (remote.packet && remote.updatedAt && (!localRemote || remote.updatedAt > localRemote)) {
      const bundle = await decryptDailyBundle(remote.packet, activeVault.encryptionKey, decompressData);
      const unchangedSinceSnapshot = (localChangeVersions.get(dateString) || 0) === localChangeVersion;
      const syncResult = await markLocalDailyPacketSynced(
        dateString,
        remote.updatedAt,
        remote.packet,
        { requirePacketMatch: true, expectedPacket: unchangedSinceSnapshot ? local.packet : null }
      );
      if (!syncResult.stillMatchesUploadedSnapshot) {
        scheduleCapture(dateString);
        return false;
      }
      await restoreDailyBundle(bundle);
      return true;
    }
  }
  return false;
}

function synchronizeVault() {
  if (!activeVault || activeVault.offlineOnly === true) return Promise.resolve();
  const operation = syncQueue.catch(() => {}).then(() => performVaultSync());
  syncQueue = operation.catch(() => {});
  return operation;
}

function queueVaultSync({ dateString = null, refreshAll = false, immediate = false } = {}) {
  if (!activeVault || activeVault.offlineOnly === true) return;
  if (isValidDateString(dateString)) pendingDailySyncDates.add(dateString);
  if (refreshAll) pendingFullVaultRefresh = true;

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
        await uploadAllPendingVoiceNoteAttachments();
      } else {
        for (const pendingDate of dates) {
          if (!isCurrent()) return;
          await uploadPendingVoiceNoteAttachments(pendingDate);
        }
      }

      if (!isCurrent()) return;
      await synchronizeVault();
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

async function performVaultSync() {
  if (!activeVault || activeVault.offlineOnly === true) return;
  try {
    status('Checking your encrypted vault…');
    const index = await fetchRemoteIndex();
    const remoteDates = Object.keys(index).filter(isValidDateString).sort();
    console.log('[Vault Sync] Shared index received:', { vaultId: activeVault.vaultId, key: activeVault.vaultId + ':index', remoteDateCount: remoteDates.length, remoteDates });
    let restored = 0;

    for (const dateString of remoteDates) {
      const remoteUpdatedAt = typeof index[dateString] === 'string' ? index[dateString] : null;
      if (await reconcileDay(dateString, remoteUpdatedAt)) restored += 1;
    }

    const localRecords = await listLocalDailyPackets();
    for (const record of localRecords) {
      if (!record.dirty || Object.hasOwn(index, record.dateString)) continue;
      // Re-read the remote date before uploading. The index can change while
      // this pass is running, so even dates absent from the initial index must
      // go through the same guarded reconciliation path.
      await reconcileDay(record.dateString, null);
    }

    const finalLocalRecords = await listLocalDailyPackets();
    const pendingRecords = finalLocalRecords.filter(record => record.dirty);
    if (pendingRecords.length) {
      const pendingDates = pendingRecords.map(record => record.dateString).sort();
      status(
        'Some encrypted local packets remain queued: ' + pendingDates.join(', ') +
        '. They remain saved securely on this device and will retry when the connection returns, the app returns to the foreground, or you sign in again.',
        'error'
      );
    } else if (restored) {
      status('Restored ' + restored + ' newer daily packet' + (restored === 1 ? '' : 's') + ' from your vault.', 'success');
    } else {
      status('Your encrypted vault is up to date on this device.', 'success');
    }
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
  for (const dateString of [...dates].sort()) await captureDailyPacket(dateString);
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
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
  window.addEventListener('pagehide', flushLocalVaultChanges);

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
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
      window.removeEventListener('pagehide', flushLocalVaultChanges);
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
  installLocalStorageHooks();

  try {
    status('Connecting to your private vault…');
    await vaultRequest('/vault/' + activeVault.vaultId + '/claim', { method: 'POST', body: {} });
  } catch (error) {
    if (isCurrent()) activeVault = null;
    throw error;
  }
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
    await uploadAllPendingVoiceNoteAttachments();
  } catch (error) {
    voiceAttachmentsReady = false;
    console.warn('[Vault Sync] Encrypted voice notes remain queued locally; daily manifests were not published.', error);
    status('Your account is open. Encrypted voice notes remain safely saved on this device and will sync after the storage service is ready.', 'info');
  }
  if (!isCurrent()) return false;
  if (voiceAttachmentsReady) {
    await synchronizeVault();
    if (!isCurrent()) return false;
  }

  // Reconcile remote dates before attaching account-wide state to today's packet.
  // This lets a newly signed-in device receive today's Diary/location/voice data
  // instead of treating an empty bootstrap packet as a conflicting local edit.
  if (voiceAttachmentsReady && (
      localStorage.getItem(GARDEN_STORAGE_KEY) !== null
      || localStorage.getItem(LEGACY_WRITING_CONFIG_KEY) !== null
      || localStorage.getItem('user_confidence_score') !== null
  )) {
    await captureDailyPacket(getCurrentDateString());
    if (!isCurrent()) return false;
    await synchronizeVault();
    if (!isCurrent()) return false;
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
  window.addEventListener('online', handleOnline);
  window.addEventListener('pagehide', flushLocalVaultChanges);
  return true;
}

function handleLocalDataChanged(event) {
  if (!activeVault) return;
  scheduleCapture(event?.detail?.dateString || getCurrentDateString());
}

function handleOnline() {
  if (!activeVault || activeVault.offlineOnly === true) return;
  queueVaultSync({ refreshAll: true, immediate: true });
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    flushLocalVaultChanges();
    return;
  }
  if (document.visibilityState !== 'visible' || !activeVault || activeVault.offlineOnly === true) return;
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
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('faith-focus:local-data-changed', handleLocalDataChanged);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('pagehide', flushLocalVaultChanges);
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

export async function importEncryptedVaultPackets(packets) {
  if (!activeVault) throw new Error('Sign in to the same account that created this backup before importing it.');
  if (!Array.isArray(packets) || packets.length > 5000
      || packets.some(item => !item || !isValidEncryptedPacket(item.packet)
        || item.dateString !== item.packet.dateString)) {
    throw new Error('The selected backup contains an invalid or unsupported encrypted daily packet.');
  }
  const prepared = [];
  for (const item of packets) {
    const bundle = await decryptDailyBundle(item.packet, activeVault.encryptionKey, decompressData);
    const existing = await getLocalDailyPacket(item.dateString);
    if (existing) {
      const existingBundle = await decryptDailyBundle(existing.packet, activeVault.encryptionKey, decompressData);
      if (canonicalBundle(existingBundle) !== canonicalBundle(bundle)) {
        throw new Error('This device already has different data for ' + item.dateString + '. Export the current copy before importing this packet; no local data was overwritten.');
      }
    }
    prepared.push({ item, bundle });
  }

  // Restore source records only after every imported packet is authenticated and
  // checked against the existing local version, so a partially invalid file
  // cannot replace some dates while leaving others untouched.
  for (const { bundle } of prepared) await restoreDailyBundle(bundle);
  const { importLocalDailyPackets } = await import('./vault-storage.js');
  await importLocalDailyPackets(packets);
  status('Restored ' + packets.length + ' validated encrypted daily packet' + (packets.length === 1 ? '' : 's') + '. The packets will be reconciled at the next verified sign-in.', 'success');
}

export function isVaultSyncActive() {
  return Boolean(activeVault);
}

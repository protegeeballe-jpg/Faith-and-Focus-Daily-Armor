import {
  exportEncryptedVaultPackets, importEncryptedVaultPackets, isVaultSyncActive
} from './vault-sync.js';
import { exportPrivateVoiceNotes, mergePrivateVoiceNotes, validatePrivateVoiceNoteBackup } from './writing-security.js';

const BACKUP_FORMAT = 'faith-focus-encrypted-vault-export';
const BACKUP_VERSION = 1;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const byId = id => document.getElementById(id);

function setStatus(message, state = 'info') {
  const element = byId('vault-backup-status');
  if (element) {
    element.textContent = message;
    element.dataset.state = state;
  }
}

function setBusy(busy) {
  ['vault-export-button', 'vault-import-button'].forEach(id => {
    const button = byId(id);
    if (button) button.disabled = busy;
  });
}

async function exportBackup() {
  if (!isVaultSyncActive()) {
    setStatus('Sign in before exporting your encrypted vault.', 'error');
    return;
  }
  setBusy(true);
  setStatus('Preparing your encrypted daily packets…');
  try {
    const packets = await exportEncryptedVaultPackets();
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      packets,
      voiceNotes: await exportPrivateVoiceNotes()
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'faith-focus-encrypted-vault-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Exported ' + packets.length + ' encrypted daily packet' + (packets.length === 1 ? '' : 's') + '. The file contains ciphertext, not readable Diary content.', 'success');
  } catch (error) {
    setStatus(error?.message || 'The encrypted JSON file could not be exported.', 'error');
  } finally {
    setBusy(false);
  }
}

function validateBackupFile(payload) {
  if (!payload || payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION
      || !Array.isArray(payload.packets) || payload.packets.length > 5000) {
    throw new Error('This is not a supported Faith & Focus encrypted vault export.');
  }
  const dates = new Set();
  for (const record of payload.packets) {
    if (!record || typeof record !== 'object'
        || typeof record.dateString !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(record.dateString)
        || !record.packet || record.packet.dateString !== record.dateString
        || dates.has(record.dateString)) {
      throw new Error('The backup contains an invalid or duplicate daily packet.');
    }
    dates.add(record.dateString);
  }
  const voiceNotes = payload.voiceNotes === undefined ? [] : payload.voiceNotes;
  if (!validatePrivateVoiceNoteBackup(voiceNotes)) {
    throw new Error('The backup contains invalid encrypted voice notes.');
  }
  return { packets: payload.packets, voiceNotes };
}

async function importBackupFile(file) {
  if (!isVaultSyncActive()) {
    setStatus('Sign in to the same account that created this backup before importing it.', 'error');
    return;
  }
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    setStatus('This JSON file exceeds the 50 MB import limit.', 'error');
    return;
  }
  setBusy(true);
  setStatus('Checking the encrypted vault file…');
  try {
    const payload = JSON.parse(await file.text());
    const backup = validateBackupFile(payload);
    // Restore full encrypted recordings before daily bundles hydrate their manifests.
    // A backup may be the only source of the separate audio attachments.
    if (backup.voiceNotes.length) await mergePrivateVoiceNotes(backup.voiceNotes);
    await importEncryptedVaultPackets(backup.packets);
    setStatus(
      'Imported ' + backup.packets.length + ' encrypted daily packet' + (backup.packets.length === 1 ? '' : 's')
        + ' and ' + backup.voiceNotes.length + ' encrypted voice note' + (backup.voiceNotes.length === 1 ? '' : 's')
        + '. Automatic cloud reconciliation is queued.',
      'success'
    );
  } catch (error) {
    setStatus(error?.message || 'The encrypted vault file could not be imported.', 'error');
  } finally {
    setBusy(false);
    const input = byId('vault-import-file');
    if (input) input.value = '';
  }
}

function initializeLocalBackup() {
  const exportButton = byId('vault-export-button');
  const importButton = byId('vault-import-button');
  const input = byId('vault-import-file');
  if (!exportButton || !importButton || !input) return;
  exportButton.addEventListener('click', exportBackup);
  importButton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => importBackupFile(input.files?.[0] || null));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLocalBackup, { once: true });
} else {
  initializeLocalBackup();
}

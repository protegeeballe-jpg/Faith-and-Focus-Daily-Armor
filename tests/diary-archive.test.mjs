import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidDiaryArchiveDate } from '../assets/diary-archive.js';

test('Diary archive accepts valid calendar dates, including leap days', () => {
  assert.equal(isValidDiaryArchiveDate('2024-02-29'), true);
  assert.equal(isValidDiaryArchiveDate('2026-11-19'), true);
  assert.equal(isValidDiaryArchiveDate('2000-02-29'), true);
});

test('Diary archive rejects impossible calendar dates and malformed values', () => {
  for (const value of [
    '2023-02-29',
    '1900-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-1-01',
    '26-11-19',
    '',
    null,
    undefined,
    20261119,
    {},
    []
  ]) {
    assert.equal(isValidDiaryArchiveDate(value), false, String(value));
  }
});

test('archived Diary reads use the validated shared calendar-date helper', () => {
  const writing = readFileSync(new URL('../assets/writing-security.js', import.meta.url), 'utf8');
  assert.match(writing, /import \{ isValidDiaryArchiveDate \} from '\.\/diary-archive\.js';/);
  assert.match(writing, /if\(!isValidDiaryArchiveDate\(dateStr\)\)/);
  assert.match(writing, /decryptPrivatePayload\('diary',dateStr,record,writingCryptoKey\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const garden = readFileSync(new URL('../assets/garden.js', import.meta.url), 'utf8');
const gardenCss = readFileSync(new URL('../assets/garden.css', import.meta.url), 'utf8');

test('Checklist uses one visible page heading and the shared Room navigation control', () => {
  const headerStart = html.indexOf('<header id="checklist-header"');
  const headerEnd = html.indexOf('</header>', headerStart) + '</header>'.length;
  assert.ok(headerStart >= 0 && headerEnd > headerStart, 'the Checklist header must exist');
  const checklistHeader = html.slice(headerStart, headerEnd);

  assert.match(checklistHeader, /id="checklist-page-title"[^>]*>My Health Checklist</);
  assert.doesNotMatch(checklistHeader, /data-page="garden"|>Room<\/button>/);
  assert.match(html, /id="garden-close"[^>]*data-garden-action="back-to-room"[^>]*aria-label="Return to The Forge Room"/);
  assert.match(garden, /overlay\.classList\.toggle\('garden-checklist-active', sceneName === 'checklist'\)/);
  assert.match(gardenCss, /\.garden-overlay\.garden-checklist-active > \.garden-shell > \.garden-screen-title,[\s\S]*?\.garden-overlay\.garden-checklist-active > \.garden-shell > \.garden-intro\s*\{\s*display:\s*none;/);
});

test('the full-screen scene accessible name follows the visible Checklist heading', () => {
  assert.match(garden, /const dialogLabel = sceneName === 'checklist' \? byId\('checklist-page-title'\) : heading;/);
  assert.match(garden, /if \(dialogLabel\?\.id\) overlay\.setAttribute\('aria-labelledby', dialogLabel\.id\)/);
  assert.match(garden, /const focusTarget = dialogLabel;[\s\S]*?focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
});

test('Diary scene copy reflects the verified shared account-key design', () => {
  assert.match(garden, /diary: 'A private place for your thoughts\. Your writing is encrypted with your account key\.'/);
  assert.doesNotMatch(garden, /separate passphrase/);
  assert.match(html, /New Diary entries use the same account key as your Health Checklist and daily vault/);
});

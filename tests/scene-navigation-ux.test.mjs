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

  assert.match(checklistHeader, /id="checklist-page-title"[^>]*>My Health Checklist/);
  assert.match(checklistHeader, /data-garden-action="back-to-room"[^>]*aria-label="Return to The Forge Room"[^>]*>← Room<\/button>/);
  assert.doesNotMatch(html, /id="garden-close"/);
  const topbarStart = html.indexOf('<header class="garden-topbar">');
  const topbarEnd = html.indexOf('</header>', topbarStart) + '</header>'.length;
  const topbar = html.slice(topbarStart, topbarEnd);
  assert.ok(topbarStart >= 0 && topbarEnd > topbarStart, 'the shared Garden top bar must exist');
  assert.match(topbar, /id="settings-open-button"/);
  assert.match(topbar, /id="garden-diary-room-button"[^>]*data-garden-action="back-to-room"[^>]*aria-label="Return to The Forge Room"[^>]*>← Room<\/button>/);
  assert.match(html, /data-garden-action="back-to-room"[^>]*>Back to my forge room 🏡<\/button>/);
  assert.match(garden, /case 'back-to-room':[\s\S]*?renderRoom\(\);[\s\S]*?setScene\('room'\);/);
  assert.doesNotMatch(gardenCss, /garden-topbar-actions \[data-garden-action="back-to-room"\]/);
  assert.match(garden, /overlay\.classList\.toggle\('garden-checklist-active', sceneName === 'checklist'\)/);
  assert.match(garden, /overlay\.classList\.toggle\('garden-diary-active', sceneName === 'diary'\)/);
  assert.match(gardenCss, /\.garden-diary-room-button\s*\{[^}]*display:\s*none/s);
  assert.match(gardenCss, /\.garden-overlay\.garden-diary-active \.garden-diary-room-button\s*\{[^}]*display:\s*inline-flex/s);
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


test('Forge Room actions are compact while retaining their original destinations', () => {
  const roomStart = html.indexOf('<section data-garden-scene="room"');
  const outdoorStart = html.indexOf('<section data-garden-scene="outdoors"', roomStart);
  assert.ok(roomStart >= 0 && outdoorStart > roomStart);
  const roomMarkup = html.slice(roomStart, outdoorStart);
  assert.match(roomMarkup, /data-action="showPage" data-page="checklist" aria-label="Open Health Checklist">Checklist 📝/);
  assert.match(roomMarkup, /data-action="showPage" data-page="diary" aria-label="Open Personal Diary">Diary 🔐/);
  assert.match(roomMarkup, /data-garden-action="visit-garden" aria-label="Visit the Garden">Garden 🌳/);
  const compactRules = gardenCss.slice(gardenCss.indexOf('/* Diary-only Room navigation'));
  assert.match(compactRules, /garden-room-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(compactRules, /garden-room-actions \.garden-action-button\s*\{[^}]*width:\s*auto/s);
});

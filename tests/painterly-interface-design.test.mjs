import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const gardenCss = readFileSync(new URL('../assets/garden.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('the design foundation keeps the watercolor paper palette and painterly grain', () => {
  for (const token of [
    '--ff-paper:', '--ff-paper-light:', '--ff-ink:', '--ff-sage:',
    '--ff-honey:', '--ff-lavender:', '--ff-watercolor-line:',
    '--ff-watercolor-shadow:', '--ff-focus:'
  ]) {
    assert.ok(appCss.includes(token), 'missing shared design token: ' + token);
  }

  assert.match(appCss, /repeating-linear-gradient\(0deg/);
  assert.match(gardenCss, /url\("\.\/garden-room-background\.jpg"\)/);
  assert.match(gardenCss, /garden-room-home/);
  assert.match(html, /assets\/lexend\.css/);
  assert.match(html, /assets\/garden\.css/);
});

test('the account gate uses readable fields and comfortable touch targets', () => {
  assert.match(appCss, /#view-pin input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\s*\{[^}]*min-height:\s*48px/s);
  assert.match(appCss, /#view-pin input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\s*\{[^}]*font-size:\s*16px/s);
  assert.match(appCss, /#view-pin button\s*\{\s*min-height:\s*44px/);
  assert.match(appCss, /#view-pin button\[type="submit"\]\s*\{\s*min-height:\s*48px/);
});

test('the launcher presents its two destinations as balanced, responsive watercolor cards', () => {
  assert.match(html, /id="view-launcher"/);
  assert.match(html, /data-page="checklist"/);
  assert.match(html, /data-garden-action="open-garden"/);
  assert.match(appCss, /#view-launcher > \.grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/s);
  assert.match(appCss, /#view-launcher \[role="button"\]\s*\{[^}]*min-height:\s*15rem/s);
  assert.match(appCss, /#view-launcher \.card-sage\s*\{/);
  assert.match(appCss, /#view-launcher \.card-yellow\s*\{/);
});

test('shared scenes use consistent painterly surfaces and accessible interactive sizing', () => {
  assert.match(gardenCss, /\.garden-topbar\s*\{[^}]*background:\s*rgba\(255, 253, 247, \.86\)/s);
  assert.match(gardenCss, /\.garden-action-button,\s*\.garden-small-button,\s*\.garden-settings-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(gardenCss, /\.garden-checklist-scene \.checklist-header-button,\s*\.garden-checklist-scene \.guide-quote-launch\s*\{\s*min-height:\s*44px/s);
  assert.match(gardenCss, /#private-diary-entry\s*\{[^}]*font-size:\s*16px/s);
  assert.match(gardenCss, /\.settings-disclosure\s*\{[^}]*border-radius:\s*\.95rem/s);
  assert.match(gardenCss, /\.settings-modal \.drive-sync-panel \.garden-action-button\s*\{\s*min-height:\s*44px/s);
  assert.match(gardenCss, /:where\(summary\):focus-visible/);
});

test('keyboard focus and reduced-motion preferences are respected throughout the app', () => {
  assert.match(appCss, /:where\(button, a, input, select, textarea, \[role="button"\], \[tabindex\]\):focus-visible/);
  assert.match(appCss, /outline:\s*3px solid var\(--ff-focus\)/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*\.01ms/);
  assert.match(appCss, /transition-duration:\s*\.01ms/);
});

test('the offline shell version changes when the visual app shell changes', () => {
  assert.match(serviceWorker, /faith-focus-shell-v36-offline-diary-notes/);
  assert.match(serviceWorker, /\.\/assets\/app\.css/);
  assert.match(serviceWorker, /\.\/assets\/garden\.css/);
  assert.match(serviceWorker, /\.\/assets\/garden-room-background\.jpg/);
});


test('the Diary uses a distinct blue-and-honey watercolor paper treatment', () => {
  const diaryTheme = gardenCss.slice(gardenCss.lastIndexOf('.garden-overlay.garden-diary-active {'));
  assert.ok(diaryTheme.length > 0, 'missing Diary-specific watercolor theme');
  assert.match(diaryTheme, /background-color:\s*#f1f7fb/);
  assert.match(diaryTheme, /rgba\(112,\s*174,\s*211/);
  assert.match(diaryTheme, /rgba\(244,\s*207,\s*116/);
  assert.match(diaryTheme, /repeating-linear-gradient/);
  assert.match(diaryTheme, /#view-diary > \.card-lavender::before/);
  assert.match(diaryTheme, /#private-diary-entry:focus-visible/);
  assert.match(diaryTheme, /pointer-events:\s*none/);
  assert.match(diaryTheme, /diary-archive-dialog/);
  assert.match(diaryTheme, /diary-archive-date-button/);
  assert.match(diaryTheme, /diary-archive-empty/);
});

test('the Forge Room retains its illustration beneath watercolor pigment and paper grain', () => {
  const forgeTheme = gardenCss.slice(gardenCss.lastIndexOf('.garden-overlay.garden-room-home {'));
  assert.ok(forgeTheme.length > 0, 'missing Forge Room watercolor enhancement');
  assert.match(forgeTheme, /url\("\.\/garden-room-background\.jpg"\)/);
  assert.match(forgeTheme, /repeating-linear-gradient/);
  assert.match(forgeTheme, /radial-gradient/);
  assert.match(forgeTheme, /\.garden-room-card::before/);
  assert.match(forgeTheme, /pointer-events:\s*none/);
});

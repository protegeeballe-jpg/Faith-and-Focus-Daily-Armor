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
  assert.match(gardenCss, /\.garden-checklist-scene \.checklist-header-button,\s*\.garden-checklist-scene \.guide-launch\s*\{\s*min-height:\s*44px/s);
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
  assert.match(serviceWorker, /faith-focus-shell-v24-stable-app/);
  assert.match(serviceWorker, /\.\/assets\/app\.css/);
  assert.match(serviceWorker, /\.\/assets\/garden\.css/);
  assert.match(serviceWorker, /\.\/assets\/garden-room-background\.jpg/);
});

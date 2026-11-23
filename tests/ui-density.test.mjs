import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const density = readFileSync(new URL('../assets/mobile.css', import.meta.url), 'utf8');

test('shared UI density stylesheet remains last in the application style cascade', () => {
  const app = html.indexOf('assets/app.css');
  const garden = html.indexOf('assets/garden.css');
  const mobile = html.indexOf('assets/mobile.css');
  assert.ok(app >= 0 && garden > app && mobile > garden);
});

test('shared typography scale reduces oversized type without shrinking the base font excessively', () => {
  assert.match(density, /--ff-ui-base-size:\s*15px/);
  assert.match(density, /--ff-ui-body-leading:\s*1\.5/);
  assert.match(density, /\.text-sm\s*\{\s*font-size:\s*\.84rem/);
  assert.match(density, /\.text-base\s*\{\s*font-size:\s*\.95rem/);
  assert.match(density, /\.text-3xl\s*\{\s*font-size:\s*1\.7rem/);
});

test('checklist and Diary padding use compact shared values', () => {
  assert.match(density, /#view-checklist \.step-card\s*\{\s*padding:\s*var\(--ff-ui-card-padding\) 1\.35rem !important/);
  assert.match(density, /#view-checklist > main\s*\{\s*margin-top:\s*\.85rem !important/);
  assert.match(density, /#view-diary:not\(\.hidden\) > \.card-lavender\s*\{\s*padding:\s*1\.1rem !important/);
  assert.match(density, /#little-garden \.garden-room-actions\s*\{[^}]*padding:\s*\.7rem/);
});

test('phone controls keep practical touch targets and form-entry text remains readable', () => {
  assert.match(density, /#view-checklist \.guided-task-row:has\(\.guide-checkbox-label\.is-unlocked\) > \.guide-quote-launch\s*\{[^}]*width:\s*44px !important/);
  assert.match(density, /#view-checklist \.guided-task-row:has\(\.guide-checkbox-label\.is-unlocked\) > \.guide-quote-launch\s*\{[^}]*min-height:\s*44px !important/);
  assert.match(density, /#vault-login-form input,[\s\S]*?#view-diary textarea\s*\{\s*font-size:\s*16px/);
  assert.match(density, /#vault-login-submit,[\s\S]*?#vault-signup-form button\s*\{\s*min-height:\s*44px/);
});

test('short desktop viewports retain tighter card spacing', () => {
  assert.match(density, /@media \(min-width: 621px\) and \(max-height: 760px\)[\s\S]*?#view-checklist \.step-card\s*\{\s*padding:\s*\.85rem/);
  assert.match(density, /@media \(min-width: 621px\) and \(max-height: 590px\)[\s\S]*?#view-checklist \.step-card\s*\{\s*padding:\s*\.7rem/);
});

test('shared frames use a content-led width system instead of filling wide viewports', () => {
  assert.match(density, /--ff-content-column-max:\s*42rem/);
  assert.match(density, /--ff-content-card-max:\s*38rem/);
  assert.match(density, /\.garden-shell\s*\{\s*width:\s*min\(86vw,\s*var\(--ff-content-column-max\)\)/);
  assert.match(density, /#view-checklist \.step-card\s*\{\s*width:\s*100%;\s*max-width:\s*var\(--ff-content-card-max\)/);
  assert.match(density, /#view-checklist \.step-card \.space-y-3 > div\.flex\.items-center\.justify-between,[\s\S]*?width:\s*fit-content/);
  assert.match(density, /#view-diary \.diary-additional-notes,[\s\S]*?#view-diary #diary-voice-notes\s*\{\s*width:\s*min\(100%,\s*var\(--ff-content-panel-max\)\)/);
  assert.match(density, /#view-diary \.diary-note-composer\s*\{\s*width:\s*min\(100%,\s*28rem\)/);
});


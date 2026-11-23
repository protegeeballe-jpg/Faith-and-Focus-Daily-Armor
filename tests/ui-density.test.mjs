import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const density = readFileSync(new URL('../assets/mobile.css', import.meta.url), 'utf8');
const precision = density.slice(density.lastIndexOf('/* Precision sizing:'));

test('polish refinements load before final mobile-specific overrides', () => {
  const app = html.indexOf('assets/app.css');
  const garden = html.indexOf('assets/garden.css');
  const polish = html.indexOf('assets/polish.css');
  const mobile = html.indexOf('assets/mobile.css');
  assert.ok(app >= 0 && garden > app && polish > garden && mobile > polish);
});

test('shared typography scale reduces oversized type without shrinking the base font excessively', () => {
  assert.match(density, /--ff-ui-base-size:\s*15px/);
  assert.match(density, /--ff-ui-body-leading:\s*1\.5/);
  assert.match(density, /\.text-sm\s*\{\s*font-size:\s*\.84rem/);
  assert.match(density, /\.text-base\s*\{\s*font-size:\s*\.95rem/);
  assert.match(density, /\.text-3xl\s*\{\s*font-size:\s*1\.7rem/);
});

test('frames use exact compact padding measurements', () => {
  assert.match(precision, /--ff-frame-pad-y:\s*8px/);
  assert.match(precision, /--ff-frame-pad-x:\s*10px/);
  assert.match(precision, /--ff-row-pad-y:\s*6px/);
  assert.match(precision, /--ff-row-pad-x:\s*8px/);
  assert.match(precision, /#view-checklist \.step-card\s*\{[^}]*padding:\s*var\(--ff-frame-pad-y\) var\(--ff-frame-pad-x\) !important/s);
});

test('content width scales smoothly instead of allowing frames to occupy almost the full viewport', () => {
  assert.match(precision, /--ff-content-column-width:\s*48rem/);
  assert.match(precision, /--ff-content-card-width:\s*36rem/);
  assert.match(precision, /--ff-content-panel-width:\s*24rem/);
  assert.match(precision, /width:\s*min\(calc\(33vw \+ 240px\), calc\(100vw - 16px\), var\(--ff-content-column-width\)\)/);
  assert.match(precision, /#view-checklist > main\s*\{[^}]*max-width:\s*var\(--ff-content-card-width\)/s);
});

test('short checklist action rows and buttons shrink to their labels and controls', () => {
  assert.match(precision, /#view-checklist \.step-card \.ff-guide-row,[\s\S]*?display:\s*inline-flex !important/);
  assert.match(precision, /width:\s*fit-content/);
  assert.match(precision, /--ff-button-pad-y:\s*4px/);
  assert.match(precision, /--ff-button-pad-x:\s*8px/);
  assert.match(precision, /#view-checklist \.checklist-step-navigation button\s*\{[^}]*flex-grow:\s*0 !important/s);
});

test('Diary sections stay narrower than the Diary frame while the writing field remains usable', () => {
  assert.match(precision, /#view-diary \.diary-additional-notes,[\s\S]*?#view-diary #diary-voice-notes\s*\{[^}]*width:\s*min\(88%, var\(--ff-content-panel-width\)\)/s);
  assert.match(precision, /#view-diary \.diary-note-composer\s*\{[^}]*width:\s*min\(92%, 22rem\)/s);
});

test('phone controls preserve touch targets and form-entry text remains readable', () => {
  assert.match(precision, /@media \(max-width: 620px\)[\s\S]*?min-height:\s*44px !important/);
  assert.match(density, /#vault-login-form input,[\s\S]*?#view-diary textarea\s*\{\s*font-size:\s*16px/);
  assert.match(density, /#vault-login-submit,[\s\S]*?#vault-signup-form button\s*\{\s*min-height:\s*44px/);
});

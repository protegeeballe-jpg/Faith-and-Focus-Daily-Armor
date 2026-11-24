import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const density = readFileSync(new URL('../assets/mobile.css', import.meta.url), 'utf8');
const precision = density.slice(density.lastIndexOf('/* Precision sizing:'));

test('the final mobile stylesheet loads after the shared app and garden styles', () => {
  const app = html.indexOf('assets/app.css');
  const garden = html.indexOf('assets/garden.css');
  const mobile = html.indexOf('assets/mobile.css');
  assert.ok(app >= 0 && garden > app && mobile > garden);
  assert.doesNotMatch(html, /assets\/polish\.css/);
});

test('shared typography scale reduces oversized type without shrinking the base font excessively', () => {
  assert.match(density, /--ff-ui-base-size:\s*15px/);
  assert.match(density, /--ff-ui-body-leading:\s*1\.5/);
  assert.match(density, /\.text-sm\s*\{\s*font-size:\s*\.84rem/);
  assert.match(density, /\.text-base\s*\{\s*font-size:\s*\.95rem/);
  assert.match(density, /\.text-3xl\s*\{\s*font-size:\s*1\.7rem/);
});

test('spacing dials use the updated frame and row measurements', () => {
  assert.match(precision, /--ff-frame-pad-y:\s*12px/);
  assert.match(precision, /--ff-frame-pad-x:\s*14px/);
  assert.match(precision, /--ff-row-pad-y:\s*8px/);
  assert.match(precision, /--ff-row-pad-x:\s*12px/);
  assert.match(precision, /#view-checklist \.step-card\s*\{[^}]*padding:\s*var\(--ff-frame-pad-y\) var\(--ff-frame-pad-x\) !important/s);
});

test('content width scales smoothly instead of allowing frames to occupy almost the full viewport', () => {
  assert.match(precision, /--ff-content-column-width:\s*48rem/);
  assert.match(precision, /--ff-content-card-width:\s*36rem/);
  assert.match(precision, /--ff-content-panel-width:\s*24rem/);
  assert.match(precision, /width:\s*min\(calc\(33vw \+ 240px\), calc\(100vw - 16px\), var\(--ff-content-column-width\)\)/);
  assert.match(precision, /#view-checklist > main\s*\{[^}]*max-width:\s*var\(--ff-content-card-width\)/s);
});

test('short checklist action rows and buttons shrink-wrap using the updated spacing scale', () => {
  assert.match(precision, /#view-checklist \.step-card \.ff-guide-row,[\s\S]*?display:\s*inline-flex !important/);
  assert.match(precision, /width:\s*fit-content/);
  assert.match(precision, /--ff-button-pad-y:\s*9px/);
  assert.match(precision, /--ff-button-pad-x:\s*16px/);
  assert.match(precision, /#view-checklist \.checklist-step-navigation button\s*\{[^}]*flex-grow:\s*0 !important/s);
});

test('Diary sections stay narrower than the Diary frame while the note field fills its notepad', () => {
  assert.match(precision, /#view-diary \.diary-additional-notes,[\s\S]*?#view-diary #diary-voice-notes\s*\{[^}]*width:\s*min\(88%, var\(--ff-content-panel-width\)\)/s);
  const refinements = density.slice(density.lastIndexOf('/* Diary composer refinement. */'));
  assert.match(refinements, /#view-diary \.diary-note-composer\s*\{[^}]*width:\s*100% !important/s);
});

test('phone controls preserve touch targets and form-entry text remains readable', () => {
  assert.match(precision, /@media \(max-width: 620px\)[\s\S]*?min-height:\s*44px !important/);
  assert.match(density, /#vault-login-form input,[\s\S]*?#view-diary textarea\s*\{\s*font-size:\s*16px/);
  assert.match(density, /#vault-login-submit,[\s\S]*?#vault-signup-form button\s*\{\s*min-height:\s*44px/);
});


test('the ADD action is inset into the full-width notepad without changing its handler', () => {
  const composer = html.match(/<div class="diary-note-composer">[\s\S]*?<ol id="diary-additional-notes-list"/)?.[0] || '';
  assert.match(composer, /<textarea id="diary-note-composer"/);
  assert.match(composer, /<button id="diary-add-note-button" type="button" class="diary-add-note-button" data-action="addPrivateDiaryNote"/);
  const refinements = density.slice(density.lastIndexOf('/* Diary composer refinement. */'));
  assert.match(refinements, /#view-diary \.diary-note-composer-actions\s*\{[^}]*position: absolute/s);
  assert.match(refinements, /#view-diary \.diary-note-composer-input\s*\{[^}]*padding: \.72rem \.78rem 3rem/s);
  assert.match(refinements, /#view-diary \.diary-add-note-button\s*\{[^}]*width: fit-content !important;[^}]*min-height: 36px !important;[^}]*font-size: \.68rem !important/s);
});

test('bold text and primary action labels use a more restrained type scale', () => {
  const refinements = density.slice(density.lastIndexOf('/* Diary composer refinement. */'));
  assert.match(refinements, /\.text-sm\.font-bold,[\s\S]*?font-size: \.76rem !important/);
  assert.match(refinements, /#little-garden \.garden-action-button,[\s\S]*?font-size: \.72rem !important;\s*font-weight: 600 !important/);
  assert.match(refinements, /#view-diary \.diary-note-composer-label\s*\{[^}]*font-size: \.62rem;[^}]*font-weight: 600/s);
});


test('Health Checklist cards use a compact, consistent typography and watercolor row scale', () => {
  const checklist = density.slice(density.lastIndexOf('/* Health Checklist card refinement. */'));
  assert.ok(checklist.includes('#view-checklist .step-card h2 {'));
  assert.ok(checklist.includes('font-size: 1rem !important;'));
  assert.ok(checklist.includes('font-weight: 600 !important;'));
  assert.ok(checklist.includes('#view-checklist .step-card .font-bold,'));
  assert.ok(checklist.includes('#view-checklist .step-card button:not(.cloud-item),'));
  assert.ok(checklist.includes('font-size: .68rem !important;'));
  assert.ok(checklist.includes('#view-checklist .step-card .cloud-item {'));
  assert.ok(checklist.includes('font-size: .7rem !important;'));
  assert.ok(checklist.includes('background: rgba(255, 255, 255, .52) !important;'));
  assert.ok(checklist.includes('font-size: .78rem;'));
  assert.ok(checklist.includes('font-weight: 500;'));
});

test('desktop layout widens the app, checklist, and Diary panels without changing phone rules', () => {
  const desktop = density.slice(density.lastIndexOf('/* Desktop layout refinement. */'));
  assert.ok(desktop.includes('@media (min-width: 768px)'));
  assert.ok(desktop.includes('--ff-content-column-width: 60rem;'));
  assert.ok(desktop.includes('--ff-content-card-width: 50rem;'));
  assert.ok(desktop.includes('--ff-content-panel-width: 32rem;'));
  assert.ok(desktop.includes('calc(var(--ff-content-card-width) + 32px)'));
  assert.ok(desktop.includes('calc(50vw + 220px)'));
  assert.ok(desktop.includes('display: flex !important;'));
  assert.ok(desktop.includes('width: 100% !important;'));
  assert.ok(desktop.includes('@media (min-width: 800px)'));
  assert.ok(desktop.includes('flex-flow: row nowrap !important;'));
  assert.ok(desktop.includes('min-height: 50px !important;'));
  assert.ok(!desktop.includes('@media (max-width:'));
});

test('Card 1 location answers give their text a full-width flex area beside a fixed radio', () => {
  const cardOne = html.slice(html.indexOf('id="card-step-1"'), html.indexOf('id="card-step-2"'));
  assert.equal((cardOne.match(/class="checklist-location-choice flex items-center/g) || []).length, 4);
  assert.ok(cardOne.includes('data-id="loc-home"><span class="checklist-location-choice-text">AT HOME</span>'));
  assert.ok(cardOne.includes('data-id="loc-office"><span class="checklist-location-choice-text">AT WORK</span>'));
  assert.ok(cardOne.includes('data-id="loc-house"><span class="checklist-location-choice-text">AT SOMEONE ELSE\'S HOUSE</span>'));
  assert.ok(cardOne.includes('data-id="loc-out"><span class="checklist-location-choice-text">OUT HERE. SOMEWHERE</span>'));

  const locationStyles = mobile.slice(mobile.indexOf('/* Card 1 location answers:'));
  assert.ok(locationStyles.includes('#card-step-1 .checklist-location-choice {'));
  assert.ok(locationStyles.includes('width: 100%;'));
  assert.ok(locationStyles.includes('#card-step-1 .checklist-location-choice > input[type="radio"] {'));
  assert.ok(locationStyles.includes('flex: 0 0 18px;'));
  assert.ok(locationStyles.includes('#card-step-1 .checklist-location-choice-text {'));
  assert.ok(locationStyles.includes('flex: 1 1 0%;'));
});

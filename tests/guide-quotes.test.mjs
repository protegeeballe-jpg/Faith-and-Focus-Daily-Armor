import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_QUOTE_IDS, getGuideQuote } from '../assets/guide-quotes.js';

const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const gardenCss = readFileSync(new URL('../assets/garden.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const expectedQuotes = {
  'loc-home': 'Where soft light falls across the floor, You’re safe and home you need no more.',
  'loc-office': 'Beside your desk where quiet leaves sway, Find steady footing for today.',
  'loc-house': 'May peace find you through an open door, With gentle grace upon the floor.',
  'loc-out': 'Along the path where blossoms bend, The open sky is all you need to tend.',
  'start-1': 'Three priceless sparks upon the page, To light the morning’s opening stage.',
  'start-2': 'With folded hands and quiet grace, Let morning warmth fill up this space.',
  'start-3': 'Reach toward the sky, uncurl, and sway, And wake your body to the day.',
  'start-4': 'Lift up the glass, take a sip, And let cool water nourish you deep.',
  'mid-1': 'Unclench your jaw, let shoulders fall, And sit once more both soft and tall.',
  'mid-2': 'Breathe in the calm, hold soft and still, Then sigh the weight beyond the hill.',
  'mid-3': 'Step from the rush, pause where you stand, And lift cool comfort in your hand.',
  'mid-4': 'Rest one warm hand upon your chest, And let each feeling be a guest.',
  'mid-5': 'Open your palm, like a fart let it go, A passing cloud, unhurried, slow.',
  'end-1': 'Three golden stars for things you’ve done. Small quiet victories, one by one.',
  'end-2': 'Three gentle lines for morning’s light, So you can lay them down tonight.',
  'end-3': 'As amber skies begin to fade, Drink in the quiet you have made.',
  'end-4': 'A playful tap upon your nose. You did so well, God always knows!',
  'sleep-1': 'Remember kindness shared today, And tuck three blooms of thanks away.',
  'sleep-2': 'Three golden lights in evening’s hush, To bless the night without a rush.',
  'sleep-3': 'Put out the glow, set screens aside, Let softer lamplight be your guide.',
  'sleep-4': 'Beneath the moon’s pale, silver gleam, Fold hands in peace and drift in gratefulness to dream.',
  'sleep-5': 'Another sip before you sleep, Then let the quiet night run deep.',
  'cloud-checked': 'Choose just one cloud and watch it glide, While others wait in peaceful stride.'
};

test('the quote registry contains the exact 23 guide IDs and user-provided wording', () => {
  assert.equal(GUIDE_QUOTE_IDS.length, 23);
  assert.deepEqual(GUIDE_QUOTE_IDS, Object.keys(expectedQuotes));
  for (const [id, quote] of Object.entries(expectedQuotes)) {
    assert.equal(getGuideQuote(id), quote, 'quote text changed for ' + id);
  }
  assert.throws(() => getGuideQuote('../unexpected'), /GuideQuoteError/);
  assert.throws(() => getGuideQuote(''), /GuideQuoteError/);
  assert.throws(() => getGuideQuote(null), /GuideQuoteError/);
});

test('every checklist checkbox has one registered quote and no activity was lost', () => {
  const checklistIds = [...html.matchAll(/<input[^>]*class="[^"]*app-chk[^"]*"[^>]*data-id="([^"]+)"/g)]
    .map(match => match[1]);
  assert.equal(checklistIds.length, 23);
  assert.deepEqual(checklistIds, GUIDE_QUOTE_IDS);
  assert.match(html, /id="cloud-guide-quote"/);
  assert.match(app, /renderCloudGuideQuote\(\)/);
  assert.match(app, /createGuideQuoteCard\(checkboxId\)/);
});

test('quote cards use safe text rendering and accessible semantic structure', () => {
  const start = app.indexOf('function createGuideQuoteCard(guideId)');
  const end = app.indexOf('function renderCloudGuideQuote()', start);
  assert.ok(start >= 0 && end > start);
  const renderer = app.slice(start, end);
  assert.match(renderer, /getGuideQuote\(guideId\)/);
  assert.match(renderer, /quote\.textContent\s*=/);
  assert.match(renderer, /document\.createElement\('blockquote'\)/);
  assert.match(renderer, /card\.setAttribute\('role',\s*'group'\)/);
  assert.match(renderer, /card\.dataset\.guideQuoteId\s*=\s*guideId/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(css, /\.guide-quote-card\s*\{/);
  assert.match(css, /\.guide-quote-wash\s*\{/);
  assert.match(css, /\.guide-quote-text\s*\{/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.guide-quote-card/);
});

test('each checklist activity opens a quote launcher and preserves checkbox unlocking', () => {
  assert.match(app, /function attachGuideQuoteLaunchers\(\)/);
  assert.match(app, /guideButton\.className\s*=\s*'guide-quote-launch'/);
  assert.match(app, /const CHECKLIST_QUOTE_LABELS = Object\.freeze\(\{/);
  assert.match(app, /guideLabel\.textContent\s*=\s*taskLabel/);
  assert.match(app, /guideButton\.dataset\.taskId\s*=\s*id/);
  assert.match(app, /openModal\('guided',\s*id\)/);
  assert.match(app, /function syncGuideQuoteLaunchers\(\)/);
  assert.match(app, /chk\.dataset\.guideUnlocked\s*=\s*'true'/);
  assert.match(app, /launch\?\.classList\.remove\('is-hidden'\)/);
  assert.match(app, /chk\.checked\s*=\s*isChecked/);
  assert.match(app, /chk\.dataset\.guideUnlocked\s*=\s*guided\s*\?\s*'true'\s*:\s*'false'/);
  assert.match(app, /function completeAnimation\(\)/);
  assert.match(app, /chk\.classList\.remove\('guide-hidden'\)/);
  assert.match(app, /saveData\(\)/);
  assert.match(css, /\.guide-quote-launch\s*\{/);
  assert.match(gardenCss, /\.garden-checklist-scene \.guide-quote-launch/);
});

test('water reminders are self-paced and no longer wait for a character demonstration', () => {
  assert.doesNotMatch(app, /drinkGuideTimeout|waiting-for-drink|5-second water guide|Please watch the 5-second water guide/);
  assert.match(app, /Your turn\. Have water if you wish, at a comfortable pace\./);
  assert.match(app, /I've had my water\. Show my checkbox/);
  assert.match(app, /guide\.drink\s*\?/);
  assert.match(app, /action\.textContent\s*=\s*String\(guide\.action/);
  assert.doesNotMatch(app, /buildGuideIllustrationSvg|createWatercolorGuidePlayer/);
});

test('the existing five-cycle 4–2–6 breathing exercise remains timer-owned', () => {
  assert.match(app, /const breathingPhases = \[/);
  assert.match(app, /name:"Breathe in",seconds:4/);
  assert.match(app, /name:"Hold softly",seconds:2/);
  assert.match(app, /name:"Breathe out",seconds:6/);
  assert.match(app, /breathingTimer = setInterval\(\(\) => \{/);
  assert.match(app, /breathingCycle > 5/);
  assert.match(app, /activeModalAction\s*=\s*'start-breathing'/);
  assert.match(app, /button\.textContent\s*=\s*'Start 5 breathing cycles'/);
  assert.match(css, /@keyframes guide-breath-in/);
  assert.match(css, /@keyframes guide-breath-out/);
  assert.match(css, /\.guide-breath-orb\s*\{/);
});

test('emotional cloud choices stay text-only and preserve the one-choice-per-day data path', () => {
  assert.equal((html.match(/data-cloud="(?:cumulus|stratus|stratocumulus)"/g) || []).length, 3);
  assert.match(html, /id="cloud-guide-quote"/);
  assert.match(html, /id="cloud-progress"/);
  assert.doesNotMatch(html, /watercolor-cloud-svg|cloud-art|cloud-guide-stage|Cloud Animation/);
  assert.match(app, /function restoreCloudProgress\(data\)/);
  assert.match(app, /function updateCloudProgress\(\)/);
  assert.match(app, /cloudNames\.find\(name => data\['cloud_' \+ name\] === true\)/);
  assert.match(app, /item\.disabled = hasReleasedCloud/);
  assert.match(app, /One choice per day/);
  assert.match(app, /data\['cloud_' \+ item\.dataset\.cloud\] = item\.dataset\.released === 'true'/);
  assert.match(app, /function releaseCloud\(el\)/);
  assert.match(app, /if \(document\.querySelector\('\.cloud-item\[data-cloud\]\[data-released="true"\]'\)\) return/);
});

test('Claim Victory keeps its shield, trophy, one-time completion flow, and return path without a character image', () => {
  assert.match(html, /class="finale-watercolor-svg"/);
  assert.match(html, /class="finale-trophy-svg"/);
  assert.doesNotMatch(html, /finale-character-stage/);
  assert.doesNotMatch(app, /buildVictoryCharacterSvg|finaleCharacterStage/);
  assert.match(app, /if \(completedCards === 6 && !localStorage\.getItem\(scoreAwardedKey\)\)/);
  assert.match(app, /grandFinale\.classList\.remove\('hidden'\)/);
  assert.match(app, /async function closeGrandFinale\(\)/);
  assert.match(app, /showPage\('garden'\)/);
});

test('the quote module is an offline shell dependency and obsolete character modules are retired', () => {
  assert.match(serviceWorker, /faith-focus-shell-v43-offline-repair/);
  assert.match(serviceWorker, /\.\/assets\/guide-quotes\.js/);
  for (const obsolete of [
    'watercolor-illustrations.js',
    'character-appearance.js',
    'storyboard-choreographer.js',
    'guide-player.js'
  ]) assert.doesNotMatch(serviceWorker, new RegExp(obsolete.replaceAll('.', '\\.') ));
});

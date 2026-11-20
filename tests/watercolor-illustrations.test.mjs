import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUIDE_ILLUSTRATION_IDS,
  buildGuideIllustrationSvg,
  buildWatercolorCloudSvg
} from '../assets/watercolor-illustrations.js';

const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('every checklist and location guide has its own accessible watercolor SVG scene', () => {
  assert.equal(GUIDE_ILLUSTRATION_IDS.length, 23);
  for (const id of GUIDE_ILLUSTRATION_IDS) {
    const svg = buildGuideIllustrationSvg(id);
    assert.match(svg, /^<svg class="watercolor-guide-svg"/);
    assert.match(svg, /role="img" aria-label="/);
    assert.match(svg, /<title>/);
    assert.ok(svg.includes('</svg>'), 'unfinished illustration for ' + id);
  }
});

test('all three emotional cloud types render as separate painted SVG illustrations', () => {
  for (const kind of ['cumulus', 'stratus', 'stratocumulus']) {
    const svg = buildWatercolorCloudSvg(kind);
    assert.match(svg, new RegExp('watercolor-cloud-' + kind));
    assert.match(svg, /<svg/);
    assert.match(svg, /<g class="wcc-cloud/);
  }
  assert.match(html, /watercolor-cloud-cumulus/);
  assert.match(html, /watercolor-cloud-stratus/);
  assert.match(html, /watercolor-cloud-stratocumulus/);
  assert.equal((html.match(/data-cloud="(?:cumulus|stratus|stratocumulus)"/g) || []).length, 3);
});

test('the health checklist mounts the watercolor scene without changing guide completion actions', () => {
  assert.match(app, /buildGuideIllustrationSvg\\(checkboxId\\)/);
  assert.match(app, /buildWatercolorCloudSvg\\(item\\.kind\\)/);
  assert.match(app, /activeModalAction = 'start-breathing'/);
  assert.match(app, /activeModalAction = 'waiting-for-drink'/);
  assert.match(app, /function completeAnimation\\(\\)/);
  assert.match(app, /chk\\.dataset\\.guideUnlocked = 'true'/);
});

test('the Grand Finale uses the watercolor shield and trophy while Claim Victory still returns to the Forge Room', () => {
  assert.match(html, /class="finale-watercolor-svg"/);
  assert.match(html, /class="finale-trophy-svg"/);
  assert.match(html, /data-action="closeGrandFinale"[^>]*>[\\s\\S]*?Claim Victory/);
  const closeHandler = app.slice(app.indexOf('async function closeGrandFinale()'), app.indexOf('function loadData()'));
  assert.match(closeHandler, /showPage\\('garden'\\)/);
});

test('only the spoken congratulatory cue is removed and all new illustration motion respects reduced-motion settings', () => {
  assert.doesNotMatch(app, /speakProudCue|SpeechSynthesisUtterance|speechSynthesis\\.speak/);
  assert.match(app, /playFanfareSound\\(\\)/);
  assert.match(css, /@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)[\\s\\S]*?watercolor-guide-svg/s);
  assert.match(css, /\\.watercolor-cloud-svg/);
  assert.match(css, /\\.finale-watercolor-svg/);
});

test('the new illustration module is part of the versioned offline application shell', () => {
  assert.match(serviceWorker, /faith-focus-shell-v29-watercolor-illustrations/);
  assert.match(serviceWorker, /\\.\\/assets\\/watercolor-illustrations\\.js/);
});

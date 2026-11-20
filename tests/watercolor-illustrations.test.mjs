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
    assert.ok(svg.startsWith('<svg class="watercolor-guide-svg"'));
    assert.ok(svg.includes('role="img" aria-label='));
    assert.ok(svg.includes('<title>'));
    assert.ok(svg.endsWith('</svg>'), 'unfinished illustration for ' + id);
  }
});

test('all three emotional cloud types render as separate painted SVG illustrations', () => {
  for (const kind of ['cumulus', 'stratus', 'stratocumulus']) {
    const svg = buildWatercolorCloudSvg(kind);
    assert.ok(svg.includes('watercolor-cloud-' + kind));
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('<g class="wcc-cloud'));
  }
  assert.ok(html.includes('watercolor-cloud-cumulus'));
  assert.ok(html.includes('watercolor-cloud-stratus'));
  assert.ok(html.includes('watercolor-cloud-stratocumulus'));
  assert.equal((html.match(/data-cloud="(?:cumulus|stratus|stratocumulus)"/g) || []).length, 3);
});

test('the health checklist mounts watercolor scenes without changing guide completion actions', () => {
  assert.ok(app.includes('buildGuideIllustrationSvg(checkboxId)'));
  assert.ok(app.includes('buildWatercolorCloudSvg(item.kind)'));
  assert.ok(app.includes("activeModalAction = 'start-breathing'"));
  assert.ok(app.includes("activeModalAction = 'waiting-for-drink'"));
  assert.ok(app.includes('function completeAnimation()'));
  assert.ok(app.includes("chk.dataset.guideUnlocked = 'true'"));
});

test('the Grand Finale uses watercolor shield and trophy art while Claim Victory still returns to the Forge Room', () => {
  assert.ok(html.includes('class="finale-watercolor-svg"'));
  assert.ok(html.includes('class="finale-trophy-svg"'));
  assert.ok(html.includes('data-action="closeGrandFinale"'));
  assert.ok(html.includes('Claim Victory'));
  const closeStart = app.indexOf('async function closeGrandFinale()');
  const loadStart = app.indexOf('function loadData()', closeStart);
  const closeHandler = app.slice(closeStart, loadStart);
  assert.ok(closeHandler.includes("showPage('garden')"));
});

test('the spoken congratulatory cue is removed while the instrumental fanfare and reduced-motion support remain', () => {
  assert.ok(!app.includes('speakProudCue'));
  assert.ok(!app.includes('SpeechSynthesisUtterance'));
  assert.ok(!app.includes('speechSynthesis.speak'));
  assert.ok(app.includes('playFanfareSound();'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('.watercolor-guide-svg'));
  assert.ok(css.includes('.watercolor-cloud-svg'));
  assert.ok(css.includes('.finale-watercolor-svg'));
});

test('the new illustration module is part of the versioned offline application shell', () => {
  assert.ok(serviceWorker.includes('faith-focus-shell-v29-watercolor-illustrations'));
  assert.ok(serviceWorker.includes('./assets/watercolor-illustrations.js'));
});

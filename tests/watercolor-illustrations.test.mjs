import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUIDE_ILLUSTRATION_IDS,
  GUIDE_ANIMATION_SEQUENCES,
  buildGuideIllustrationSvg,
  buildVictoryCharacterSvg,
  buildWatercolorCloudSvg,
  getBreathingAnimationPhase
} from '../assets/watercolor-illustrations.js';

const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('every checklist and location guide resolves to an accessible illustrated character sequence', () => {
  assert.equal(GUIDE_ILLUSTRATION_IDS.length, 23);
  for (const id of GUIDE_ILLUSTRATION_IDS) {
    const svg = buildGuideIllustrationSvg(id);
    const sequence = GUIDE_ANIMATION_SEQUENCES[id];
    assert.ok(svg.startsWith('<svg class="watercolor-guide-svg watercolor-guide-svg--'));
    assert.ok(svg.includes('data-sequence="' + sequence + '"'));
    assert.ok(svg.includes('role="img" aria-label='));
    assert.ok(svg.includes('<title>'));
    assert.ok(svg.includes('class="wgi-character wgi-character--' + sequence + '"'));
    assert.ok(svg.includes('class="wgi-torso"'));
    assert.ok(svg.includes('class="wgi-head"'));
    assert.ok(svg.includes('class="wgi-arm wgi-arm--left"'));
    assert.ok(svg.includes('class="wgi-arm wgi-arm--right"'));
    assert.ok(svg.includes('class="wgi-eyes-open"'));
    assert.ok(svg.includes('class="wgi-eyes-closed"'));
    assert.ok(svg.includes('class="wgi-mouth-smile"'));
    assert.ok(svg.endsWith('</svg>'), 'unfinished illustration for ' + id);
  }
});

test('every activity family has a dedicated coordinated choreography rule', () => {
  const sequences = [...new Set(Object.values(GUIDE_ANIMATION_SEQUENCES))].sort();
  assert.deepEqual(sequences, [
    'boop', 'breathe', 'drink', 'float', 'heart',
    'night', 'prayer', 'relaxed', 'stretch', 'write'
  ]);
  for (const sequence of sequences) {
    assert.ok(css.includes('.wgi-character--' + sequence), 'missing choreography for ' + sequence);
  }
  for (const selector of [
    '.wgi-character--stretch .wgi-arm--left',
    '.wgi-character--stretch .wgi-arm--right',
    '.wgi-character--prayer .wgi-eyes-closed',
    '.wgi-character--drink .wgi-mouth-sip',
    '.wgi-character--heart .wgi-arm--right',
    '.wgi-character--float .wgi-arm--right',
    '.wgi-character--write .wgi-head',
    '.wgi-character--boop .wgi-arm--right',
    '.wgi-character--night .wgi-mouth-yawn'
  ]) {
    assert.ok(css.includes(selector), 'missing activity-specific body or expression choreography: ' + selector);
  }
});

test('the breathing character follows the existing 4–2–6 timer phases without a second clock', () => {
  assert.equal(getBreathingAnimationPhase('Breathe in'), 'inhale');
  assert.equal(getBreathingAnimationPhase('Hold softly'), 'hold');
  assert.equal(getBreathingAnimationPhase('Breathe out'), 'exhale');
  assert.equal(getBreathingAnimationPhase('Amazing work!'), 'rest');
  const svg = buildGuideIllustrationSvg('mid-2');
  assert.ok(svg.includes('data-breath-phase="rest"'));
  assert.ok(css.includes('[data-breath-phase="inhale"] .wgi-torso'));
  assert.ok(css.includes('[data-breath-phase="hold"] .wgi-torso'));
  assert.ok(css.includes('[data-breath-phase="exhale"] .wgi-torso'));
  assert.ok(app.includes('dataset.breathPhase = getBreathingAnimationPhase(phase.name)'));
  assert.ok(app.includes("getBreathingAnimationPhase('Complete')"));
  assert.ok(app.includes('const breathingPhases = ['));
});

test('Claim Victory receives its own joyful character sequence while the existing shield, trophy, and return flow remain intact', () => {
  const victory = buildVictoryCharacterSvg();
  assert.ok(victory.includes('class="finale-character-svg"'));
  assert.ok(victory.includes('class="wgi-character wgi-character--celebrate"'));
  assert.ok(victory.includes('class="wgi-arm wgi-arm--left"'));
  assert.ok(victory.includes('class="wgi-arm wgi-arm--right"'));
  assert.ok(victory.includes('class="wgi-eyes-closed"'));
  assert.ok(css.includes('.wgi-character--celebrate .wgi-torso'));
  assert.ok(html.includes('id="finale-character-stage"'));
  assert.ok(app.includes('buildVictoryCharacterSvg()'));
  assert.ok(app.includes('finaleCharacterStage.replaceChildren()'));
  assert.ok(html.includes('class="finale-watercolor-svg"'));
  assert.ok(html.includes('class="finale-trophy-svg"'));
  assert.ok(html.includes('data-action="closeGrandFinale"'));
  assert.ok(html.includes('Claim Victory'));
  const closeStart = app.indexOf('async function closeGrandFinale()');
  const loadStart = app.indexOf('function loadData()', closeStart);
  const closeHandler = app.slice(closeStart, loadStart);
  assert.ok(closeHandler.includes("showPage('garden')"));
});

test('all three emotional cloud types remain separate watercolor illustrations', () => {
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

test('the health checklist illustration upgrade does not change guide completion actions or hydration timing', () => {
  assert.ok(app.includes('buildGuideIllustrationSvg(checkboxId)'));
  assert.ok(app.includes('buildWatercolorCloudSvg(item.kind)'));
  assert.ok(app.includes("activeModalAction = 'start-breathing'"));
  assert.ok(app.includes("activeModalAction = 'waiting-for-drink'"));
  assert.ok(app.includes('drinkGuideTimeout = setTimeout(() => {'));
  assert.ok(app.includes('}, 5000);'));
  assert.ok(app.includes('function completeAnimation()'));
  assert.ok(app.includes("chk.dataset.guideUnlocked = 'true'"));
});

test('the spoken congratulatory cue remains removed while the instrumental fanfare and reduced-motion support remain', () => {
  assert.ok(!app.includes('speakProudCue'));
  assert.ok(!app.includes('SpeechSynthesisUtterance'));
  assert.ok(!app.includes('speechSynthesis.speak'));
  assert.ok(app.includes('playFanfareSound();'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('.watercolor-guide-svg'));
  assert.ok(css.includes('.watercolor-cloud-svg'));
  assert.ok(css.includes('.finale-watercolor-svg'));
  assert.ok(css.includes('.finale-character-svg'));
  assert.ok(css.includes('animation: none !important'));
});

test('the updated animation module remains part of the versioned offline application shell', () => {
  assert.ok(serviceWorker.includes('faith-focus-shell-v30-expressive-watercolor-characters'));
  assert.ok(serviceWorker.includes('./assets/watercolor-illustrations.js'));
});

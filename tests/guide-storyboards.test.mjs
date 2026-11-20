import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_PALETTE,
  LIGHTING_THEMES,
  buildCharacterRigMarkup,
  buildWatercolorDefs
} from '../assets/character-appearance.js';
import {
  GUIDE_STORYBOARDS,
  getGuideStoryboard,
  buildGuideStoryboardStylesheet
} from '../assets/storyboard-choreographer.js';
import { GUIDE_PLAYBACK_SPECS } from '../assets/guide-player.js';
import {
  GUIDE_ILLUSTRATION_IDS,
  buildGuideIllustrationSvg
} from '../assets/watercolor-illustrations.js';

const EXPECTED_IDS = [
  'loc-home', 'loc-office', 'loc-house', 'loc-out',
  'start-1', 'start-2', 'start-3', 'start-4',
  'mid-1', 'mid-2', 'mid-3', 'mid-4', 'mid-5',
  'end-1', 'end-2', 'end-3', 'end-4',
  'sleep-1', 'sleep-2', 'sleep-3', 'sleep-4', 'sleep-5',
  'cloud-checked'
].sort();

test('all 23 storyboard IDs match the authoritative playback registry exactly', () => {
  const ids = Object.keys(GUIDE_STORYBOARDS).sort();
  assert.deepEqual(ids, EXPECTED_IDS);
  assert.deepEqual([...GUIDE_ILLUSTRATION_IDS].sort(), EXPECTED_IDS);
  assert.deepEqual(Object.keys(GUIDE_PLAYBACK_SPECS).sort(), EXPECTED_IDS);
  assert.equal(new Set(ids).size, 23);
  assert.ok(Object.isFrozen(GUIDE_STORYBOARDS));

  for (const id of ids) {
    const storyboard = GUIDE_STORYBOARDS[id];
    const playback = GUIDE_PLAYBACK_SPECS[id];
    assert.equal(storyboard.id, id);
    assert.equal(storyboard.playbackRule, playback.playbackMode);
    assert.equal(storyboard.durationMs, playback.durationMs);
    assert.ok(storyboard.setting.length > 0);
    assert.ok(['morning', 'midday', 'evening', 'night', 'ambient'].includes(storyboard.timeOfDay));
    assert.ok(['close', 'medium', 'wide'].includes(storyboard.camera));
    assert.ok(storyboard.prop && storyboard.prop.kind.length > 0);
    assert.ok(['scene', 'right-hand', 'interactive-scene'].includes(storyboard.prop.attachment));
    assert.ok(Object.isFrozen(storyboard));
  }
});

test('every non-timer action has its own validated, bounded articulation timeline', () => {
  const animationNames = new Set();

  for (const id of EXPECTED_IDS) {
    const storyboard = getGuideStoryboard(id);
    const stylesheet = buildGuideStoryboardStylesheet(id);

    assert.ok(stylesheet.includes('data-guide-id="' + id + '"'));
    assert.ok(stylesheet.includes('@media(prefers-reduced-motion:reduce)'));
    assert.doesNotMatch(stylesheet, /https?:\/\//i);

    if (storyboard.playbackRule === 'timer-driven') {
      assert.equal(id, 'mid-2');
      assert.deepEqual(Object.keys(storyboard.motion), []);
      assert.equal(storyboard.timerTimeline.authority, 'existing-app-breathing-timer');
      assert.deepEqual([...storyboard.timerTimeline.phases], ['inhale', 'hold', 'exhale', 'rest']);
      assert.deepEqual({ ...storyboard.timerTimeline.transitionMs }, {
        inhale: 4000, hold: 2000, exhale: 6000, rest: 0
      });
      assert.match(stylesheet, /wgi-breath-ring\{animation:none/);
      assert.match(stylesheet, /data-breath-phase="inhale"/);
      assert.match(stylesheet, /data-breath-phase="exhale"/);
      continue;
    }

    assert.ok(Object.keys(storyboard.motion).length > 0, 'missing motion for ' + id);
    const expectedIterations = storyboard.playbackRule === 'finite' ? '1' : 'infinite';
    assert.ok(stylesheet.includes('animation-iteration-count:' + expectedIterations));

    for (const [part, frames] of Object.entries(storyboard.motion)) {
      assert.ok(Array.isArray(frames) && frames.length >= 3, id + ' / ' + part);
      assert.deepEqual(frames[0].slice(0, 1), [0], id + ' / ' + part + ' must start at rest');
      assert.deepEqual(frames.at(-1).slice(0, 1), [100], id + ' / ' + part + ' must end at its authored endpoint');
      let previous = -1;
      for (const [percent, x, y, rotation, scale] of frames) {
        assert.ok(Number.isFinite(percent) && percent > previous && percent >= 0 && percent <= 100);
        assert.ok(Number.isFinite(x) && Math.abs(x) <= 32);
        assert.ok(Number.isFinite(y) && Math.abs(y) <= 32);
        assert.ok(Number.isFinite(rotation) && Math.abs(rotation) <= 85);
        assert.ok(Number.isFinite(scale) && scale >= 0.96 && scale <= 1.04);
        previous = percent;
      }
      const keyframeName = 'wgi-story-' + id + '-' + part;
      assert.ok(stylesheet.includes('@keyframes ' + keyframeName));
      assert.ok(stylesheet.includes('animation-name:' + keyframeName));
      assert.equal(animationNames.has(keyframeName), false, 'duplicate animation name: ' + keyframeName);
      animationNames.add(keyframeName);
    }
  }

  assert.equal(animationNames.size > 30, true);
  assert.equal(Object.keys(GUIDE_STORYBOARDS).length, 23);
});

test('hydration, journaling, screen sunset, and cloud interaction attach their props to the intended rig or scene', () => {
  const hydration = buildGuideIllustrationSvg('start-4');
  assert.match(hydration, /data-prop-kind="water-glass"/);
  assert.match(hydration, /data-prop-attachment="right-hand"/);
  assert.match(hydration, /wgi-hand-prop--water-glass/);

  const journal = buildGuideIllustrationSvg('end-2');
  assert.match(journal, /data-prop-kind="pencil"/);
  assert.match(journal, /wgi-hand-prop--pencil/);

  const screen = buildGuideIllustrationSvg('sleep-3');
  assert.match(screen, /data-prop-kind="phone"/);
  assert.match(screen, /wgi-hand-prop--phone/);

  const cloud = buildGuideIllustrationSvg('cloud-checked');
  assert.match(cloud, /data-playback-rule="interactive"/);
  assert.match(cloud, /class="wgi-cloud-drift"><g class="wgi-cloud">/);
  assert.match(cloud, /data-cloud-selection="idle"/);
  assert.match(buildGuideStoryboardStylesheet('cloud-checked'), /wgi-cloud\{transform:translate/);
});

test('the child character keeps consistent anatomy, palette, and watercolor texture without geometric displacement', () => {
  assert.deepEqual(CHARACTER_PALETTE, {
    paperBg: '#FAF4EC',
    paperShadow: '#EAE0D2',
    skinBase: '#F6C7A8',
    skinShadow: '#E3AA88',
    cheekBlush: '#F29B88',
    hairDark: '#3A2E2A',
    shirtMint: '#BDD4CC',
    shirtSpeckle: '#496860',
    dressOchre: '#DF9B2D',
    dressStitch: '#4B3A26',
    leggingTerracotta: '#DC6B45',
    shoeTeal: '#54847A',
    accentGold: '#EAB843'
  });
  assert.deepEqual(Object.keys(LIGHTING_THEMES).sort(), ['ambient', 'evening', 'midday', 'morning', 'night']);

  const rig = buildCharacterRigMarkup({
    pose: 'drink',
    prefix: 'character-test',
    rightHandProp: 'water-glass',
    primaryMotionPart: 'rightForearm'
  });
  for (const selector of [
    'wgi-character--drink', 'wgi-lower-body', 'wgi-leg--left', 'wgi-leg--right',
    'wgi-arm--left', 'wgi-arm--right', 'wgi-forearm--right', 'wgi-hand--right',
    'wgi-torso', 'wgi-head', 'wgi-eyes-open', 'wgi-eyes-closed',
    'wgi-shirt-speckles', 'wgi-hand-prop--water-glass', 'data-primary-motion="true"'
  ]) assert.ok(rig.includes(selector), 'missing articulated part ' + selector);

  const defs = buildWatercolorDefs('character-test', 'morning');
  assert.match(defs, /feTurbulence/);
  assert.match(defs, /paper-fleck/);
  assert.match(defs, /character-test-sky/);
  assert.doesNotMatch(defs, /feDisplacementMap/);
  assert.throws(() => buildWatercolorDefs('bad id with spaces'), /CharacterRigError/);
});

test('unknown guide identifiers and unsafe prop or palette input fail closed', () => {
  assert.throws(() => getGuideStoryboard('../mid-2'), /GuideSecurityError/);
  assert.throws(() => buildGuideStoryboardStylesheet('not-a-guide'), /GuideSecurityError/);
  assert.throws(() => buildGuideIllustrationSvg('../unexpected'), /GuideSecurityError/);
  assert.throws(() => buildCharacterRigMarkup({ prefix: 'x"><script>' }), /CharacterRigError/);
});

test('art and storyboard modules do not own clocks, persistence, or network access', async () => {
  const { readFile } = await import('node:fs/promises');
  const [appearance, storyboard, illustrations] = await Promise.all([
    readFile(new URL('../assets/character-appearance.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/storyboard-choreographer.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/watercolor-illustrations.js', import.meta.url), 'utf8')
  ]);
  for (const source of [appearance, storyboard, illustrations]) {
    assert.doesNotMatch(source, /\b(?:setInterval|setTimeout|fetch|XMLHttpRequest)\s*\(/);
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b/);
  }
});

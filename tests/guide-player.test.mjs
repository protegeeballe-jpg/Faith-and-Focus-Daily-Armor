
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_PLAYBACK_SPECS, resolveGuidePlaybackSpec, createWatercolorGuidePlayer } from '../assets/guide-player.js';
import { GUIDE_ILLUSTRATION_IDS } from '../assets/watercolor-illustrations.js';

const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../assets/guide-player.js', import.meta.url), 'utf8');

test('the immutable playback registry covers all 23 guide IDs exactly once', () => {
  const ids = Object.keys(GUIDE_PLAYBACK_SPECS);
  assert.equal(ids.length, 23);
  assert.equal(new Set(ids).size, 23);
  assert.deepEqual([...ids].sort(), [...GUIDE_ILLUSTRATION_IDS].sort());
  for (const id of ids) {
    assert.equal(GUIDE_PLAYBACK_SPECS[id].id, id);
    assert.ok(['loop', 'finite', 'timer-driven', 'interactive'].includes(GUIDE_PLAYBACK_SPECS[id].playbackMode));
    assert.ok(GUIDE_PLAYBACK_SPECS[id].durationMs > 0);
    assert.ok(Object.isFrozen(GUIDE_PLAYBACK_SPECS[id]));
  }
  assert.ok(Object.isFrozen(GUIDE_PLAYBACK_SPECS));
});

test('unknown guide IDs are rejected before they can control a stage', () => {
  assert.throws(() => resolveGuidePlaybackSpec('../unexpected'), /GuideSecurityError/);
  assert.throws(() => resolveGuidePlaybackSpec(''), /GuideSecurityError/);
  assert.equal(resolveGuidePlaybackSpec('mid-2').playbackMode, 'timer-driven');
  assert.equal(resolveGuidePlaybackSpec('cloud-checked').playbackMode, 'interactive');
});

test('the visual controller has no independent clock or persistence side effects', () => {
  assert.doesNotMatch(controller, /\bsetInterval\s*\(/);
  assert.doesNotMatch(controller, /\bsetTimeout\s*\(/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|saveData\s*\(/);
  assert.match(controller, /setBreathingPhase\(phase\)/);
  assert.match(controller, /setCloudSelection\(selection\)/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /prefers-reduced-motion/);
  assert.match(controller, /IntersectionObserver/);
});

test('existing hydration and breathing owners feed the player without replacing their timers', () => {
  assert.match(app, /activeModalGuidePlayer\?\.complete\(\)/);
  assert.match(app, /activeModalGuidePlayer\.setBreathingPhase\(/);
  assert.match(app, /drinkGuideTimeout = setTimeout\(\(\) => \{/);
  assert.match(app, /\}, 5000\);/);
  assert.match(app, /breathingTimer = setInterval\(\(\) => \{/);
  assert.match(app, /breathingSecondsLeft--/);
  assert.match(app, /breathingCycle > 5/);
});

test('the cloud character follows the selected cloud without taking over persistence', () => {
  assert.match(html, /id="cloud-guide-stage"/);
  assert.match(app, /cloudGuidePlayer\?\.setCloudSelection\(selectedCloud\?\.dataset\.cloud \|\| null\)/);
  assert.match(app, /function releaseCloud\(el\)/);
  assert.match(app, /data\['cloud_' \+ item\.dataset\.cloud\] = item\.dataset\.released === 'true'/);
  assert.match(css, /data-cloud-selection="cumulus"/);
  assert.match(css, /data-cloud-selection="stratus"/);
  assert.match(css, /data-cloud-selection="stratocumulus"/);
});

test('finite playback, reduced-motion behavior, paper stage, and offline caching are wired', () => {
  assert.match(css, /data-playback-mode="finite"/);
  assert.match(css, /animation-iteration-count:\s*1/);
  assert.match(css, /guide-motion-static/);
  assert.match(css, /guide-playback-paused/);
  assert.match(css, /#faf6f0/i);
  assert.match(serviceWorker, /faith-focus-shell-v31-watercolor-player-lifecycle/);
  assert.match(serviceWorker, /\.\/assets\/guide-player\.js/);
});

function createMockStage() {
  const svg = { dataset: {} };
  const listeners = new Map();
  const classes = new Set();
  const properties = new Map();
  const mediaListeners = new Set();
  const doc = {
    visibilityState: 'visible',
    defaultView: {
      navigator: {},
      matchMedia() {
        return {
          matches: false,
          addEventListener(type, listener) { mediaListeners.add(listener); },
          removeEventListener(type, listener) { mediaListeners.delete(listener); }
        };
      }
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const stage = {
    ownerDocument: doc,
    isConnected: true,
    dataset: {},
    style: { setProperty(name, value) { properties.set(name, value); } },
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); }
    },
    querySelector(selector) { return selector === '.watercolor-guide-svg' ? svg : null; }
  };
  return { stage, svg, doc, listeners, classes, properties, mediaListeners };
}

test('player binds authoritative breathing phases and tears down its listeners', () => {
  const mock = createMockStage();
  const player = createWatercolorGuidePlayer({ guideId: 'mid-2', stage: mock.stage });
  assert.equal(mock.stage.dataset.playbackMode, 'timer-driven');
  assert.equal(mock.stage.dataset.playbackState, 'playing');
  assert.equal(player.setBreathingPhase('inhale'), true);
  assert.equal(mock.svg.dataset.breathPhase, 'inhale');
  assert.equal(mock.properties.get('--guide-breath-transition'), '4000ms');
  assert.equal(player.setBreathingPhase('hold'), true);
  assert.equal(mock.properties.get('--guide-breath-transition'), '2000ms');
  assert.equal(player.setBreathingPhase('exhale'), true);
  assert.equal(mock.properties.get('--guide-breath-transition'), '6000ms');
  assert.equal(player.setBreathingPhase('not-a-phase'), false);
  assert.equal(player.complete(), false);
  player.destroy();
  assert.equal(mock.stage.dataset.playbackState, 'destroyed');
  assert.equal(mock.listeners.has('visibilitychange'), false);
  assert.equal(mock.mediaListeners.size, 0);
  assert.equal(player.setBreathingPhase('inhale'), false);
});

test('finite completion is visual-only and cloud selection accepts only registered states', () => {
  const finite = createMockStage();
  const finitePlayer = createWatercolorGuidePlayer({ guideId: 'start-4', stage: finite.stage });
  assert.equal(finitePlayer.complete(), true);
  assert.equal(finite.stage.dataset.playbackState, 'complete');
  assert.equal(finitePlayer.setCloudSelection('cumulus'), false);
  finitePlayer.destroy();

  const cloud = createMockStage();
  const cloudPlayer = createWatercolorGuidePlayer({ guideId: 'cloud-checked', stage: cloud.stage });
  assert.equal(cloudPlayer.setCloudSelection('cumulus'), true);
  assert.equal(cloud.stage.dataset.cloudSelection, 'cumulus');
  assert.equal(cloud.svg.dataset.cloudSelection, 'cumulus');
  assert.equal(cloudPlayer.setCloudSelection('untrusted-value'), true);
  assert.equal(cloud.stage.dataset.cloudSelection, 'idle');
  cloudPlayer.destroy();
});

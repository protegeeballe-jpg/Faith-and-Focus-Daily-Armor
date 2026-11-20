
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_PLAYBACK_SPECS, resolveGuidePlaybackSpec } from '../assets/guide-player.js';

const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../assets/guide-player.js', import.meta.url), 'utf8');

test('the immutable playback registry covers all 23 guide IDs exactly once', () => {
  const ids = Object.keys(GUIDE_PLAYBACK_SPECS);
  assert.equal(ids.length, 23);
  assert.equal(new Set(ids).size, 23);
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
  assert.doesNotMatch(controller, /\\bsetInterval\\s*\\(/);
  assert.doesNotMatch(controller, /\\bsetTimeout\\s*\\(/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|saveData\\s*\\(/);
  assert.match(controller, /setBreathingPhase\\(phase\\)/);
  assert.match(controller, /setCloudSelection\\(selection\\)/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /prefers-reduced-motion/);
  assert.match(controller, /IntersectionObserver/);
});

test('existing hydration and breathing owners feed the player without replacing their timers', () => {
  assert.match(app, /activeModalGuidePlayer\\?\\.complete\\(\\)/);
  assert.match(app, /activeModalGuidePlayer\\.setBreathingPhase\\(/);
  assert.match(app, /drinkGuideTimeout = setTimeout\\(\\(\\) => \\{/);
  assert.match(app, /\\}, 5000\\);/);
  assert.match(app, /breathingTimer = setInterval\\(\\(\\) => \\{/);
  assert.match(app, /breathingSecondsLeft--/);
  assert.match(app, /breathingCycle > 5/);
});

test('the cloud character follows the selected cloud without taking over persistence', () => {
  assert.match(html, /id="cloud-guide-stage"/);
  assert.match(app, /cloudGuidePlayer\\?\\.setCloudSelection\\(selectedCloud\\?\\.dataset\\.cloud \\|\\| null\\)/);
  assert.match(app, /function releaseCloud\\(el\\)/);
  assert.match(app, /data\\['cloud_' \\+ item\\.dataset\\.cloud\\] = item\\.dataset\\.released === 'true'/);
  assert.match(css, /data-cloud-selection="cumulus"/);
  assert.match(css, /data-cloud-selection="stratus"/);
  assert.match(css, /data-cloud-selection="stratocumulus"/);
});

test('finite playback, reduced-motion behavior, paper stage, and offline caching are wired', () => {
  assert.match(css, /data-playback-mode="finite"/);
  assert.match(css, /animation-iteration-count:\\s*1/);
  assert.match(css, /guide-motion-static/);
  assert.match(css, /guide-playback-paused/);
  assert.match(css, /#faf6f0/i);
  assert.match(serviceWorker, /faith-focus-shell-v31-watercolor-player-lifecycle/);
  assert.match(serviceWorker, /\\.\\/assets\\/guide-player\\.js/);
});

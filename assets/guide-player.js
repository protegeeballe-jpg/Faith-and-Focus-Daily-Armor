
const CLOUD_TYPES = Object.freeze(['cumulus', 'stratus', 'stratocumulus']);
const BREATH_PHASES = Object.freeze(['inhale', 'hold', 'exhale', 'rest']);
const BREATH_TRANSITION_MS = Object.freeze({ inhale: 4000, hold: 2000, exhale: 6000, rest: 0 });

const GUIDE_DEFINITIONS = {
  'loc-home': { category: 'location', timeOfDay: 'ambient', playbackMode: 'loop', durationMs: 3600 },
  'loc-office': { category: 'location', timeOfDay: 'ambient', playbackMode: 'loop', durationMs: 3600 },
  'loc-house': { category: 'location', timeOfDay: 'ambient', playbackMode: 'finite', durationMs: 3400 },
  'loc-out': { category: 'location', timeOfDay: 'ambient', playbackMode: 'loop', durationMs: 4000 },
  'start-1': { category: 'morning', timeOfDay: 'morning', playbackMode: 'finite', durationMs: 4200 },
  'start-2': { category: 'morning', timeOfDay: 'morning', playbackMode: 'finite', durationMs: 4000 },
  'start-3': { category: 'morning', timeOfDay: 'morning', playbackMode: 'loop', durationMs: 4000 },
  'start-4': { category: 'morning', timeOfDay: 'morning', playbackMode: 'finite', durationMs: 5000 },
  'mid-1': { category: 'midday', timeOfDay: 'midday', playbackMode: 'finite', durationMs: 3800 },
  'mid-2': { category: 'midday', timeOfDay: 'midday', playbackMode: 'timer-driven', durationMs: 12000 },
  'mid-3': { category: 'midday', timeOfDay: 'midday', playbackMode: 'finite', durationMs: 5000 },
  'mid-4': { category: 'midday', timeOfDay: 'midday', playbackMode: 'finite', durationMs: 4200 },
  'mid-5': { category: 'midday', timeOfDay: 'midday', playbackMode: 'finite', durationMs: 4000 },
  'end-1': { category: 'evening', timeOfDay: 'evening', playbackMode: 'finite', durationMs: 4000 },
  'end-2': { category: 'evening', timeOfDay: 'evening', playbackMode: 'finite', durationMs: 4000 },
  'end-3': { category: 'evening', timeOfDay: 'evening', playbackMode: 'finite', durationMs: 5000 },
  'end-4': { category: 'evening', timeOfDay: 'evening', playbackMode: 'finite', durationMs: 3000 },
  'sleep-1': { category: 'sleep', timeOfDay: 'night', playbackMode: 'finite', durationMs: 4200 },
  'sleep-2': { category: 'sleep', timeOfDay: 'night', playbackMode: 'finite', durationMs: 4200 },
  'sleep-3': { category: 'sleep', timeOfDay: 'night', playbackMode: 'finite', durationMs: 3500 },
  'sleep-4': { category: 'sleep', timeOfDay: 'night', playbackMode: 'finite', durationMs: 4000 },
  'sleep-5': { category: 'sleep', timeOfDay: 'night', playbackMode: 'finite', durationMs: 5000 },
  'cloud-checked': { category: 'cloud', timeOfDay: 'ambient', playbackMode: 'interactive', durationMs: 3500 }
};

export const GUIDE_PLAYBACK_SPECS = Object.freeze(
  Object.fromEntries(Object.entries(GUIDE_DEFINITIONS).map(([id, spec]) => [
    id, Object.freeze({ id, ...spec })
  ]))
);

export function resolveGuidePlaybackSpec(rawId) {
  if (typeof rawId !== 'string' ||
      !Object.prototype.hasOwnProperty.call(GUIDE_PLAYBACK_SPECS, rawId)) {
    throw new Error('[GuideSecurityError] Unregistered guideId requested: "' + String(rawId) + '"');
  }
  return GUIDE_PLAYBACK_SPECS[rawId];
}

/**
 * Controls only the watercolor illustration. Existing app timers, selections,
 * completion actions, and persistence remain authoritative outside this module.
 * This controller deliberately creates no timers of its own.
 */
export function createWatercolorGuidePlayer({ guideId, stage, modal = null, lowPowerMode = false } = {}) {
  const spec = resolveGuidePlaybackSpec(guideId);
  if (!stage || typeof stage.querySelector !== 'function' || !stage.classList || !stage.dataset) {
    throw new TypeError('[GuidePlayerError] A mounted watercolor stage is required.');
  }

  const svg = stage.querySelector('.watercolor-guide-svg');
  if (!svg || !svg.dataset) {
    throw new TypeError('[GuidePlayerError] The stage must contain a registered watercolor SVG.');
  }

  const doc = stage.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
  const reducedMotionQuery = view?.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  const connection = view?.navigator?.connection || null;
  let modalOpen = !modal || !modal.classList?.contains('hidden');
  let inViewport = true;
  let completed = false;
  let destroyed = false;
  let cloudSelection = null;
  let intersectionObserver = null;

  const onVisibilityChange = () => syncPlayback();
  const onMotionChange = () => syncPlayback();
  const onConnectionChange = () => syncPlayback();

  stage.dataset.guideId = spec.id;
  stage.dataset.playbackMode = spec.playbackMode;
  stage.dataset.timeOfDay = spec.timeOfDay;
  stage.style?.setProperty('--guide-duration', spec.durationMs + 'ms');

  function syncPlayback() {
    if (destroyed) return;
    const staticFallback = Boolean(lowPowerMode || connection?.saveData || reducedMotionQuery?.matches);
    const paused = !modalOpen || doc?.visibilityState === 'hidden' ||
      stage.isConnected === false || !inViewport;

    stage.classList.toggle('guide-motion-fallback', staticFallback);
    stage.classList.toggle('guide-playback-paused', !staticFallback && paused);

    if (staticFallback) stage.dataset.playbackState = 'fallback';
    else if (paused) stage.dataset.playbackState = 'paused';
    else if (completed && spec.playbackMode === 'finite') stage.dataset.playbackState = 'complete';
    else if (spec.playbackMode === 'interactive' && cloudSelection) stage.dataset.playbackState = 'selected';
    else stage.dataset.playbackState = 'playing';
  }

  doc?.addEventListener?.('visibilitychange', onVisibilityChange);
  if (reducedMotionQuery?.addEventListener) reducedMotionQuery.addEventListener('change', onMotionChange);
  else reducedMotionQuery?.addListener?.(onMotionChange);
  connection?.addEventListener?.('change', onConnectionChange);

  if (typeof view?.IntersectionObserver === 'function') {
    intersectionObserver = new view.IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === stage);
      if (entry) {
        inViewport = entry.isIntersecting || entry.intersectionRatio > 0;
        syncPlayback();
      }
    }, { threshold: 0.01 });
    intersectionObserver.observe(stage);
  }

  syncPlayback();

  return Object.freeze({
    spec,
    setModalOpen(isOpen) {
      if (destroyed) return;
      modalOpen = Boolean(isOpen);
      syncPlayback();
    },
    setBreathingPhase(phase) {
      if (destroyed || spec.playbackMode !== 'timer-driven') return false;
      const safePhase = phase === 'complete' ? 'rest' : phase;
      if (!BREATH_PHASES.includes(safePhase)) return false;
      svg.dataset.breathPhase = safePhase;
      stage.style?.setProperty('--guide-breath-transition', BREATH_TRANSITION_MS[safePhase] + 'ms');
      syncPlayback();
      return true;
    },
    setCloudSelection(selection) {
      if (destroyed || spec.playbackMode !== 'interactive') return false;
      cloudSelection = CLOUD_TYPES.includes(selection) ? selection : null;
      svg.dataset.cloudSelection = cloudSelection || 'idle';
      stage.dataset.cloudSelection = cloudSelection || 'idle';
      syncPlayback();
      return true;
    },
    complete() {
      if (destroyed || spec.playbackMode !== 'finite') return false;
      completed = true;
      syncPlayback();
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
      if (reducedMotionQuery?.removeEventListener) reducedMotionQuery.removeEventListener('change', onMotionChange);
      else reducedMotionQuery?.removeListener?.(onMotionChange);
      connection?.removeEventListener?.('change', onConnectionChange);
      intersectionObserver?.disconnect();
      stage.classList.remove('guide-playback-paused');
      stage.dataset.playbackState = 'destroyed';
    }
  });
}

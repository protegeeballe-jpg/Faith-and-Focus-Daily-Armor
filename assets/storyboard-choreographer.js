import { GUIDE_PLAYBACK_SPECS, resolveGuidePlaybackSpec } from './guide-player.js';

const ACTION_DESIGNS = Object.freeze({
  'loc-home': {
    setting: 'home', camera: 'wide', prop: { kind: 'home-details', attachment: 'scene' },
    primaryPart: 'rightArm', easing: 'ease-in-out', expression: 'smile',
    motion: {
      head: [[0,0,0,0,1],[22,-1,0,-5,1],[48,1,0,4,1],[76,0,0,-3,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[50,0,-1,0,1.01],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[22,-2,-2,-22,1],[46,-1,-2,17,1],[72,0,0,-12,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,0,-1,-18,1],[54,0,-1,20,1],[78,0,0,-10,1],[100,0,0,0,1]]
    }
  },
  'loc-office': {
    setting: 'office', camera: 'medium', prop: { kind: 'desk-and-notebook', attachment: 'scene' },
    primaryPart: 'rightForearm', easing: 'ease-in-out', expression: 'focused',
    motion: {
      head: [[0,0,0,0,1],[28,2,3,5,1],[55,-1,2,-3,1],[80,1,1,3,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[32,0,2,1,1],[68,0,1,-1,1],[100,0,0,0,1]],
      leftForearm: [[0,0,0,0,1],[24,1,-1,-7,1],[48,0,0,6,1],[76,1,-1,-5,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[24,-1,0,8,1],[48,1,-1,-9,1],[76,-1,0,7,1],[100,0,0,0,1]]
    }
  },
  'loc-house': {
    setting: 'guest-home', camera: 'medium', prop: { kind: 'welcome-flower', attachment: 'scene' },
    primaryPart: 'rightArm', easing: 'cubic-bezier(.2,.75,.25,1)', expression: 'smile',
    motion: {
      head: [[0,0,0,0,1],[24,0,-2,-6,1],[52,0,1,4,1],[78,0,-1,-3,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[45,0,-1,0,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[20,-1,-4,-34,1],[44,0,-4,14,1],[68,-1,-3,-28,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[25,0,-1,-22,1],[50,0,-1,18,1],[75,0,-1,-16,1],[100,0,0,0,1]]
    }
  },
  'loc-out': {
    setting: 'outdoors', camera: 'wide', prop: { kind: 'tree-and-path', attachment: 'scene' },
    primaryPart: 'lowerBody', easing: 'ease-in-out', expression: 'curious',
    motion: {
      head: [[0,0,0,0,1],[25,1,-1,3,1],[50,0,0,0,1],[75,-1,-1,-3,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[25,0,-2,1,1.01],[50,0,0,0,1],[75,0,-2,-1,1.01],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[25,0,0,15,1],[50,0,0,0,1],[75,0,0,-15,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[25,0,0,-15,1],[50,0,0,0,1],[75,0,0,15,1],[100,0,0,0,1]],
      lowerBody: [[0,0,0,0,1],[25,0,-1,0,1],[50,0,0,0,1],[75,0,-1,0,1],[100,0,0,0,1]]
    }
  },
  'start-1': {
    setting: 'morning-journal', camera: 'medium', prop: { kind: 'gratitude-journal', attachment: 'scene' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'thoughtful',
    motion: {
      head: [[0,0,0,0,1],[28,-2,2,-7,1],[55,1,2,3,1],[80,-1,1,-4,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[35,0,1,-1,1],[70,0,0,0,1],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[35,3,-2,13,1],[65,3,-2,13,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[30,-2,2,-12,1],[60,-1,1,-7,1],[100,0,0,0,1]]
    }
  },
  'start-2': {
    setting: 'quiet-morning', camera: 'medium', prop: { kind: 'warm-light', attachment: 'scene' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'soft',
    motion: {
      head: [[0,0,0,0,1],[32,0,3,5,1],[66,0,3,5,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[38,0,1,0,1],[70,0,1,0,1],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[28,4,-5,24,1],[58,5,-7,32,1],[82,4,-5,24,1],[100,0,0,0,1]],
      leftForearm: [[0,0,0,0,1],[28,6,-7,28,1],[58,7,-9,36,1],[82,6,-7,28,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,-4,-5,-24,1],[58,-5,-7,-32,1],[82,-4,-5,-24,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,-6,-7,-28,1],[58,-7,-9,-36,1],[82,-6,-7,-28,1],[100,0,0,0,1]]
    }
  },
  'start-3': {
    setting: 'sunny-garden', camera: 'wide', prop: { kind: 'morning-sun', attachment: 'scene' },
    primaryPart: 'leftArm', easing: 'cubic-bezier(.35,.05,.2,1)', expression: 'bright',
    motion: {
      head: [[0,0,0,0,1],[28,0,-2,-2,1],[55,0,-2,2,1],[78,0,-1,0,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[30,0,-3,0,1.025],[68,0,-3,0,1.025],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[30,-8,-10,-72,1],[68,-8,-10,-72,1],[100,0,0,0,1]],
      leftForearm: [[0,0,0,0,1],[30,-3,-14,-40,1],[68,-3,-14,-40,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[30,8,-10,72,1],[68,8,-10,72,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[30,3,-14,40,1],[68,3,-14,40,1],[100,0,0,0,1]]
    }
  },
  'start-4': {
    setting: 'sunlit-kitchen', camera: 'medium', prop: { kind: 'water-glass', attachment: 'right-hand' },
    primaryPart: 'rightForearm', easing: 'cubic-bezier(.25,.75,.25,1)', expression: 'sip',
    motion: {
      head: [[0,0,0,0,1],[24,1,1,4,1],[42,2,2,7,1],[70,2,2,7,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[34,1,-1,1,1],[68,1,-1,1,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,0,-3,-28,1],[58,0,-5,-44,1],[78,0,-5,-44,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,0,-3,-34,1],[58,0,-5,-58,1],[78,0,-5,-58,1],[100,0,0,0,1]]
    }
  },
  'mid-1': {
    setting: 'bright-room', camera: 'medium', prop: { kind: 'soft-sunlight', attachment: 'scene' },
    primaryPart: 'torso', easing: 'ease-in-out', expression: 'focused',
    motion: {
      head: [[0,0,0,0,1],[25,0,-2,-3,1],[54,0,-2,3,1],[78,0,-1,0,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[28,0,-3,0,1.025],[72,0,-3,0,1.025],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[30,-5,-7,-48,1],[68,-5,-7,-48,1],[100,0,0,0,1]],
      leftForearm: [[0,0,0,0,1],[30,-6,-4,-25,1],[68,-6,-4,-25,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[30,4,-5,32,1],[68,4,-5,32,1],[100,0,0,0,1]]
    }
  },
  'mid-2': {
    setting: 'calm-air', camera: 'medium', prop: { kind: 'breath-rings', attachment: 'scene' },
    primaryPart: 'torso', easing: 'ease-in-out', expression: 'breathing',
    motion: {},
    timerTimeline: Object.freeze({
      authority: 'existing-app-breathing-timer',
      phases: Object.freeze(['inhale', 'hold', 'exhale', 'rest']),
      transitionMs: Object.freeze({ inhale: 4000, hold: 2000, exhale: 6000, rest: 0 })
    })
  },
  'mid-3': {
    setting: 'midday-garden', camera: 'medium', prop: { kind: 'water-glass', attachment: 'right-hand' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'sip',
    motion: {
      head: [[0,0,0,0,1],[20,1,0,3,1],[46,2,1,6,1],[70,2,1,6,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[34,0,-1,1,1],[74,0,-1,1,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[32,-1,-2,-24,1],[60,-1,-4,-39,1],[82,-1,-4,-39,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[32,0,-2,-29,1],[60,0,-4,-52,1],[82,0,-4,-52,1],[100,0,0,0,1]]
    }
  },
  'mid-4': {
    setting: 'quiet-corner', camera: 'medium', prop: { kind: 'heart-wash', attachment: 'scene' },
    primaryPart: 'rightArm', easing: 'ease-in-out', expression: 'soft',
    motion: {
      head: [[0,0,0,0,1],[28,-1,1,-5,1],[60,-1,1,-5,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[35,-1,0,-2,1],[70,-1,0,-2,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[32,-8,-1,-42,1],[66,-9,-2,-48,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[32,-12,-4,-54,1],[66,-13,-5,-60,1],[100,0,0,0,1]]
    }
  },
  'mid-5': {
    setting: 'open-sky', camera: 'wide', prop: { kind: 'thought-cloud', attachment: 'scene' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'curious',
    motion: {
      head: [[0,0,0,0,1],[28,-3,-2,-8,1],[62,-3,-2,-8,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[26,2,-6,-32,1],[54,4,-8,-46,1],[78,2,-6,-32,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[26,3,-5,-22,1],[54,5,-7,-34,1],[78,3,-5,-22,1],[100,0,0,0,1]],
      cloud: [[0,0,0,0,1],[50,10,-4,0,1],[100,0,0,0,1]]
    }
  },
  'end-1': {
    setting: 'golden-garden', camera: 'medium', prop: { kind: 'three-stars', attachment: 'scene' },
    primaryPart: 'rightArm', easing: 'cubic-bezier(.2,.8,.25,1)', expression: 'bright',
    motion: {
      head: [[0,0,0,0,1],[28,0,-2,-4,1],[55,0,-2,3,1],[80,0,-1,0,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[30,0,-2,0,1.02],[62,0,-2,0,1.02],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[28,-4,-5,-38,1],[70,-4,-5,-38,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,5,-6,48,1],[70,5,-6,48,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,3,-4,28,1],[70,3,-4,28,1],[100,0,0,0,1]]
    }
  },
  'end-2': {
    setting: 'planning-desk', camera: 'medium', prop: { kind: 'pencil', attachment: 'right-hand' },
    primaryPart: 'rightForearm', easing: 'ease-in-out', expression: 'focused',
    motion: {
      head: [[0,0,0,0,1],[25,1,3,5,1],[58,1,3,5,1],[82,0,1,2,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[28,0,2,1,1],[70,0,2,1,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,-2,3,-14,1],[66,-2,3,-14,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[18,1,1,10,1],[36,-1,2,-8,1],[54,1,1,9,1],[72,-1,2,-7,1],[100,0,0,0,1]]
    }
  },
  'end-3': {
    setting: 'evening-window', camera: 'medium', prop: { kind: 'water-glass', attachment: 'right-hand' },
    primaryPart: 'rightForearm', easing: 'ease-in-out', expression: 'sip',
    motion: {
      head: [[0,0,0,0,1],[30,1,1,4,1],[55,2,2,6,1],[80,2,2,6,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[38,0,-1,1,1],[76,0,-1,1,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[34,0,-2,-20,1],[64,0,-3,-34,1],[82,0,-3,-34,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[34,0,-2,-26,1],[64,0,-3,-46,1],[82,0,-3,-46,1],[100,0,0,0,1]]
    }
  },
  'end-4': {
    setting: 'cozy-room', camera: 'close', prop: { kind: 'golden-spark', attachment: 'scene' },
    primaryPart: 'rightForearm', easing: 'cubic-bezier(.3,.7,.3,1)', expression: 'boop',
    motion: {
      head: [[0,0,0,0,1],[26,1,-1,5,1],[55,2,0,8,1],[72,2,0,8,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[38,0,-1,0,1],[74,0,-1,0,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,0,-4,-34,1],[58,0,-8,-58,1],[76,0,-8,-58,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,-1,-4,-38,1],[58,-2,-7,-62,1],[76,-2,-7,-62,1],[100,0,0,0,1]]
    }
  },
  'sleep-1': {
    setting: 'bedroom-evening', camera: 'close', prop: { kind: 'gratitude-notes', attachment: 'scene' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'soft',
    motion: {
      head: [[0,0,0,0,1],[30,0,2,-4,1],[66,0,2,-4,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[32,0,1,0,.99],[70,0,1,0,.99],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[32,3,-2,17,1],[68,3,-2,17,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[32,-4,-2,-18,1],[68,-4,-2,-18,1],[100,0,0,0,1]]
    }
  },
  'sleep-2': {
    setting: 'night-blessings', camera: 'medium', prop: { kind: 'moon-and-stars', attachment: 'scene' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'soft',
    motion: {
      head: [[0,0,0,0,1],[34,0,3,4,1],[72,0,3,4,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[34,0,1,0,.99],[72,0,1,0,.99],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[28,4,-4,23,1],[58,5,-6,30,1],[82,4,-4,23,1],[100,0,0,0,1]],
      leftForearm: [[0,0,0,0,1],[28,6,-6,31,1],[58,7,-8,38,1],[82,6,-6,31,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,-4,-4,-23,1],[58,-5,-6,-30,1],[82,-4,-4,-23,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,-6,-6,-31,1],[58,-7,-8,-38,1],[82,-6,-6,-31,1],[100,0,0,0,1]]
    }
  },
  'sleep-3': {
    setting: 'moonlit-bedroom', camera: 'medium', prop: { kind: 'phone', attachment: 'right-hand' },
    primaryPart: 'rightArm', easing: 'ease-in-out', expression: 'focused',
    motion: {
      head: [[0,0,0,0,1],[28,2,1,7,1],[58,3,1,9,1],[82,0,0,0,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[34,-1,1,-2,1],[68,-1,1,-2,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,8,2,28,1],[58,15,5,48,1],[82,18,8,56,1],[100,18,8,56,1]],
      rightForearm: [[0,0,0,0,1],[28,7,4,18,1],[58,12,7,28,1],[82,16,9,38,1],[100,16,9,38,1]]
    }
  },
  'sleep-4': {
    setting: 'quiet-night', camera: 'close', prop: { kind: 'crescent-glow', attachment: 'scene' },
    primaryPart: 'head', easing: 'ease-in-out', expression: 'soft',
    motion: {
      head: [[0,0,0,0,1],[35,0,3,5,1],[74,0,3,5,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[35,0,1,0,.99],[74,0,1,0,.99],[100,0,0,0,1]],
      leftArm: [[0,0,0,0,1],[28,4,-4,26,1],[62,5,-7,34,1],[84,4,-4,26,1],[100,0,0,0,1]],
      leftForearm: [[0,0,0,0,1],[28,6,-7,33,1],[62,7,-9,41,1],[84,6,-7,33,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[28,-4,-4,-26,1],[62,-5,-7,-34,1],[84,-4,-4,-26,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[28,-6,-7,-33,1],[62,-7,-9,-41,1],[84,-6,-7,-33,1],[100,0,0,0,1]]
    }
  },
  'sleep-5': {
    setting: 'bedside', camera: 'close', prop: { kind: 'water-glass', attachment: 'right-hand' },
    primaryPart: 'rightForearm', easing: 'ease-in-out', expression: 'sip',
    motion: {
      head: [[0,0,0,0,1],[25,1,1,4,1],[48,1,2,6,1],[74,1,2,6,1],[100,0,0,0,1]],
      torso: [[0,0,0,0,1],[34,0,1,0,1],[70,0,1,0,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[26,0,-1,-18,1],[52,0,-3,-32,1],[76,0,-3,-32,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[26,0,-2,-24,1],[52,0,-4,-48,1],[76,0,-4,-48,1],[100,0,0,0,1]]
    }
  },
  'cloud-checked': {
    setting: 'cloud-sky', camera: 'wide', prop: { kind: 'release-cloud', attachment: 'interactive-scene' },
    primaryPart: 'cloud', easing: 'ease-in-out', expression: 'curious',
    motion: {
      head: [[0,0,0,0,1],[28,-2,-2,-6,1],[62,-2,-2,-6,1],[100,0,0,0,1]],
      rightArm: [[0,0,0,0,1],[26,2,-4,-24,1],[54,3,-6,-34,1],[80,2,-4,-24,1],[100,0,0,0,1]],
      rightForearm: [[0,0,0,0,1],[26,2,-3,-20,1],[54,3,-5,-28,1],[80,2,-3,-20,1],[100,0,0,0,1]],
      cloud: [[0,0,0,0,1],[50,7,-3,0,1],[100,0,0,0,1]]
    }
  }
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const playbackIds = Object.keys(GUIDE_PLAYBACK_SPECS).sort();
const designIds = Object.keys(ACTION_DESIGNS).sort();
if (playbackIds.length !== 23 ||
    playbackIds.length !== designIds.length ||
    playbackIds.some((id, index) => id !== designIds[index])) {
  throw new Error('[GuideStoryboardError] Storyboard registry must match the 23 registered guide IDs exactly.');
}

export const GUIDE_STORYBOARDS = deepFreeze(Object.fromEntries(
  Object.entries(ACTION_DESIGNS).map(([id, design]) => {
    const playback = resolveGuidePlaybackSpec(id);
    return [id, {
      id,
      ...design,
      category: playback.category,
      timeOfDay: playback.timeOfDay,
      playbackRule: playback.playbackMode,
      durationMs: playback.durationMs
    }];
  })
));

const PARTS = Object.freeze({
  head: { selector: '.wgi-head', origin: '150px 96px' },
  torso: { selector: '.wgi-torso', origin: '150px 143px' },
  leftArm: { selector: '.wgi-arm--left', origin: '130px 108px' },
  leftForearm: { selector: '.wgi-forearm--left', origin: '121px 128px' },
  rightArm: { selector: '.wgi-arm--right', origin: '170px 108px' },
  rightForearm: { selector: '.wgi-forearm--right', origin: '181px 128px' },
  lowerBody: { selector: '.wgi-lower-body', origin: '150px 145px' },
  cloud: { selector: '.wgi-cloud-drift', origin: '240px 90px' }
});

function validFrame(frame, previousPercent) {
  if (!Array.isArray(frame) || frame.length !== 5) return false;
  const [percent, x, y, rotation, scale] = frame;
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 &&
    percent > previousPercent &&
    Number.isFinite(x) && Math.abs(x) <= 32 &&
    Number.isFinite(y) && Math.abs(y) <= 32 &&
    Number.isFinite(rotation) && Math.abs(rotation) <= 85 &&
    Number.isFinite(scale) && scale >= 0.96 && scale <= 1.04;
}

function framesToCss(frames) {
  let previousPercent = -1;
  return frames.map((frame) => {
    if (!validFrame(frame, previousPercent)) {
      throw new Error('[GuideStoryboardError] Invalid keyframe in registered choreography.');
    }
    previousPercent = frame[0];
    const [percent, x, y, rotation, scale] = frame;
    return percent + '%{transform:translate(' + x + 'px,' + y + 'px) rotate(' + rotation + 'deg) scale(' + scale + ');}';
  }).join('');
}

function expressionCss(prefix, id, expression, duration, iterations, fill) {
  const selector = prefix;
  const blinkFrames = expression === 'soft'
    ? '0%,18%,78%,100%{opacity:1}30%,68%{opacity:0}'
    : '0%,36%,44%,100%{opacity:1}40%,42%{opacity:0}';
  const mouth = expression === 'sip'
    ? '0%,30%,75%,100%{opacity:0}38%,68%{opacity:1}'
    : expression === 'yawn'
      ? '0%,30%,75%,100%{opacity:0}38%,68%{opacity:1}'
      : '';
  let css = '@keyframes wgi-face-' + id + '-eyes-open{' + blinkFrames + '}';
  css += '@keyframes wgi-face-' + id + '-eyes-closed{0%,36%,44%,100%{opacity:0}40%,42%{opacity:1}}';
  css += selector + ' .wgi-eyes-open{animation:wgi-face-' + id + '-eyes-open ' + duration + 'ms ease-in-out ' + iterations + ' ' + fill + '}';
  css += selector + ' .wgi-eyes-closed{animation:wgi-face-' + id + '-eyes-closed ' + duration + 'ms ease-in-out ' + iterations + ' ' + fill + '}';
  if (mouth) {
    css += '@keyframes wgi-face-' + id + '-mouth{0%,30%,75%,100%{opacity:0}38%,68%{opacity:1}}';
    css += selector + ' .wgi-mouth-smile{opacity:0;animation:none}';
    css += selector + ' .wgi-mouth-' + (expression === 'yawn' ? 'yawn' : 'sip') + '{opacity:0;animation:wgi-face-' + id + '-mouth ' + duration + 'ms ease-in-out ' + iterations + ' ' + fill + '}';
  }
  return css;
}

export function getGuideStoryboard(rawId) {
  if (typeof rawId !== 'string' || !Object.prototype.hasOwnProperty.call(GUIDE_STORYBOARDS, rawId)) {
    throw new Error('[GuideSecurityError] Unregistered storyboard requested: "' + String(rawId) + '"');
  }
  return GUIDE_STORYBOARDS[rawId];
}

export function buildGuideStoryboardStylesheet(rawId) {
  const storyboard = getGuideStoryboard(rawId);
  const prefix = 'svg.watercolor-guide-svg[data-guide-id="' + storyboard.id + '"]';
  const mode = storyboard.playbackRule;
  const iterations = mode === 'finite' ? '1' : 'infinite';
  const fill = mode === 'finite' ? 'both' : 'none';
  const duration = storyboard.durationMs;
  let css = '';

  if (mode === 'timer-driven') {
    css += prefix + ' .wgi-torso,' + prefix + ' .wgi-arm,' + prefix + ' .wgi-forearm,' + prefix + ' .wgi-head{' +
      'transition:transform var(--guide-breath-transition,0ms) cubic-bezier(.35,.05,.2,1)}';
    css += prefix + ' .wgi-breath-ring{' +
      'animation:none;transform:scale(.78);transform-box:view-box;transform-origin:78px 91px;' +
      'transition:transform var(--guide-breath-transition,0ms) cubic-bezier(.35,.05,.2,1)}';
    css += prefix + '[data-breath-phase="inhale"] .wgi-breath-ring,' +
      prefix + '[data-breath-phase="hold"] .wgi-breath-ring{transform:scale(1.2)}';
    css += prefix + '[data-breath-phase="exhale"] .wgi-breath-ring,' +
      prefix + '[data-breath-phase="rest"] .wgi-breath-ring{transform:scale(.78)}';
    css += prefix + '[data-breath-phase="inhale"] .wgi-torso,' +
      prefix + '[data-breath-phase="hold"] .wgi-torso{transform:translateY(-1px) scale(1.025,1.018)}';
    css += prefix + '[data-breath-phase="inhale"] .wgi-arm--left,' +
      prefix + '[data-breath-phase="hold"] .wgi-arm--left{transform:rotate(-5deg)}';
    css += prefix + '[data-breath-phase="inhale"] .wgi-arm--right,' +
      prefix + '[data-breath-phase="hold"] .wgi-arm--right{transform:rotate(5deg)}';
    css += prefix + '[data-breath-phase="exhale"] .wgi-torso,' +
      prefix + '[data-breath-phase="rest"] .wgi-torso,' +
      prefix + '[data-breath-phase="exhale"] .wgi-arm,' +
      prefix + '[data-breath-phase="rest"] .wgi-arm{transform:none}';
  } else {
    Object.entries(storyboard.motion).forEach(([partName, frames]) => {
      const part = PARTS[partName];
      if (!part) throw new Error('[GuideStoryboardError] Unknown articulated rig part: ' + partName);
      const keyframeName = 'wgi-story-' + storyboard.id + '-' + partName;
      css += '@keyframes ' + keyframeName + '{' + framesToCss(frames) + '}';
      css += prefix + ' ' + part.selector + '{' +
        'transform-box:view-box;transform-origin:' + part.origin + ';' +
        'animation-name:' + keyframeName + ';animation-duration:' + duration + 'ms;' +
        'animation-timing-function:' + storyboard.easing + ';' +
        'animation-iteration-count:' + iterations + ';animation-fill-mode:' + fill + '}';
    });
    css += expressionCss(prefix, storyboard.id, storyboard.expression, duration, iterations, fill);
  }

  if (storyboard.id === 'cloud-checked') {
    css += prefix + '[data-cloud-selection="cumulus"] .wgi-cloud{transform:translate(3px,-2px) scale(1.08);transform-origin:240px 90px;transition:transform 420ms ease,opacity 420ms ease}';
    css += prefix + '[data-cloud-selection="stratus"] .wgi-cloud{transform:scaleX(1.12) scaleY(.9);transform-origin:240px 90px;transition:transform 420ms ease,opacity 420ms ease}';
    css += prefix + '[data-cloud-selection="stratocumulus"] .wgi-cloud{transform:translateY(2px) scale(.98);opacity:.78;transform-origin:240px 90px;transition:transform 420ms ease,opacity 420ms ease}';
  }

  css += '@media(prefers-reduced-motion:reduce){' + prefix + ',' + prefix + ' *{animation:none!important;transition:none!important}}';
  return css;
}

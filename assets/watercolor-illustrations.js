import { LIGHTING_THEMES, buildCharacterRigMarkup, buildWatercolorDefs } from './character-appearance.js';
import { getGuideStoryboard, buildGuideStoryboardStylesheet } from './storyboard-choreographer.js';
import { GUIDE_PLAYBACK_SPECS } from './guide-player.js';

const SCENES = Object.freeze({
  "loc-home": { title: "A peaceful place at home", label: "A watercolor home scene with a welcoming doorway and garden flowers", kind: "home", pose: "relaxed" },
  "loc-office": { title: "A calm moment at work", label: "A watercolor work scene with a sunlit window, desk, and leafy plant", kind: "office", pose: "relaxed" },
  "loc-house": { title: "A warm welcome", label: "A watercolor guest-house scene with a welcoming doorway and small flowers", kind: "guest", pose: "relaxed" },
  "loc-out": { title: "Out in the open air", label: "A watercolor outdoor scene with a leafy tree, rolling hills, and a winding path", kind: "outdoors", pose: "relaxed" },
  "start-1": { title: "Three grateful things", label: "A watercolor illustration of a person reflecting beside an open journal and a small flower", kind: "gratitude", pose: "relaxed" },
  "start-2": { title: "Prayer and intention", label: "A watercolor illustration of a person with hands gently joined in prayer beneath a warm light", kind: "prayer", pose: "prayer" },
  "start-3": { title: "Gentle movement", label: "A watercolor illustration of a person reaching both arms overhead in a gentle stretch", kind: "stretch", pose: "stretch" },
  "start-4": { title: "A little hydration", label: "A watercolor illustration of a person lifting a glass of fresh water", kind: "drink", pose: "drink" },
  "mid-1": { title: "Posture and stretch", label: "A watercolor illustration of a person gently stretching beneath a soft sun", kind: "stretch", pose: "stretch" },
  "mid-2": { title: "Breathe with me", label: "A watercolor illustration of a calm person beside soft, expanding breath rings", kind: "breathe", pose: "breathe" },
  "mid-3": { title: "Midday water break", label: "A watercolor illustration of a person taking a comfortable sip of water", kind: "drink", pose: "drink" },
  "mid-4": { title: "Check how you feel", label: "A watercolor illustration of a person with a hand over their heart and a gentle heart-shaped wash", kind: "feeling", pose: "heart" },
  "mid-5": { title: "Let a thought drift by", label: "A watercolor illustration of a soft cloud drifting freely through a peaceful sky", kind: "float", pose: "float" },
  "end-1": { title: "Three wins today", label: "A watercolor illustration of a journal, a flower, and three small golden stars", kind: "gratitude", pose: "relaxed" },
  "end-2": { title: "Tomorrow's priorities", label: "A watercolor illustration of an open notebook and pencil ready for tomorrow's plans", kind: "journal", pose: "write" },
  "end-3": { title: "Evening hydration", label: "A watercolor illustration of a person holding a glass of water in the evening", kind: "drink", pose: "drink" },
  "end-4": { title: "A gentle good-job boop", label: "A watercolor illustration of a gentle fingertip nose boop with small glowing stars", kind: "boop", pose: "boop" },
  "sleep-1": { title: "Gratitude for others", label: "A watercolor illustration of a journal and flower representing gratitude for others", kind: "gratitude", pose: "relaxed" },
  "sleep-2": { title: "Gratitude for blessings", label: "A watercolor illustration of a peaceful journal with soft golden light and a flower", kind: "gratitude", pose: "prayer" },
  "sleep-3": { title: "Screen sunset", label: "A watercolor moonlit room with a phone resting away from a comfortable bed", kind: "sleep", pose: "night" },
  "sleep-4": { title: "A peaceful intention", label: "A watercolor illustration of a person resting with hands gently joined in prayer beneath a crescent moon", kind: "prayer", pose: "prayer" },
  "sleep-5": { title: "Bedtime water reminder", label: "A watercolor illustration of a person holding a small glass of water beneath a quiet evening sky", kind: "drink", pose: "drink" },
  "cloud-checked": { title: "Cloud check", label: "A watercolor illustration of a soft cloud floating away along a dotted breeze", kind: "float", pose: "float" }
});

const DETAIL_ART = Object.freeze({
  home: '<g class="wgi-setting"><path d="M204 103 L250 61 L296 103 V151 H204Z" fill="#f2d9b8" stroke="#a77f60" stroke-width="2.2" stroke-linejoin="round"/><path d="M194 105 L250 52 L306 105" fill="none" stroke="#9b7560" stroke-width="5" stroke-linecap="round"/><rect x="239" y="112" width="23" height="39" rx="3" fill="#b98268" stroke="#91634f" stroke-width="1.8"/><rect x="214" y="111" width="17" height="17" rx="3" fill="#d7edf0" stroke="#9bbdb7" stroke-width="1.5"/><path d="M222 112 V128 M214 119 H231" stroke="#fffaf0" stroke-width="1.5"/><path d="M196 155 Q211 143 226 155 M273 155 Q286 143 302 155" fill="none" stroke="#8baa7e" stroke-width="4" stroke-linecap="round"/></g>',
  office: '<g class="wgi-setting"><rect x="216" y="53" width="70" height="62" rx="6" fill="#dcebed" stroke="#a5b9ae" stroke-width="2"/><path d="M251 55 V113 M218 84 H284" stroke="#fffaf0" stroke-width="3"/><path d="M200 132 Q246 125 301 132" fill="none" stroke="#ad8669" stroke-width="7" stroke-linecap="round"/><path d="M225 132 V157 M278 132 V157" stroke="#9c765e" stroke-width="3" stroke-linecap="round"/><rect x="238" y="104" width="30" height="22" rx="3" fill="#9eb9ba" stroke="#6e9691" stroke-width="2"/><path d="M245 109 H261 M245 115 H258" stroke="#f5fbf5" stroke-width="1.8" stroke-linecap="round"/><path d="M292 123 Q282 106 290 92 Q303 100 298 122 M292 124 Q302 105 309 109 Q308 124 292 124Z" fill="#a5c69a" stroke="#719676" stroke-width="1.5"/><path d="M291 124 L296 139" stroke="#a57c5d" stroke-width="3"/></g>',
  guest: '<g class="wgi-setting"><path d="M211 105 L254 65 L298 105 V151 H211Z" fill="#f1e3c9" stroke="#a98b69" stroke-width="2.2" stroke-linejoin="round"/><path d="M201 106 L254 56 L308 106" fill="none" stroke="#b47f69" stroke-width="5" stroke-linecap="round"/><rect x="244" y="112" width="21" height="39" rx="4" fill="#c18a72" stroke="#93674f" stroke-width="1.8"/><circle cx="260" cy="132" r="1.8" fill="#f7e5b3"/><path d="M215 152 Q229 140 241 152 M268 152 Q283 140 297 152" fill="none" stroke="#9fbd91" stroke-width="4" stroke-linecap="round"/><path d="M220 91 Q226 82 231 91 Q226 100 220 91Z" fill="#e8a5a5"/></g>',
  outdoors: '<g class="wgi-setting"><path d="M193 143 Q236 119 319 143 V171 H192Z" fill="#d8e7ce" opacity=".8"/><path d="M205 144 Q238 130 264 146 Q282 154 319 144" fill="none" stroke="#a4bd94" stroke-width="3"/><path d="M263 126 Q260 94 266 72" fill="none" stroke="#92704f" stroke-width="7" stroke-linecap="round"/><path d="M267 94 Q241 79 237 60 Q260 58 269 81 Q277 58 298 58 Q295 82 270 98Z" fill="#a7c69b" stroke="#759777" stroke-width="1.6"/><path d="M15 153 Q88 145 158 154" fill="none" stroke="#c7d9c0" stroke-width="4" stroke-linecap="round"/><path d="M207 158 Q247 149 310 160" fill="none" stroke="#c2d5b5" stroke-width="3" stroke-linecap="round"/></g>',
  gratitude: '<g class="wgi-object wgi-object--float"><path d="M196 128 Q225 119 252 128 L249 155 Q223 148 198 155Z" fill="#f7e8ca" stroke="#b99a72" stroke-width="1.8"/><path d="M224 126 V153 M203 136 Q215 132 220 137 M230 136 Q240 132 247 137" fill="none" stroke="#c29d7e" stroke-width="1.5" stroke-linecap="round"/><path d="M275 119 Q270 98 280 82" fill="none" stroke="#779875" stroke-width="2.5" stroke-linecap="round"/><path d="M279 99 Q263 87 266 78 Q280 79 282 94 M280 106 Q294 91 301 99 Q295 111 280 106" fill="#a7c89d" stroke="#789b7b" stroke-width="1.4"/><g class="wgi-flower"><path d="M280 83 Q279 69 284 64" fill="none" stroke="#789b7b" stroke-width="2"/><g fill="#efc1bb" stroke="#d99d9c" stroke-width="1"><ellipse cx="281" cy="61" rx="5" ry="9"/><ellipse cx="281" cy="61" rx="5" ry="9" transform="rotate(72 281 68)"/><ellipse cx="281" cy="61" rx="5" ry="9" transform="rotate(144 281 68)"/><ellipse cx="281" cy="61" rx="5" ry="9" transform="rotate(216 281 68)"/><ellipse cx="281" cy="61" rx="5" ry="9" transform="rotate(288 281 68)"/></g><circle cx="281" cy="68" r="3.5" fill="#d7aa62"/></g><path d="M197 82 L201 74 L205 82 L213 86 L205 90 L201 98 L197 90 L189 86Z" fill="#e6c476" opacity=".9"/></g>',
  prayer: '<g class="wgi-object"><ellipse cx="151" cy="83" rx="53" ry="55" fill="#f2dca4" opacity=".24"/><path class="wgi-prayer-glow" d="M150 23 L155 34 L167 36 L157 44 L160 56 L150 49 L140 56 L143 44 L133 36 L145 34Z" fill="#e6c477" opacity=".8"/><path d="M203 145 Q219 130 228 146" fill="none" stroke="#b1c9aa" stroke-width="3" stroke-linecap="round"/><path d="M211 146 Q218 132 225 146" fill="none" stroke="#e7c783" stroke-width="2" stroke-linecap="round"/></g>',
  stretch: '<g class="wgi-object"><circle class="wgi-sun" cx="73" cy="71" r="17" fill="#f3d58a" opacity=".72"/><path d="M73 43 V34 M73 108 V99 M45 71 H36 M110 71 H101 M53 51 L46 44 M100 98 L93 91 M94 51 L101 44" stroke="#d8b66d" stroke-width="2.5" stroke-linecap="round"/><path d="M22 156 Q64 145 106 156 M206 160 Q252 150 300 160" fill="none" stroke="#bfd5c0" stroke-width="3" stroke-linecap="round"/></g>',
  drink: '<g class="wgi-object"><path d="M213 68 L251 68 L245 123 Q232 131 219 123Z" fill="#e6f3ef" stroke="#86b7b1" stroke-width="2.3" stroke-linejoin="round"/><path d="M217 92 Q233 86 248 92 L245 121 Q232 127 220 121Z" fill="#9bd5dc" opacity=".8"/><path d="M217 91 Q232 97 248 91" fill="none" stroke="#6cb5c3" stroke-width="2.2"/><path d="M222 76 Q231 80 242 76" fill="none" stroke="#fff" stroke-width="2" opacity=".9"/><path class="wgi-water-drop" d="M270 70 C264 79 264 84 270 87 C276 84 276 79 270 70Z" fill="#8cc8d0"/><path class="wgi-water-drop wgi-water-drop--two" d="M193 104 C188 111 189 115 194 117 C199 115 199 111 193 104Z" fill="#8cc8d0"/><path d="M205 138 Q232 145 260 138" fill="none" stroke="#b9d9d5" stroke-width="3" stroke-linecap="round"/></g>',
  breathe: '<g class="wgi-object"><circle class="wgi-breath-ring" cx="78" cy="91" r="34" fill="none" stroke="#9dc7cf" stroke-width="3" opacity=".6"/><circle class="wgi-breath-ring wgi-breath-ring--two" cx="78" cy="91" r="23" fill="none" stroke="#c0d9d8" stroke-width="2.5" opacity=".78"/><path class="wgi-breath-line" d="M17 111 Q42 92 63 108 Q84 125 108 105" fill="none" stroke="#9ec8c5" stroke-width="3" stroke-linecap="round"/><path class="wgi-breath-line wgi-breath-line--two" d="M18 123 Q43 104 63 120 Q83 135 106 118" fill="none" stroke="#d8b9be" stroke-width="2" stroke-linecap="round"/><path d="M75 49 L79 42 L83 49" fill="none" stroke="#d4b86e" stroke-width="2" stroke-linecap="round"/></g>',
  feeling: '<g class="wgi-object"><path class="wgi-heart" d="M229 78 C215 62 195 76 204 92 L229 115 L254 92 C263 76 243 62 229 78Z" fill="#eaa8aa" stroke="#c87e88" stroke-width="2"/><path d="M217 80 Q224 75 230 83" fill="none" stroke="#fff4ed" stroke-width="2.4" stroke-linecap="round"/><circle cx="274" cy="111" r="5" fill="#e6c57f"/><circle cx="283" cy="96" r="3.5" fill="#a8c9c0"/><path d="M198 55 L202 47 L206 55 L214 59 L206 63 L202 71 L198 63 L190 59Z" fill="#e6c57f"/></g>',
  float: '<g class="wgi-object"><g class="wgi-cloud-drift"><g class="wgi-cloud"><path d="M209 103 C198 103 193 96 196 87 C199 78 208 76 215 80 C220 65 239 62 249 76 C261 71 277 80 275 94 C274 102 266 106 257 106Z" fill="#f8fbf8" stroke="#9ebfc0" stroke-width="2.2"/><path d="M205 91 Q223 85 237 91 Q253 96 268 89" fill="none" stroke="#d3e5df" stroke-width="3" opacity=".8" stroke-linecap="round"/><path d="M218 78 Q229 69 240 78" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g></g><path d="M204 122 Q230 140 274 124" fill="none" stroke="#b5d4d1" stroke-width="2" stroke-dasharray="3 6" stroke-linecap="round"/><circle cx="286" cy="120" r="3" fill="#d8bf7d"/><circle cx="299" cy="113" r="2.2" fill="#d8bf7d"/></g>',
  journal: '<g class="wgi-object"><path d="M196 127 Q222 119 249 129 L249 158 Q221 149 196 158Z" fill="#f5e6c9" stroke="#b89972" stroke-width="2" stroke-linejoin="round"/><path d="M222 126 V155 M202 137 Q214 133 218 138 M229 137 Q239 133 244 138 M202 145 Q214 141 218 146 M229 145 Q239 141 244 146" fill="none" stroke="#c3a17f" stroke-width="1.5" stroke-linecap="round"/><path class="wgi-pencil" d="M264 112 L280 91 L285 96 L269 117 L261 120Z" fill="#d6a96b" stroke="#a77e54" stroke-width="1.6"/><path d="M280 91 L285 87 L289 92 L285 96Z" fill="#e9c8ac"/><path d="M260 123 L261 120 L264 122Z" fill="#6f7d74"/></g>',
  boop: '<g class="wgi-object"><path class="wgi-boop-spark" d="M205 61 L210 49 L215 61 L227 66 L215 71 L210 83 L205 71 L193 66Z" fill="#eccd7d"/><path d="M246 104 L250 96 L254 104 L262 108 L254 112 L250 120 L246 112 L238 108Z" fill="#e9b6b0"/><path d="M190 121 Q209 109 224 122" fill="none" stroke="#c0d6c4" stroke-width="3" stroke-linecap="round"/></g>',
  sleep: '<g class="wgi-object"><path d="M258 42 C238 47 231 69 240 84 C249 100 269 102 283 91 C267 91 254 78 254 63 C254 55 255 48 258 42Z" fill="#e8c982" stroke="#c4a76f" stroke-width="1.5"/><path d="M211 136 Q239 121 278 136 V157 H211Z" fill="#d9cde6" stroke="#a999c0" stroke-width="2"/><path d="M214 136 Q240 128 260 137" fill="none" stroke="#fbf6ff" stroke-width="3" stroke-linecap="round"/><rect x="285" y="119" width="17" height="29" rx="3" fill="#9eb8bd" stroke="#6f9198" stroke-width="1.7" transform="rotate(8 293 133)"/><circle cx="293" cy="143" r="1.5" fill="#edf6ee"/><path d="M215 74 L219 67 L223 74 L230 78 L223 82 L219 89 L215 82 L208 78Z" fill="#dfc47e"/><circle cx="288" cy="56" r="2.5" fill="#e5cc8a"/></g>'
});

const CHARACTER_SEQUENCES = new Set([
  "relaxed", "prayer", "stretch", "drink", "breathe",
  "heart", "float", "write", "boop", "night", "celebrate"
]);

export const GUIDE_ILLUSTRATION_IDS = Object.freeze(Object.keys(SCENES));

export const GUIDE_ANIMATION_SEQUENCES = Object.freeze(Object.fromEntries(
  Object.entries(SCENES).map(([id, scene]) => [id, scene.pose])
));

export function getBreathingAnimationPhase(phaseName) {
  const phases = Object.freeze({
    "Breathe in": "inhale",
    "Hold softly": "hold",
    "Breathe out": "exhale"
  });
  return phases[phaseName] || "rest";
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function sceneDetailFor(storyboard, scene) {
  let detail = DETAIL_ART[scene.kind] || DETAIL_ART.gratitude;
  if (storyboard.prop.attachment === 'right-hand' && storyboard.prop.kind === 'water-glass' && scene.kind === 'drink') {
    detail = '<g class="wgi-setting wgi-setting--drink">' +
      '<rect x="221" y="52" width="69" height="77" rx="5" fill="#F4E9D4" fill-opacity=".64" stroke="#D1B99A" stroke-width="1.8"/>' +
      '<path d="M255.5 53 V128 M222 90.5 H289" fill="none" stroke="#FFF9EC" stroke-width="3" opacity=".9"/>' +
      '<circle cx="271" cy="70" r="10" fill="#F4D58D" opacity=".68"/>' +
      '<path d="M231 119 Q243 111 252 119 M263 119 Q275 111 283 119" fill="none" stroke="#B6CBAE" stroke-width="2.5" stroke-linecap="round"/>' +
      '</g>';
  }
  if (storyboard.prop.attachment === 'right-hand' && storyboard.prop.kind === 'pencil') {
    detail = detail.replace(/<path class="wgi-pencil"[\s\S]*?<path d="M260 123[\s\S]*?<\/path>/, '');
  }
  if (storyboard.prop.attachment === 'right-hand' && storyboard.prop.kind === 'phone') {
    detail = detail.replace(/<rect x="285" y="119" width="17" height="29"[\s\S]*?<circle cx="293" cy="143" r="1.5" fill="#edf6ee"\/>/, '');
  }
  return detail;
}

export function buildGuideIllustrationSvg(id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(SCENES, id)) {
    throw new Error('[GuideSecurityError] Unregistered illustration guideId: "' + String(id) + '"');
  }

  const scene = SCENES[id];
  const storyboard = getGuideStoryboard(id);
  const playback = GUIDE_PLAYBACK_SPECS[id];
  const sequence = CHARACTER_SEQUENCES.has(scene.pose) ? scene.pose : 'relaxed';
  const prefix = 'wgi-' + id;
  const rightHandProp = storyboard.prop.attachment === 'right-hand'
    ? storyboard.prop.kind
    : null;
  const lighting = storyboard.timeOfDay;
  const theme = LIGHTING_THEMES[lighting] || LIGHTING_THEMES.ambient;
  const character = buildCharacterRigMarkup({
    pose: sequence,
    prefix,
    rightHandProp,
    primaryMotionPart: storyboard.primaryPart
  });
  const detail = sceneDetailFor(storyboard, scene);
  const breathPhase = playback.playbackMode === 'timer-driven'
    ? ' data-breath-phase="rest"'
    : '';
  const cloudState = playback.playbackMode === 'interactive'
    ? ' data-cloud-selection="idle"'
    : '';

  return '<svg class="watercolor-guide-svg watercolor-guide-svg--' + sequence +
    ' watercolor-guide-svg--camera-' + storyboard.camera + '" data-guide-id="' + id +
    '" data-sequence="' + sequence + '" data-camera="' + storyboard.camera + '" data-lighting="' + lighting +
    '" data-setting="' + storyboard.setting + '" data-prop-kind="' + storyboard.prop.kind +
    '" data-prop-attachment="' + storyboard.prop.attachment + '" data-playback-rule="' +
    storyboard.playbackRule + '" data-duration-ms="' + storyboard.durationMs + '"' +
    breathPhase + cloudState +
    ' viewBox="0 0 320 190" role="img" aria-label="' + escapeXml(scene.label) +
    '" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
    '<title>' + escapeXml(scene.title) + '</title>' +
    buildWatercolorDefs(prefix, lighting) +
    '<style>' + buildGuideStoryboardStylesheet(id) + '</style>' +
    '<rect x="0" y="0" width="320" height="190" fill="url(#' + prefix + '-sky)"/>' +
    '<ellipse cx="160" cy="91" rx="153" ry="84" fill="url(#' + prefix + '-paper-wash)" filter="url(#' + prefix + '-pigment-grain)"/>' +
    '<rect x="0" y="0" width="320" height="190" fill="url(#' + prefix + '-paper-fleck)" opacity=".38"/>' +
    '<rect x="0" y="0" width="320" height="190" fill="' + theme.ambientOverlay +
    '" opacity="' + theme.ambientOpacity + '"/>' +
    '<path d="M0 157 Q76 147 130 157 Q191 166 249 155 Q282 150 320 157 V190 H0Z" fill="url(#' +
    prefix + '-ground)"/>' +
    '<path d="M18 157 Q76 147 130 157 Q191 166 249 155 Q282 150 304 157" fill="none" stroke="#c4d7c3" stroke-width="6" opacity=".35" stroke-linecap="round"/>' +
    '<path d="M25 162 Q83 154 132 163 M218 163 Q267 153 298 162" fill="none" stroke="#a9c7b4" stroke-width="2" opacity=".65" stroke-linecap="round"/>' +
    '<g class="wgi-scene-art" filter="url(#' + prefix + '-pigment-grain)">' + detail + '</g>' +
    '<g class="wgi-character-pigment" filter="url(#' + prefix + '-pigment-grain)">' + character + '</g>' +
    '<g class="wgi-sparkles" fill="url(#' + prefix + '-gold)"><path d="M47 77 L51 68 L55 77 L64 81 L55 85 L51 94 L47 85 L38 81Z"/><path d="M292 61 L295 54 L298 61 L305 64 L298 67 L295 74 L292 67 L285 64Z" transform="scale(.85 .85) translate(53 14)"/></g>' +
    '<g fill="#94b58a" opacity=".9"><path d="M30 155 Q38 139 45 155 Q38 151 30 155Z"/><path d="M48 160 Q55 145 62 160 Q55 156 48 160Z"/><path d="M276 158 Q283 142 290 158 Q283 154 276 158Z"/></g>' +
    '</svg>';
}

export function buildVictoryCharacterSvg() {
  const prefix = 'wgi-victory';
  const character = buildCharacterRigMarkup({ pose: 'celebrate', prefix });
  return '<svg class="finale-character-svg" viewBox="0 0 320 190" role="img" aria-label="A joyful watercolor character celebrating with a bright smile and both arms raised" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
    '<title>A joyful little celebration</title>' +
    buildWatercolorDefs(prefix, 'ambient') +
    '<ellipse cx="160" cy="96" rx="133" ry="83" fill="url(#' + prefix + '-paper-wash)"/>' +
    '<path d="M30 156 Q86 145 145 158 Q213 166 290 155" fill="none" stroke="#BCD2BC" stroke-width="5" opacity=".5" stroke-linecap="round"/>' +
    '<g class="wgi-character-pigment" filter="url(#' + prefix + '-pigment-grain)">' + character + '</g>' +
    '<g class="finale-character-sparkles" fill="url(#' + prefix + '-gold)"><path d="M72 62 L76 53 L80 62 L89 66 L80 70 L76 79 L72 70 L63 66Z"/><path d="M238 55 L242 46 L246 55 L255 59 L246 63 L242 72 L238 63 L229 59Z"/><circle cx="100" cy="108" r="2.6"/><circle cx="218" cy="107" r="2.6"/></g>' +
    '</svg>';
}

export function buildWatercolorCloudSvg(kind) {
  const variants = {
    cumulus: '<g class="wcc-cloud wcc-cumulus"><path d="M18 48 C10 44 12 31 23 29 C26 16 43 13 51 24 C62 14 79 21 79 34 C94 35 96 51 85 56 H27 C22 56 19 53 18 48Z" fill="#f7fcfc" stroke="#9cbec2" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 38 Q43 29 57 38 Q72 44 85 36" fill="none" stroke="#d6e8e5" stroke-width="3" stroke-linecap="round"/><path d="M33 28 Q44 20 53 29" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>',
    stratus: '<g class="wcc-cloud wcc-stratus"><path d="M12 33 Q30 22 49 29 Q69 22 89 34 Q94 43 86 48 Q55 54 18 47 Q8 43 12 33Z" fill="#e3e9ee" stroke="#a6b4c0" stroke-width="2.4" stroke-linejoin="round"/><path d="M18 38 Q43 32 65 38 Q79 41 88 38 M24 44 Q52 39 79 44" fill="none" stroke="#fbfbf8" stroke-width="2.2" stroke-linecap="round" opacity=".85"/><path d="M20 29 Q42 23 62 29" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/></g>',
    stratocumulus: '<g class="wcc-cloud wcc-stratocumulus"><path d="M13 46 C7 39 12 29 23 28 C26 16 41 15 49 26 C60 18 75 22 77 34 C91 32 96 45 87 53 H23 C18 53 15 51 13 46Z" fill="#edf4f4" stroke="#9db7c0" stroke-width="2.5" stroke-linejoin="round"/><path d="M21 39 Q42 32 58 40 Q72 44 86 37" fill="none" stroke="#c9dfe0" stroke-width="3" stroke-linecap="round"/><path class="wcc-raindrop" d="M33 57 C28 64 29 68 34 70 C39 68 39 64 33 57Z" fill="#87bdca"/><path class="wcc-raindrop wcc-raindrop--two" d="M56 57 C51 64 52 68 57 70 C62 68 62 64 56 57Z" fill="#87bdca"/><path class="wcc-raindrop wcc-raindrop--three" d="M77 56 C72 63 73 67 78 69 C83 67 83 63 77 56Z" fill="#87bdca"/></g>'
  };
  const selected = variants[kind] ? kind : "cumulus";
  return '<svg class="watercolor-cloud-svg watercolor-cloud-' + selected + '" viewBox="0 0 100 76" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    '<ellipse cx="51" cy="55" rx="38" ry="8" fill="#9bb9bc" opacity=".12"/>' + variants[selected] + '</svg>';
}

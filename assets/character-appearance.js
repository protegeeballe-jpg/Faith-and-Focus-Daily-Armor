export const CHARACTER_PALETTE = Object.freeze({
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

export const LIGHTING_THEMES = Object.freeze({
  morning: Object.freeze({
    skyTop: '#FDF8EE', skyBottom: '#F5E7CE', groundFill: '#F3B896',
    ambientOverlay: '#FFE6A3', ambientOpacity: 0.14
  }),
  midday: Object.freeze({
    skyTop: '#FAF6EE', skyBottom: '#ECE8DF', groundFill: '#EAB898',
    ambientOverlay: '#FFFFFF', ambientOpacity: 0.06
  }),
  evening: Object.freeze({
    skyTop: '#F9E6CE', skyBottom: '#E7B48A', groundFill: '#D98E6C',
    ambientOverlay: '#E88B5A', ambientOpacity: 0.22
  }),
  night: Object.freeze({
    skyTop: '#1E2538', skyBottom: '#2F3A56', groundFill: '#394563',
    ambientOverlay: '#7A92C9', ambientOpacity: 0.24
  }),
  ambient: Object.freeze({
    skyTop: '#FAF4EC', skyBottom: '#EFE6D8', groundFill: '#F0B795',
    ambientOverlay: '#F7DFB5', ambientOpacity: 0.10
  })
});

const SAFE_PREFIX = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_POSES = new Set([
  'relaxed', 'prayer', 'stretch', 'drink', 'breathe',
  'heart', 'float', 'write', 'boop', 'night', 'celebrate'
]);

function safePrefix(value) {
  const prefix = String(value || 'wgi-guide');
  if (!SAFE_PREFIX.test(prefix)) throw new TypeError('[CharacterRigError] Invalid SVG definition prefix.');
  return prefix;
}

export function buildWatercolorDefs(rawPrefix, lighting = 'ambient') {
  const prefix = safePrefix(rawPrefix);
  const theme = LIGHTING_THEMES[lighting] || LIGHTING_THEMES.ambient;
  const p = CHARACTER_PALETTE;
  return [
    '<defs>',
      '<linearGradient id="' + prefix + '-sky" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="' + theme.skyTop + '"/>',
        '<stop offset="1" stop-color="' + theme.skyBottom + '"/>',
      '</linearGradient>',
      '<linearGradient id="' + prefix + '-skin" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="' + p.skinBase + '"/>',
        '<stop offset="1" stop-color="' + p.skinShadow + '"/>',
      '</linearGradient>',
      '<linearGradient id="' + prefix + '-shirt" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="#D5E6DC"/>',
        '<stop offset=".55" stop-color="' + p.shirtMint + '"/>',
        '<stop offset="1" stop-color="#91B7A8"/>',
      '</linearGradient>',
      '<linearGradient id="' + prefix + '-dress" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="#F0BD62"/>',
        '<stop offset=".58" stop-color="' + p.dressOchre + '"/>',
        '<stop offset="1" stop-color="#BE7A24"/>',
      '</linearGradient>',
      '<linearGradient id="' + prefix + '-leggings" x1="0" y1="0" x2="1" y2="0">',
        '<stop offset="0" stop-color="#E98965"/>',
        '<stop offset="1" stop-color="' + p.leggingTerracotta + '"/>',
      '</linearGradient>',
      '<linearGradient id="' + prefix + '-shoes" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="#82AFA2"/>',
        '<stop offset="1" stop-color="' + p.shoeTeal + '"/>',
      '</linearGradient>',
      '<radialGradient id="' + prefix + '-paper-wash" cx="48%" cy="42%" r="68%">',
        '<stop offset="0" stop-color="#FFFDF8" stop-opacity=".96"/>',
        '<stop offset=".72" stop-color="' + p.paperBg + '" stop-opacity=".62"/>',
        '<stop offset="1" stop-color="' + p.paperShadow + '" stop-opacity="0"/>',
      '</radialGradient>',
      '<linearGradient id="' + prefix + '-ground" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="' + theme.groundFill + '" stop-opacity=".08"/>',
        '<stop offset="1" stop-color="' + theme.groundFill + '" stop-opacity=".38"/>',
      '</linearGradient>',
      '<linearGradient id="' + prefix + '-gold" x1="0" y1="0" x2="1" y2="1">',
        '<stop offset="0" stop-color="#FBE5A4"/>',
        '<stop offset="1" stop-color="' + p.accentGold + '"/>',
      '</linearGradient>',
      '<pattern id="' + prefix + '-paper-fleck" width="19" height="17" patternUnits="userSpaceOnUse">',
        '<circle cx="3" cy="5" r=".55" fill="#9D866C" opacity=".16"/>',
        '<circle cx="13" cy="12" r=".42" fill="#8B9E8D" opacity=".17"/>',
        '<path d="M7 15 l1.4 -.5" stroke="#B89F7C" stroke-width=".45" opacity=".18"/>',
      '</pattern>',
      '<filter id="' + prefix + '-pigment-grain" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">',
        '<feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="17" result="grain"/>',
        '<feColorMatrix in="grain" type="saturate" values="0" result="monochrome"/>',
        '<feComponentTransfer in="monochrome" result="soft-grain">',
          '<feFuncA type="table" tableValues="0 .075"/>',
        '</feComponentTransfer>',
        '<feBlend in="SourceGraphic" in2="soft-grain" mode="multiply"/>',
      '</filter>',
      '<radialGradient id="' + prefix + '-warm-glow" cx="50%" cy="45%" r="55%">',
        '<stop offset="0%" stop-color="' + p.accentGold + '" stop-opacity=".38"/>',
        '<stop offset="100%" stop-color="' + p.accentGold + '" stop-opacity="0"/>',
      '</radialGradient>',
    '</defs>'
  ].join('');
}

function heldPropMarkup(kind) {
  if (kind === 'water-glass') {
    return '<g class="wgi-hand-prop wgi-hand-prop--water-glass" aria-hidden="true">' +
      '<path d="M177 119 L196 119 L193 146 Q186 151 180 146Z" fill="#EAF6F4" fill-opacity=".86" stroke="#77AEB2" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M179 132 Q186 135 194 132 L192 145 Q186 149 181 145Z" fill="#82C5D0" fill-opacity=".78"/>' +
      '<path d="M180 131 Q187 134 194 131" fill="none" stroke="#6DB3C2" stroke-width="1.1"/>' +
      '<path d="M181 123 Q186 126 192 123" fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity=".85"/>' +
      '</g>';
  }
  if (kind === 'pencil') {
    return '<g class="wgi-hand-prop wgi-hand-prop--pencil" aria-hidden="true">' +
      '<path d="M176 146 L191 123 L196 126 L181 150 L175 152Z" fill="#D6A96B" stroke="#A77E54" stroke-width="1.2"/>' +
      '<path d="M191 123 L195 118 L200 122 L196 126Z" fill="#F0D8B8" stroke="#A77E54" stroke-width=".8"/>' +
      '<path d="M175 152 L181 150 L177 155Z" fill="#6F7D74"/>' +
      '</g>';
  }
  if (kind === 'phone') {
    return '<g class="wgi-hand-prop wgi-hand-prop--phone" aria-hidden="true">' +
      '<rect x="176" y="123" width="15" height="27" rx="3" fill="#718A94" stroke="#4E6770" stroke-width="1.2"/>' +
      '<rect x="178" y="126" width="11" height="19" rx="1.4" fill="#E4F0ED"/>' +
      '<circle cx="183.5" cy="147" r=".8" fill="#EAF3EC"/>' +
      '</g>';
  }
  return '';
}

/**
 * Returns an articulated, reusable character rig. Geometry is authored as
 * independent SVG groups; animation may pivot a limb at a joint but never
 * stretches or displaces a flattened face image.
 */
export function buildCharacterRigMarkup({
  pose = 'relaxed',
  prefix = 'wgi-guide',
  rightHandProp = null,
  primaryMotionPart = null
} = {}) {
  const safeId = safePrefix(prefix);
  const safePose = SAFE_POSES.has(pose) ? pose : 'relaxed';
  const motionAttr = (part) => part === primaryMotionPart ? ' data-primary-motion="true"' : '';
  const prop = ['water-glass', 'pencil', 'phone'].includes(rightHandProp)
    ? heldPropMarkup(rightHandProp)
    : '';

  return [
    '<g class="wgi-character wgi-character--' + safePose + '">',
      '<ellipse class="wgi-character-shadow" cx="150" cy="171" rx="37" ry="5.5" fill="#7D9A86" opacity=".22"/>',
      '<g class="wgi-lower-body" data-rig-part="lower-body"' + motionAttr('lowerBody') + '>',
        '<g class="wgi-leg wgi-leg--left">',
          '<path d="M139 145 Q136 156 135 168" fill="none" stroke="url(#' + safeId + '-leggings)" stroke-width="10" stroke-linecap="round"/>',
          '<path d="M127 168 Q136 164 143 168 Q146 173 135 175 Q126 175 127 168Z" fill="url(#' + safeId + '-shoes)" stroke="#426D66" stroke-width="1.1"/>',
          '<path d="M130 169 Q136 167 141 170" fill="none" stroke="#D9ECE2" stroke-width="1" opacity=".8"/>',
        '</g>',
        '<g class="wgi-leg wgi-leg--right">',
          '<path d="M161 145 Q164 156 165 168" fill="none" stroke="url(#' + safeId + '-leggings)" stroke-width="10" stroke-linecap="round"/>',
          '<path d="M158 168 Q168 164 176 168 Q179 173 168 175 Q158 175 158 168Z" fill="url(#' + safeId + '-shoes)" stroke="#426D66" stroke-width="1.1"/>',
          '<path d="M161 169 Q168 167 174 170" fill="none" stroke="#D9ECE2" stroke-width="1" opacity=".8"/>',
        '</g>',
      '</g>',
      '<g class="wgi-arm wgi-arm--left" data-rig-part="left-arm"' + motionAttr('leftArm') + '>',
        '<path class="wgi-upper-arm" d="M132 107 Q120 116 121 128" fill="none" stroke="url(#' + safeId + '-skin)" stroke-width="8.5" stroke-linecap="round"/>',
        '<path class="wgi-sleeve wgi-sleeve--left" d="M131 101 Q119 99 116 110 Q118 119 128 119 L137 110Z" fill="url(#' + safeId + '-shirt)" stroke="#7EA798" stroke-width="1.2"/>',
        '<g class="wgi-sleeve-speckles" fill="#496860" opacity=".48"><circle cx="122" cy="107" r="1"/><circle cx="128" cy="112" r=".8"/><circle cx="120" cy="114" r=".65"/></g>',
        '<g class="wgi-forearm wgi-forearm--left" data-rig-part="left-forearm"' + motionAttr('leftForearm') + '>',
          '<path d="M121 128 Q117 137 122 145" fill="none" stroke="url(#' + safeId + '-skin)" stroke-width="8" stroke-linecap="round"/>',
          '<g class="wgi-hand wgi-hand--left"><path d="M119 142 Q124 140 126 145 Q126 151 121 152 Q116 151 117 146Z" fill="url(#' + safeId + '-skin)" stroke="#B77F6B" stroke-width=".85"/><path d="M119 146 l-2 2 M122 145 l-1 3" stroke="#B77F6B" stroke-width=".7" stroke-linecap="round"/></g>',
        '</g>',
      '</g>',
      '<g class="wgi-torso" data-rig-part="torso"' + motionAttr('torso') + '>',
        '<path d="M143 83 Q150 88 157 83 L160 102 Q150 108 140 102Z" fill="url(#' + safeId + '-skin)"/>',
        '<path d="M131 102 Q150 94 169 102 L175 147 Q150 156 125 147Z" fill="url(#' + safeId + '-shirt)" stroke="#73988D" stroke-width="1.7" stroke-linejoin="round"/>',
        '<path d="M132 105 Q124 101 119 111 Q120 121 132 122 L139 112Z" fill="url(#' + safeId + '-shirt)" stroke="#73988D" stroke-width="1.25"/>',
        '<path d="M168 105 Q176 101 181 111 Q180 121 168 122 L161 112Z" fill="url(#' + safeId + '-shirt)" stroke="#73988D" stroke-width="1.25"/>',
        '<g class="wgi-shirt-speckles" fill="#496860" opacity=".42">',
          '<circle cx="126" cy="111" r="1.05"/><circle cx="132" cy="116" r=".75"/><circle cx="125" cy="119" r=".6"/>',
          '<circle cx="174" cy="111" r="1.05"/><circle cx="168" cy="116" r=".75"/><circle cx="175" cy="119" r=".6"/>',
          '<circle cx="143" cy="117" r=".65"/><circle cx="157" cy="122" r=".65"/>',
        '</g>',
        '<path d="M137 104 Q150 111 163 104 L169 113" fill="none" stroke="#EAF2E7" stroke-width="1.4" opacity=".8"/>',
        '<path d="M137 105 L135 119 M163 105 L165 119" fill="none" stroke="url(#' + safeId + '-dress)" stroke-width="4.8" stroke-linecap="round"/>',
        '<path d="M133 114 Q150 119 167 114 L173 157 Q150 166 127 157Z" fill="url(#' + safeId + '-dress)" stroke="#A96E28" stroke-width="1.7" stroke-linejoin="round"/>',
        '<path d="M137 122 Q150 126 163 122 L165 151 Q150 156 135 151Z" fill="#F3C56F" opacity=".20"/>',
        '<path d="M132 154 Q150 161 168 154" fill="none" stroke="#4B3A26" stroke-width="1.15" stroke-dasharray="2.6 3.8" stroke-linecap="round" opacity=".8"/>',
        '<path d="M142 130 l2 2 M150 132 l2 2 M158 130 l2 2" stroke="#4B3A26" stroke-width="1" stroke-linecap="round" opacity=".62"/>',
        '<path d="M144 110 Q150 114 156 110" fill="none" stroke="#F7E2B6" stroke-width="1.1"/>',
      '</g>',
      '<g class="wgi-head" data-rig-part="head"' + motionAttr('head') + '>',
        '<path d="M129 68 Q124 44 144 39 Q163 31 178 42 Q195 34 208 52 Q213 68 203 91 Q197 100 188 103 L132 94 Q122 82 129 68Z" fill="#3A2E2A" stroke="#2F2522" stroke-width="1.4"/>',
        '<path d="M157 43 C153 29 164 23 174 25 C185 26 188 38 180 46 C173 53 161 51 157 43Z" fill="#3A2E2A" stroke="#2F2522" stroke-width="1.2"/>',
        '<path d="M161 32 Q169 24 179 32 M162 40 Q170 47 181 39" fill="none" stroke="#6A5147" stroke-width="1.1" opacity=".8" stroke-linecap="round"/>',
        '<ellipse cx="150" cy="72" rx="23" ry="26" fill="url(#' + safeId + '-skin)" stroke="#B77F6B" stroke-width="1.35"/>',
        '<path d="M128 70 Q127 53 145 48 Q164 45 172 61 Q162 55 153 57 Q140 55 128 70Z" fill="#3A2E2A"/>',
        '<path d="M130 69 Q126 83 133 94 Q138 99 140 91" fill="none" stroke="#3A2E2A" stroke-width="6.4" stroke-linecap="round"/>',
        '<path d="M169 68 Q175 81 168 94 Q164 99 161 91" fill="none" stroke="#3A2E2A" stroke-width="6.4" stroke-linecap="round"/>',
        '<path d="M137 67 Q142 64 146 67 M155 67 Q159 64 164 67" fill="none" stroke="#5B4038" stroke-width="1.35" stroke-linecap="round"/>',
        '<g class="wgi-eyes-open">',
          '<ellipse cx="142" cy="73" rx="2.2" ry="2.9" fill="#443632"/><ellipse cx="158" cy="73" rx="2.2" ry="2.9" fill="#443632"/>',
          '<circle cx="142.7" cy="72.2" r=".65" fill="#FFF9EF"/><circle cx="158.7" cy="72.2" r=".65" fill="#FFF9EF"/>',
        '</g>',
        '<g class="wgi-eyes-closed" fill="none" stroke="#704B43" stroke-width="1.65" stroke-linecap="round"><path d="M137.5 74 Q142 78 146.5 74"/><path d="M153.5 74 Q158 78 162.5 74"/></g>',
        '<path d="M149 76 Q147 80 150 81" fill="none" stroke="#B77F6B" stroke-width=".8" stroke-linecap="round"/>',
        '<path class="wgi-mouth-smile" d="M143.5 86 Q150 92 156.5 86" fill="none" stroke="#965B52" stroke-width="1.8" stroke-linecap="round"/>',
        '<ellipse class="wgi-mouth-sip" cx="150" cy="87" rx="2.5" ry="3.2" fill="#965B52"/>',
        '<ellipse class="wgi-mouth-yawn" cx="150" cy="87" rx="3.8" ry="4.8" fill="#965B52"/>',
        '<ellipse cx="134" cy="82" rx="4.1" ry="2.6" fill="#F29B88" opacity=".56"/>',
        '<ellipse cx="166" cy="82" rx="4.1" ry="2.6" fill="#F29B88" opacity=".56"/>',
        '<path d="M133 92 Q138 99 143 99 M157 99 Q163 98 167 91" fill="none" stroke="#3A2E2A" stroke-width="2.3" stroke-linecap="round"/>',
      '</g>',
      '<g class="wgi-arm wgi-arm--right" data-rig-part="right-arm"' + motionAttr('rightArm') + '>',
        '<path class="wgi-upper-arm" d="M168 107 Q181 115 181 128" fill="none" stroke="url(#' + safeId + '-skin)" stroke-width="8.5" stroke-linecap="round"/>',
        '<path class="wgi-sleeve wgi-sleeve--right" d="M168 101 Q180 99 184 110 Q182 119 171 120 L163 111Z" fill="url(#' + safeId + '-shirt)" stroke="#73988D" stroke-width="1.25"/>',
        '<g class="wgi-sleeve-speckles" fill="#496860" opacity=".48"><circle cx="174" cy="107" r="1"/><circle cx="180" cy="112" r=".8"/><circle cx="173" cy="116" r=".65"/></g>',
        '<g class="wgi-forearm wgi-forearm--right" data-rig-part="right-forearm"' + motionAttr('rightForearm') + '>',
          '<path d="M181 128 Q188 136 181 144" fill="none" stroke="url(#' + safeId + '-skin)" stroke-width="8" stroke-linecap="round"/>',
          '<g class="wgi-hand wgi-hand--right"><path d="M178 141 Q183 138 187 143 Q189 149 183 152 Q177 152 176 147Z" fill="url(#' + safeId + '-skin)" stroke="#B77F6B" stroke-width=".85"/><path d="M181 146 l-1 3 M185 145 l1 3" stroke="#B77F6B" stroke-width=".7" stroke-linecap="round"/>' + prop + '</g>',
        '</g>',
      '</g>',
    '</g>'
  ].join('');
}
